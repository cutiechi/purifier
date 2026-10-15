package cool18

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

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
	URL          string        `json:"url"`
	Stale        bool          `json:"stale,omitempty"`
	RefreshError string        `json:"refreshError,omitempty"`
}

type HomeResponse struct {
	Links    []ChapterLink `json:"links"`
	NextMtid *string       `json:"nextMtid,omitempty"`
}

// GetPost 获取帖子正文与跟帖（带二级磁盘缓存与防击穿）
func (s *Service) GetPost(ctx context.Context, tid string, refresh bool) (*PostResponse, error) {
	if err := upstream.AssertSafeID(tid); err != nil {
		return nil, fmt.Errorf("invalid tid: 400")
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
		fetchedHTML, err := s.client.FetchSingleflight(ctx, cacheKey, func() (string, error) {
			return s.client.Fetch(ctx, pageURL)
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

	// 4. 获取跟帖列表
	replies, _ := s.getReplies(ctx, tid, refresh)

	// 如果有跟帖，更新评论数
	if len(replies) > 0 {
		extracted.Meta.Comments = countReplies(replies)
	}

	// 5. 记录访问历史
	_ = s.store.RecordVisit(ctx, Cool18SiteID, model.KindPost, tid, extracted.Title, pageURL)

	resp := &PostResponse{
		Title:   extracted.Title,
		Content: extracted.Content,
		Links:   extracted.Links,
		Meta:    extracted.Meta,
		Replies: replies,
		URL:     pageURL,
	}
	if stale {
		resp.Stale = true
		resp.RefreshError = refreshErr
	}

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
		res, err := s.client.Fetch(ctx, repliesURL)
		if err == nil && res != "" {
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
			return nil, fmt.Errorf("invalid mtid: 400")
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
	return s.client.FetchSingleflight(ctx, "cool18:home:html", func() (string, error) {
		return s.client.Fetch(ctx, Cool18HomeURL)
	})
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
	html, err := s.fetchHomeHTML(ctx)
	if err != nil {
		return nil, err
	}
	return ExtractCmtRankPosts(html)
}

func (s *Service) GetTrending(ctx context.Context) ([]HotPost, error) {
	html, err := s.fetchHomeHTML(ctx)
	if err != nil {
		return nil, err
	}
	return ExtractHotPosts(html)
}

func (s *Service) Browse(ctx context.Context, categoryType, keywords string, page int) (*CategoryPage, error) {
	if page < 1 {
		page = 1
	}
	var targetURL string
	var category string

	if categoryType != "" {
		category = categoryType
		targetURL = fmt.Sprintf("%s?action=search&act=threadsearch&app=forum&type=%s&submit=%s",
			Cool18HomeURL, url.QueryEscape(categoryType), url.QueryEscape("查询"))
	} else if keywords != "" {
		category = keywords
		targetURL = fmt.Sprintf("%s?act=threadsearch&app=forum&keywords=%s&submit=%s",
			Cool18HomeURL, url.QueryEscape(keywords), url.QueryEscape("栏目搜索"))
	} else {
		return nil, fmt.Errorf("missing type or keywords")
	}

	if page > 1 {
		targetURL += fmt.Sprintf("&p=%d", page)
	}

	html, err := s.client.Fetch(ctx, targetURL)
	if err != nil {
		return nil, err
	}

	return ParseCategoryPage(html, category, page)
}
