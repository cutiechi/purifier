package cool18

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"unicode"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
	"purifier/internal/storage"
)

const Cool18SiteID = "1"
const Cool18HomeURL = "https://www.cool18.com/bbs4/index.php"

type Service struct {
	client  *upstream.Client
	store   *storage.Store
	dataDir string
}

func NewService(client *upstream.Client, store *storage.Store, dataDir string) *Service {
	return &Service{
		client:  client,
		store:   store,
		dataDir: dataDir,
	}
}

type PostResponse struct {
	Title        string        `json:"title"`
	Content      string        `json:"content"`
	Links        []ChapterLink `json:"links"`
	Meta         PostMeta      `json:"meta"`
	Replies      []ReplyNode   `json:"replies"`
	// ReplyLinks 跟帖即章节：可跳转的回复（BFS 序，已滤噪音跟帖），链接导航面板用。
	ReplyLinks   []ChapterLink `json:"replyLinks"`
	URL          string        `json:"url"`
	Stale        bool          `json:"stale,omitempty"`
	RefreshError string        `json:"refreshError,omitempty"`
	RepliesError string        `json:"repliesError,omitempty"`
}

type HomeResponse struct {
	Links    []ChapterLink `json:"links"`
	NextMtid *string       `json:"nextMtid,omitempty"`
}

// GetPostMeta 只解析帖子标题，供补充分组等只需要标题的场景使用：
// 不抓跟帖、不写阅读历史（避免把用户没点开的帖记进 items）。
func (s *Service) GetPostMeta(ctx context.Context, tid string) (*PostResponse, error) {
	if err := upstream.AssertSafeID(tid); err != nil {
		return nil, upstream.NewExtractorError("invalid tid", http.StatusBadRequest)
	}

	pageURL := fmt.Sprintf("%s?app=forum&act=threadview&tid=%s", Cool18HomeURL, tid)
	cacheKey := fmt.Sprintf("%s:post:%s", Cool18SiteID, tid)

	rawHTML := ""
	if cached, err := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, nil); err == nil && cached != nil {
		rawHTML = cached.Data
	}
	if rawHTML == "" {
		fetched, err := s.client.FetchSingleflight(ctx, cacheKey, func(fctx context.Context) (string, error) {
			return s.client.Fetch(fctx, pageURL)
		})
		if err != nil {
			return nil, err
		}
		rawHTML = fetched
		_ = upstream.WriteContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, rawHTML, nil)
	}

	extracted, err := ExtractPost(rawHTML)
	if err != nil {
		return nil, err
	}
	return &PostResponse{Title: extracted.Title, URL: pageURL}, nil
}

// GetPost 获取帖子正文与跟帖（带二级磁盘缓存与防击穿）
func (s *Service) GetPost(ctx context.Context, tid string, refresh bool) (*PostResponse, error) {
	if err := upstream.AssertSafeID(tid); err != nil {
		return nil, upstream.NewExtractorError("invalid tid", http.StatusBadRequest)
	}

	pageURL := fmt.Sprintf("%s?app=forum&act=threadview&tid=%s", Cool18HomeURL, tid)
	cacheKey := fmt.Sprintf("%s:post:%s", Cool18SiteID, tid)

	var rawHTML string
	var fromCache bool
	var stale bool
	var refreshErr string

	// 1. 读取正文缓存
	if !refresh {
		cached, err := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, nil)
		if err == nil && cached != nil {
			rawHTML = cached.Data
			fromCache = true
		}
	}

	// 2. 缓存未命中或强制刷新
	if rawHTML == "" {
		fetchedHTML, err := s.client.FetchSingleflight(ctx, cacheKey, func(fctx context.Context) (string, error) {
			return s.client.Fetch(fctx, pageURL)
		})
		if err != nil {
			if refresh {
				// 刷新失败尝试回退到旧缓存
				cached, cErr := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, nil)
				if cErr == nil && cached != nil {
					rawHTML = cached.Data
					stale = true
					refreshErr = err.Error()
				} else {
					return nil, err
				}
			} else {
				return nil, err
			}
		} else {
			rawHTML = fetchedHTML
		}
	}

	// 3. 提取解析正文
	extracted, err := ExtractPost(rawHTML)
	if err != nil {
		return nil, err
	}

	// 成功解析后原子写入磁盘缓存
	if !fromCache && !stale {
		_ = upstream.WriteContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, rawHTML, nil)
	}

	// 4. 获取跟帖列表（失败不阻断正文，但通过 repliesError 明确告知客户端）
	replies, repliesErr := s.getReplies(ctx, tid, refresh)
	repliesErrMsg := ""
	if repliesErr != nil {
		repliesErrMsg = repliesErr.Error()
	}

	// 如果有跟帖，更新评论数
	if len(replies) > 0 {
		extracted.Meta.Comments = countReplies(replies)
	}

	// 5. 记录访问历史
	_ = s.store.RecordVisit(ctx, Cool18SiteID, model.KindPost, tid, extracted.Title, pageURL)

	// 6. 链接收割：正文内链 + 回复 tid 入发现前沿（失败静默，不影响阅读）
	s.enqueueHarvest(ctx, tid, extracted, replies)

	resp := &PostResponse{
		Title:      extracted.Title,
		Content:    extracted.Content,
		Links:      extracted.Links,
		Meta:       extracted.Meta,
		Replies:    replies,
		ReplyLinks: CollectReplyLinks(replies, tid),
		URL:        pageURL,
	}
	if stale {
		resp.Stale = true
		resp.RefreshError = refreshErr
	}
	resp.RepliesError = repliesErrMsg

	return resp, nil
}

func (s *Service) getReplies(ctx context.Context, tid string, refresh bool) ([]ReplyNode, error) {
	repliesURL := fmt.Sprintf("%s?app=forum&act=achildlist&tid=%s", Cool18HomeURL, tid)

	var rawJSON string
	if !refresh {
		cached, err := upstream.ReadRepliesCache(s.dataDir, Cool18SiteID, tid)
		if err == nil && cached != nil {
			rawJSON = string(cached.Data)
		}
	}

	if rawJSON == "" {
		res, err := s.client.FetchSingleflight(ctx, fmt.Sprintf("%s:replies:%s", Cool18SiteID, tid), func(fctx context.Context) (string, error) {
			return s.client.Fetch(fctx, repliesURL)
		})
		if err != nil {
			return []ReplyNode{}, err
		}
		if res != "" {
			rawJSON = res
			_ = upstream.WriteRepliesCache(s.dataDir, Cool18SiteID, tid, json.RawMessage(res))
		}
	}

	if rawJSON == "" {
		return []ReplyNode{}, nil
	}

	return BuildReplyTree(rawJSON, tid)
}

func countReplies(nodes []ReplyNode) int {
	total := 0
	stack := append([]ReplyNode{}, nodes...)
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		total++
		stack = append(stack, n.Children...)
	}
	return total
}

// GetHomePosts 获取首页帖子（支持游标 mtid）
func (s *Service) GetHomePosts(ctx context.Context, mtid string) (*HomeResponse, error) {
	if mtid != "" {
		if err := upstream.AssertSafeID(mtid); err != nil {
			return nil, upstream.NewExtractorError("invalid mtid", http.StatusBadRequest)
		}
	}

	ajaxURL := fmt.Sprintf("%s?app=forum&act=ajax&mtid=%s&aifilter=0", Cool18HomeURL, mtid)
	rawJSON, err := s.client.Fetch(ctx, ajaxURL)
	if err != nil {
		return nil, err
	}

	type rawItem struct {
		Tid     string `json:"tid"`
		Rootid  string `json:"rootid"`
		Subject string `json:"subject"`
	}

	var items []rawItem
	if err := json.Unmarshal([]byte(rawJSON), &items); err != nil {
		return nil, fmt.Errorf("invalid home links json: %w", err)
	}

	seen := make(map[string]bool)
	var links []ChapterLink
	var nextMtid *string

	for _, it := range items {
		if it.Rootid != "0" && it.Rootid != "" {
			continue // 只保留主帖
		}
		if it.Tid == "" || seen[it.Tid] {
			continue
		}
		seen[it.Tid] = true
		title := StripTags(it.Subject)
		links = append(links, ChapterLink{
			Index: len(links) + 1,
			Title: title,
			Tid:   it.Tid,
		})
		t := it.Tid
		nextMtid = &t
	}

	return &HomeResponse{
		Links:    links,
		NextMtid: nextMtid,
	}, nil
}

func (s *Service) fetchHomeHTML(ctx context.Context) (string, error) {
	return s.client.FetchSingleflight(ctx, "cool18:home:html", func(fctx context.Context) (string, error) {
		return s.client.Fetch(fctx, Cool18HomeURL)
	})
}

// 榜单/精华页 URL（首页 HTML 不含 rank-table，需独立抓取）
const (
	cool18HotURL = Cool18HomeURL + "?app=forum&act=hot"
	cool18CmtURL = Cool18HomeURL + "?act=cmtrank&y=1"
)

func (s *Service) fetchHTML(ctx context.Context, key, targetURL string) (string, error) {
	return s.client.FetchSingleflight(ctx, key, func(fctx context.Context) (string, error) {
		return s.client.Fetch(fctx, targetURL)
	})
}

// GetBook 获取 Cool18 书库藏文（bookview 整本一页，带缓存与刷新回退）
func (s *Service) GetBook(ctx context.Context, cid string, refresh bool) (*ExtractedBook, error) {
	if err := upstream.AssertSafeID(cid); err != nil {
		return nil, upstream.NewExtractorError("invalid cid", http.StatusBadRequest)
	}

	pageURL := fmt.Sprintf("%s?app=book&act=bookview&cid=%s", Cool18HomeURL, cid)
	cacheKey := fmt.Sprintf("%s:book:%s", Cool18SiteID, cid)

	var rawHTML string
	var fromCache bool
	var stale bool
	var refreshErr string

	if !refresh {
		cached, err := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindBook, cid, nil)
		if err == nil && cached != nil {
			rawHTML = cached.Data
			fromCache = true
		}
	}

	if rawHTML == "" {
		fetched, err := s.client.FetchSingleflight(ctx, cacheKey, func(fctx context.Context) (string, error) {
			return s.client.Fetch(fctx, pageURL)
		})
		if err != nil {
			if refresh {
				cached, cErr := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindBook, cid, nil)
				if cErr == nil && cached != nil {
					rawHTML = cached.Data
					stale = true
					refreshErr = err.Error()
				} else {
					return nil, err
				}
			} else {
				return nil, err
			}
		} else {
			rawHTML = fetched
		}
	}

	extracted, err := ExtractBook(rawHTML, pageURL)
	if err != nil {
		return nil, err
	}
	extracted.Stale = stale
	extracted.RefreshError = refreshErr

	if !fromCache && !stale {
		_ = upstream.WriteContentCache(s.dataDir, Cool18SiteID, model.KindBook, cid, rawHTML, nil)
	}

	_ = s.store.RecordVisit(ctx, Cool18SiteID, model.KindBook, cid, extracted.Title, pageURL)

	return extracted, nil
}

func (s *Service) GetCategories(ctx context.Context) ([]CategoryLink, error) {
	html, err := s.fetchHomeHTML(ctx)
	if err != nil {
		return nil, err
	}
	return ExtractCategoryLinks(html)
}

func (s *Service) GetFeatured(ctx context.Context) ([]ChapterLink, error) {
	html, err := s.fetchHomeHTML(ctx)
	if err != nil {
		return nil, err
	}
	return ExtractGoldLinks(html)
}

func (s *Service) GetPicks(ctx context.Context) ([]RecommendSection, error) {
	html, err := s.fetchHomeHTML(ctx)
	if err != nil {
		return nil, err
	}
	return ExtractRecommendSections(html)
}

func (s *Service) GetComments(ctx context.Context) ([]CmtRankPost, error) {
	html, err := s.fetchHTML(ctx, "cool18:cmtrank:html", cool18CmtURL)
	if err != nil {
		return nil, err
	}
	return ExtractCmtRankPosts(html)
}

func (s *Service) GetTrending(ctx context.Context) ([]HotPost, error) {
	html, err := s.fetchHTML(ctx, "cool18:hot:html", cool18HotURL)
	if err != nil {
		return nil, err
	}
	return ExtractHotPosts(html)
}

func (s *Service) Browse(ctx context.Context, categoryType, keywords string, page int) (*CategoryPage, error) {
	if page < 1 {
		page = 1
	}

	if categoryType != "" {
		category := categoryType
		targetURL := fmt.Sprintf("%s?action=search&act=threadsearch&app=forum&type=%s&submit=%s",
			Cool18HomeURL, url.QueryEscape(categoryType), url.QueryEscape("查询"))
		if page > 1 {
			targetURL += fmt.Sprintf("&p=%d", page)
		}
		html, err := s.client.Fetch(ctx, targetURL)
		if err != nil {
			return nil, err
		}
		return ParseCategoryPage(html, category, page)
	}

	if keywords == "" {
		return nil, upstream.NewExtractorError("missing type or keywords", http.StatusBadRequest)
	}

	return s.searchKeywords(ctx, s.client.Fetch, keywords, page)
}

// searchKeywords 按关键词搜索。上游 threadsearch 有两个实测限制：
//  1. 含空格的多词查询恒返回 0 条 → 按 token 长度降序逐词回退（最长词区分度最高）；
//  2. ≥8 字左右的整串关键词也常返回 0 条，但其匹配是子串匹配，短词能命中 →
//     token 回退后仍为空时按前缀截断（6/4 字，跳过仍含空白的截断）逐级放宽。
//
// 各级取首个非空结果；结果 category 回显实际生效的查询词，页码沿用原始 page。
func (s *Service) searchKeywords(ctx context.Context, fetch func(context.Context, string) (string, error), keywords string, page int) (*CategoryPage, error) {
	res, err := fetchSearchPage(ctx, fetch, keywords, page)
	if err != nil {
		return nil, err
	}
	if len(res.Links) > 0 {
		return res, nil
	}
	fallbacks := append(searchTokens(keywords), prefixTruncations(keywords)...)
	for _, token := range fallbacks {
		fallback, err := fetchSearchPage(ctx, fetch, token, page)
		if err != nil {
			return nil, err
		}
		if len(fallback.Links) > 0 {
			return fallback, nil
		}
	}
	return res, nil
}

// searchTokens 把关键词拆成空白分隔 token，长度降序（并列保持原顺序），最多 3 个以限制上游请求次数。
func searchTokens(keywords string) []string {
	fields := strings.Fields(keywords)
	if len(fields) <= 1 {
		return nil
	}
	tokens := append([]string(nil), fields...)
	sort.SliceStable(tokens, func(i, j int) bool { return len(tokens[i]) > len(tokens[j]) })
	if len(tokens) > 3 {
		tokens = tokens[:3]
	}
	return tokens
}

// prefixTruncations 生成整串的前缀截断（6/4 字，按 rune 计），用于绕过上游对长关键词的匹配失效。
// 截断后仍含空白的多词前缀无意义（上游不支持），跳过；短于或等于原串的不生成。
func prefixTruncations(keywords string) []string {
	var out []string
	runes := []rune(keywords)
	for _, n := range []int{6, 4} {
		if len(runes) <= n {
			break
		}
		prefix := string(runes[:n])
		if strings.ContainsFunc(prefix, unicode.IsSpace) {
			continue
		}
		out = append(out, prefix)
	}
	return out
}

func fetchSearchPage(ctx context.Context, fetch func(context.Context, string) (string, error), keywords string, page int) (*CategoryPage, error) {
	targetURL := fmt.Sprintf("%s?act=threadsearch&app=forum&keywords=%s&submit=%s",
		Cool18HomeURL, url.QueryEscape(keywords), url.QueryEscape("栏目搜索"))
	if page > 1 {
		targetURL += fmt.Sprintf("&p=%d", page)
	}
	html, err := fetch(ctx, targetURL)
	if err != nil {
		return nil, err
	}
	return ParseCategoryPage(html, keywords, page)
}
