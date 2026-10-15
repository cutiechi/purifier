package cool18

import (
	"encoding/json"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"purifier/internal/core/sanitize"
	"purifier/internal/core/upstream"
	"purifier/internal/model"
)

type PostMeta struct {
	Author      string      `json:"author,omitempty"`
	Uid         string      `json:"uid,omitempty"`
	Badge       string      `json:"badge,omitempty"`
	PublishedAt string      `json:"publishedAt,omitempty"`
	Reads       int         `json:"reads,omitempty"`
	Likes       int         `json:"likes,omitempty"`
	Comments    int         `json:"comments,omitempty"`
	Parent      *ParentPost `json:"parent,omitempty"`
	RootTid     string      `json:"rootTid,omitempty"`
}

type ParentPost struct {
	Tid         string `json:"tid"`
	Title       string `json:"title"`
	Author      string `json:"author,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
}

type ChapterLink = model.ChapterLink

type ReplyNode struct {
	Tid      string      `json:"tid"`
	Uptid    string      `json:"uptid"`
	Rootid   string      `json:"rootid"`
	Uid      string      `json:"uid"`
	Username string      `json:"username"`
	Subject  string      `json:"subject"`
	Dateline string      `json:"dateline"`
	Children []ReplyNode `json:"children"`
}

type ExtractedPost struct {
	Title   string        `json:"title"`
	Content string        `json:"content"`
	Meta    PostMeta      `json:"meta"`
	Links   []ChapterLink `json:"links"`
}

var stripTagRegex = regexp.MustCompile(`<[^>]+>`)

// maxReplyDepth 跟帖树最大递归深度（线性深链防护）
const maxReplyDepth = 64

func StripTags(s string) string {
	return html.UnescapeString(stripTagRegex.ReplaceAllString(s, ""))
}

// ExtractPost 解析 Cool18 帖子详情 HTML
func ExtractPost(rawHTML string) (*ExtractedPost, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(doc.Find("h1.main-title").First().Text())
	if title == "" {
		t := doc.Find("title").First().Text()
		parts := strings.Split(t, "-")
		if len(parts) > 0 {
			title = strings.TrimSpace(parts[0])
		}
	}
	if title == "" {
		title = "无标题"
	}

	// 查找正文 pre
	preSel := doc.Find("#content-section pre").First()
	preHTML := ""
	if preSel.Length() > 0 {
		preHTML, _ = preSel.Html()
	} else {
		bestLen := 0
		doc.Find("pre").Each(func(_ int, s *goquery.Selection) {
			h, _ := s.Html()
			if len(h) > bestLen {
				bestLen = len(h)
				preHTML = h
			}
		})
	}

	if preHTML == "" {
		return nil, upstream.NewExtractorError("content not found", http.StatusNotFound)
	}

	// 安全清洗正文
	content, err := sanitize.SanitizeContentHTML(preHTML, func(href, label string) (string, string, bool) {
		tid := sanitize.ExtractTid(href)
		if tid != "" {
			if label == "" {
				label = tid
			}
			return "/read/" + tid, label, true
		}
		return "", "", false
	}, sanitize.Options{PBreakClosing: false})
	if err != nil {
		return nil, err
	}

	// 元数据提取
	meta := extractMeta(doc)

	// 提取正文外的扩展章节链接
	var links []ChapterLink
	doc.Find("#content-section a[href*='tid=']").Each(func(_ int, s *goquery.Selection) {
		if s.Closest("pre").Length() > 0 {
			return
		}
		href, _ := s.Attr("href")
		tid := sanitize.ExtractTid(href)
		t := strings.TrimSpace(s.Text())
		if tid != "" && t != "" {
			links = append(links, ChapterLink{Title: t, Tid: tid})
		}
	})

	// 去重并按 tid 排序
	seen := make(map[string]bool)
	var uniqueLinks []ChapterLink
	for _, l := range links {
		if !seen[l.Tid] {
			seen[l.Tid] = true
			uniqueLinks = append(uniqueLinks, l)
		}
	}
	sort.Slice(uniqueLinks, func(i, j int) bool {
		aNum, _ := strconv.Atoi(uniqueLinks[i].Tid)
		bNum, _ := strconv.Atoi(uniqueLinks[j].Tid)
		return aNum < bNum
	})
	for i := range uniqueLinks {
		uniqueLinks[i].Index = i + 1
	}

	return &ExtractedPost{
		Title:   title,
		Content: content,
		Meta:    meta,
		Links:   uniqueLinks,
	}, nil
}

// ExtractedBook Cool18 书库藏文（bookview 整本一页）
type ExtractedBook struct {
	Title        string  `json:"title"`
	Content      string  `json:"content"`
	Author       *string `json:"author,omitempty"`
	URL          string  `json:"url"`
	Stale        bool    `json:"stale,omitempty"`
	RefreshError string  `json:"refreshError,omitempty"`
}

var (
	cool18BookSenderRegex = regexp.MustCompile(`送交者\s*[:：]\s*(\S+)`)
	cool18PreRegex        = regexp.MustCompile(`(?is)<pre\b[^>]*>(.*?)</pre>`)
)

// ExtractBook 解析 Cool18 bookview 页（整本一页，无章节模型）
func ExtractBook(rawHTML, pageURL string) (*ExtractedBook, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(doc.Find(".show_content center font b, .show_content center b").First().Text())
	if title == "" {
		title = strings.TrimSpace(doc.Find("center font[size='6'] b, center font[size=\"6\"] b").First().Text())
	}
	if title == "" {
		t := strings.TrimSpace(doc.Find("title").First().Text())
		title = strings.TrimSpace(strings.Split(t, "-")[0])
	}
	if title == "" {
		title = "无标题"
	}

	var author *string
	if m := cool18BookSenderRegex.FindStringSubmatch(doc.Find(".show_content").First().Text()); len(m) > 1 {
		a := strings.TrimSpace(m[1])
		if a != "" {
			author = &a
		}
	}

	// 正文取 <!--bodybegin--> 之后的第一个 <pre>；回退到最长的 <pre>
	preHTML := ""
	if marker := strings.Index(rawHTML, "<!--bodybegin-->"); marker >= 0 {
		if m := cool18PreRegex.FindStringSubmatch(rawHTML[marker:]); len(m) > 1 {
			preHTML = m[1]
		}
	}
	if preHTML == "" {
		best := ""
		doc.Find("pre").Each(func(_ int, s *goquery.Selection) {
			h, _ := s.Html()
			if len(h) > len(best) {
				best = h
			}
		})
		preHTML = best
	}

	if strings.TrimSpace(StripTags(preHTML)) == "" {
		return nil, upstream.NewExtractorError("book content not found", http.StatusNotFound)
	}

	content, err := sanitize.SanitizeContentHTML(preHTML, func(href, label string) (string, string, bool) {
		if tid := sanitize.ExtractTid(href); tid != "" {
			if label == "" {
				label = tid
			}
			return "/read/" + tid, label, true
		}
		return "", "", false
	}, sanitize.Options{PBreakClosing: false})
	if err != nil {
		return nil, err
	}

	return &ExtractedBook{
		Title:   title,
		Content: content,
		Author:  author,
		URL:     pageURL,
	}, nil
}

var dateRegex = regexp.MustCompile(`于\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})`)
var readsRegex = regexp.MustCompile(`已读\s*([\d,]+)\s*次`)

func extractMeta(doc *goquery.Document) PostMeta {
	meta := PostMeta{}

	senderSel := doc.Find(".sender").First()
	if senderSel.Length() > 0 {
		senderText := strings.TrimSpace(senderSel.Text())
		authorText := strings.TrimSpace(senderSel.Find("a").First().Text())
		if authorText != "" {
			meta.Author = authorText
		}
		if m := dateRegex.FindStringSubmatch(senderText); len(m) > 1 {
			meta.PublishedAt = m[1]
		}
	}

	viewsSel := doc.Find(".views").First()
	if viewsSel.Length() > 0 {
		if m := readsRegex.FindStringSubmatch(viewsSel.Text()); len(m) > 1 {
			nStr := strings.ReplaceAll(m[1], ",", "")
			n, _ := strconv.Atoi(nStr)
			meta.Reads = n
		}
	}

	return meta
}

// BuildReplyTree 将扁平跟帖列表组装成多级嵌套树
func BuildReplyTree(rawJSON string, rootTid string) ([]ReplyNode, error) {
	type rawItem struct {
		Tid      string `json:"tid"`
		Uptid    string `json:"uptid"`
		Rootid   string `json:"rootid"`
		Uid      string `json:"uid"`
		Username string `json:"username"`
		Subject  string `json:"subject"`
		Dateline string `json:"dateline"`
	}

	var items []rawItem
	if err := json.Unmarshal([]byte(rawJSON), &items); err != nil {
		return nil, err
	}

	// 用指针建树：子节点追加到父指针，最后统一解引用为值树。
	// 若边建边拷贝值，父帖先于子帖出现时子回复会写进已被丢弃的副本里。
	type ptrNode struct {
		node     *ReplyNode
		children []*ptrNode
	}

	index := make(map[string]*ptrNode, len(items))
	order := make([]*ptrNode, 0, len(items))

	for _, item := range items {
		if item.Tid == "" {
			continue
		}
		if _, exists := index[item.Tid]; exists {
			continue
		}
		p := &ptrNode{node: &ReplyNode{
			Tid:      item.Tid,
			Uptid:    item.Uptid,
			Rootid:   item.Rootid,
			Uid:      item.Uid,
			Username: StripTags(item.Username),
			Subject:  StripTags(item.Subject),
			Dateline: item.Dateline,
			Children: []ReplyNode{},
		}}
		index[item.Tid] = p
		order = append(order, p)
	}

	var rootPtrs []*ptrNode
	for _, p := range order {
		parentID := p.node.Uptid
		if parentID == "" || parentID == rootTid || parentID == p.node.Tid {
			rootPtrs = append(rootPtrs, p)
			continue
		}
		parent, ok := index[parentID]
		if !ok {
			rootPtrs = append(rootPtrs, p)
			continue
		}
		parent.children = append(parent.children, p)
	}

	// 递归转值树：带路径环检测与深度上限（防互引 uptid / 线性深链爆栈）
	visiting := make(map[*ptrNode]bool)
	var build func(p *ptrNode, depth int) ReplyNode
	build = func(p *ptrNode, depth int) ReplyNode {
		node := *p.node
		node.Children = []ReplyNode{}
		if depth >= maxReplyDepth {
			return node
		}
		for _, c := range p.children {
			if visiting[c] {
				continue
			}
			visiting[c] = true
			node.Children = append(node.Children, build(c, depth+1))
			delete(visiting, c)
		}
		return node
	}

	rootNodes := make([]ReplyNode, 0, len(rootPtrs))
	for _, rp := range rootPtrs {
		visiting[rp] = true
		rootNodes = append(rootNodes, build(rp, 0))
		delete(visiting, rp)
	}
	return rootNodes, nil
}

type HotPost = model.HotPost
type CmtRankPost = model.CmtRankPost
type CategoryLink = model.CategoryLink
type RecommendSection = model.RecommendSection
type CategoryPage = model.CategoryPage

// ExtractHotPosts 提取人气榜
func ExtractHotPosts(rawHTML string) ([]HotPost, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	var posts []HotPost
	doc.Find("table.rank-table tbody tr").Each(func(i int, s *goquery.Selection) {
		a := s.Find("td.title-col a").First()
		href, _ := a.Attr("href")
		tid := sanitize.ExtractTid(href)
		if tid == "" {
			return
		}
		title := strings.TrimSpace(a.Contents().FilterFunction(func(_ int, sel *goquery.Selection) bool {
			return goquery.NodeName(sel) == "#text"
		}).First().Text())
		title = regexp.MustCompile(`\s+-\s+\S+\s*\(\d+\s*bytes\)\s*$`).ReplaceAllString(title, "")

		reads := 0
		if m := regexp.MustCompile(`\((\d+)\s*reads\)`).FindStringSubmatch(a.Text()); len(m) > 1 {
			reads, _ = strconv.Atoi(m[1])
		}
		posts = append(posts, HotPost{
			Rank:  len(posts) + 1,
			Title: title,
			Tid:   tid,
			Reads: reads,
		})
	})
	return posts, nil
}

// ExtractCmtRankPosts 提取评论榜
func ExtractCmtRankPosts(rawHTML string) ([]CmtRankPost, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	var posts []CmtRankPost
	doc.Find("table.rank-table tbody tr").Each(func(i int, s *goquery.Selection) {
		a := s.Find("td").Eq(2).Find("a[href*='tid=']").First()
		href, _ := a.Attr("href")
		tid := sanitize.ExtractTid(href)
		if tid == "" {
			return
		}
		title := strings.TrimSpace(a.Text())
		cmts := 0
		if m := regexp.MustCompile(`(\d+)\s*评`).FindStringSubmatch(s.Find("td").Eq(4).Text()); len(m) > 1 {
			cmts, _ = strconv.Atoi(m[1])
		}
		posts = append(posts, CmtRankPost{
			Rank:     len(posts) + 1,
			Title:    title,
			Tid:      tid,
			Comments: cmts,
		})
	})
	return posts, nil
}

// ExtractGoldLinks 提取精华热贴
func ExtractGoldLinks(rawHTML string) ([]ChapterLink, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	var links []ChapterLink
	seen := make(map[string]bool)
	doc.Find("#d_gold_list table a[href*='tid=']").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		tid := sanitize.ExtractTid(href)
		title := strings.TrimSpace(s.Text())
		if tid != "" && title != "" && !seen[tid] {
			seen[tid] = true
			links = append(links, ChapterLink{
				Index: len(links) + 1,
				Title: title,
				Tid:   tid,
			})
		}
	})
	return links, nil
}

// ExtractCategoryLinks 提取栏目分类。
// 上游 href 是站点相对路径（index.php?...），必须转成前端 SPA 的 /browse 路由，
// 否则 React Router 会把它当前页前缀后当成内部路由，落到 SPA fallback 的 404 页。
func ExtractCategoryLinks(rawHTML string) ([]CategoryLink, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	var links []CategoryLink
	doc.Find(".ext_org_title a").Each(func(_ int, s *goquery.Selection) {
		raw := strings.TrimSpace(s.Text())
		href, _ := s.Attr("href")
		if raw == "" || href == "" {
			return
		}
		label := regexp.MustCompile(`[『』〖〗【】\[\]]`).ReplaceAllString(raw, "")

		kind := "other"
		var spaURL string
		switch {
		case strings.Contains(href, "keywords="):
			kind = "column"
			q := upstreamQueryValue(href, "keywords")
			if q == "" {
				return
			}
			spaURL = "/browse?q=" + url.QueryEscape(q)
		case strings.Contains(href, "type="):
			kind = "type"
			t := upstreamQueryValue(href, "type")
			if t == "" {
				return
			}
			spaURL = "/browse?type=" + url.QueryEscape(t)
		default:
			return // 其它外链不进入站内分类
		}

		links = append(links, CategoryLink{Label: label, URL: spaURL, Kind: kind})
	})
	return links, nil
}

// upstreamQueryValue 解析上游相对 URL 的查询参数值（含 %xx 解码）。
func upstreamQueryValue(rawURL, key string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(u.Query().Get(key))
}

// ExtractRecommendSections 提取扫文推荐分组
func ExtractRecommendSections(rawHTML string) ([]RecommendSection, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	root := doc.Find("#post_pre_ext_content1")
	if root.Length() == 0 {
		return []RecommendSection{}, nil
	}

	var sections []RecommendSection
	current := RecommendSection{Title: "推荐", Links: []ChapterLink{}}
	seen := make(map[string]bool)

	root.Find("a[href*='tid=']").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		tid := sanitize.ExtractTid(href)
		title := strings.TrimSpace(s.Text())
		if tid != "" && title != "" && !seen[tid] {
			seen[tid] = true
			current.Links = append(current.Links, ChapterLink{
				Index: len(current.Links) + 1,
				Title: title,
				Tid:   tid,
			})
		}
	})
	if len(current.Links) > 0 {
		sections = append(sections, current)
	}
	return sections, nil
}

// ParseCategoryPage 解析分类/关键词搜索页
func ParseCategoryPage(rawHTML, category string, page int) (*CategoryPage, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}
	var links []ChapterLink
	seen := make(map[string]bool)
	doc.Find("ul.thread-list li.l-m1 a").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		tid := sanitize.ExtractTid(href)
		title := strings.TrimSpace(s.Text())
		if tid != "" && title != "" && !seen[tid] {
			seen[tid] = true
			links = append(links, ChapterLink{
				Index: len(links) + 1,
				Title: title,
				Tid:   tid,
			})
		}
	})

	hasNext := len(links) > 0 && doc.Find("nav.pagination-bar a.next").Length() > 0
	var nextPage *int
	if hasNext {
		p := page + 1
		nextPage = &p
	}

	return &CategoryPage{
		Category: category,
		Links:    links,
		NextPage: nextPage,
	}, nil
}
