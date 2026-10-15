package xchina

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"purifier/internal/core/sanitize"
	"purifier/internal/core/upstream"
	"purifier/internal/model"
)

type ChapterItem struct {
	Index int    `json:"index"`
	Title string `json:"title"`
	N     int    `json:"n"`
}

type BookMeta struct {
	Author *string `json:"author,omitempty"`
}

type BookDetail struct {
	Title        string        `json:"title"`
	Intro        string        `json:"intro"`
	Meta         BookMeta      `json:"meta"`
	Chapters     []ChapterItem `json:"chapters"`
	Stale        bool          `json:"stale,omitempty"`
	RefreshError string        `json:"refreshError,omitempty"`
}

type ChapterDetail struct {
	Title        string   `json:"title"`
	BookTitle    string   `json:"bookTitle,omitempty"`
	Content      string   `json:"content"`
	ChapterIndex int      `json:"chapterIndex"`
	PrevChapter  *int     `json:"prevChapter,omitempty"`
	NextChapter  *int     `json:"nextChapter,omitempty"`
	Meta         BookMeta `json:"meta"`
	Stale        bool     `json:"stale,omitempty"`
	RefreshError string   `json:"refreshError,omitempty"`
}

var authorRegex = regexp.MustCompile(`作者[：:]\s*([^·\n]+)`)
var novelChapterRegex = regexp.MustCompile(`^/novel/([^/]+)/(\d+)`)

func parseChapterTitle(text string) string {
	re := regexp.MustCompile(`^\s*第\s*\d+\s*章\s*`)
	stripped := re.ReplaceAllString(text, "")
	if strings.TrimSpace(stripped) != "" {
		return strings.TrimSpace(stripped)
	}
	return strings.TrimSpace(text)
}

// ExtractToc 解析书籍目录
func ExtractToc(rawHTML string) (*BookDetail, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(doc.Find("main h1").First().Text())
	if title == "" {
		return nil, upstream.NewExtractorError("book not found", http.StatusNotFound)
	}

	metaText := doc.Find("main .tk-meta").First().Text()
	var author *string
	if m := authorRegex.FindStringSubmatch(metaText); len(m) > 1 {
		a := strings.TrimSpace(m[1])
		if a != "" {
			author = &a
		}
	}

	intro := strings.TrimSpace(doc.Find("section p.tk-body").First().Text())

	var chapters []ChapterItem
	doc.Find("#chapters-list a").Each(func(i int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		chText := strings.TrimSpace(s.Text())
		n := i + 1
		if m := novelChapterRegex.FindStringSubmatch(href); len(m) > 2 {
			if parsedN, err := strconv.Atoi(m[2]); err == nil {
				n = parsedN
			}
		}
		chapters = append(chapters, ChapterItem{
			Index: i + 1,
			Title: parseChapterTitle(chText),
			N:     n,
		})
	})

	return &BookDetail{
		Title:    title,
		Intro:    intro,
		Meta:     BookMeta{Author: author},
		Chapters: chapters,
	}, nil
}

// ExtractChapter 解析单章正文
func ExtractChapter(rawHTML string, currentChapter int, cid string) (*ChapterDetail, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(doc.Find("main h1, .read-page-chapter-title, h1").First().Text())
	bookTitle := strings.TrimSpace(doc.Find(".book-header a.book-title").First().Text())

	pageTitle := strings.TrimSpace(doc.Find("title").First().Text())
	if pageTitle != "" {
		raw := strings.Split(pageTitle, " - ")[0]
		raw = strings.Split(raw, " | ")[0]
		raw = strings.TrimSpace(raw)
		parts := strings.Fields(raw)
		if len(parts) >= 2 {
			if bookTitle == "" {
				bookTitle = parts[0]
			}
			if title == "" {
				title = parts[1]
			}
		} else if len(parts) == 1 {
			if title == "" {
				title = parts[0]
			}
		}
	}

	if title == "" {
		title = fmt.Sprintf("第 %d 章", currentChapter)
	}

	if bookTitle == "" {
		doc.Find("nav a[href^='/novel/']").Each(func(_ int, s *goquery.Selection) {
			href, _ := s.Attr("href")
			if strings.Count(href, "/") == 2 && bookTitle == "" {
				t := strings.TrimSpace(s.Text())
				if t != "" && t != "返回书页" {
					bookTitle = t
				}
			}
		})
	}

	articleSel := doc.Find("#read-article")
	if articleSel.Length() == 0 {
		return nil, upstream.NewExtractorError("chapter content not found", http.StatusNotFound)
	}

	articleHTML, _ := articleSel.Html()

	content, err := sanitize.SanitizeContentHTML(articleHTML, func(href, label string) (string, string, bool) {
		if m := novelChapterRegex.FindStringSubmatch(href); len(m) > 2 {
			cID := m[1]
			ch := m[2]
			return fmt.Sprintf("/book/%s?chapter=%s", cID, ch), label, true
		}
		return "", "", false
	}, sanitize.Options{PBreakClosing: true})
	if err != nil {
		return nil, err
	}

	var prevChapter *int
	var nextChapter *int

	doc.Find("nav[aria-label=\"本章导航\"] a[href^=\"/novel/\"]").Each(func(_ int, s *goquery.Selection) {
		href, _ := s.Attr("href")
		if m := novelChapterRegex.FindStringSubmatch(href); len(m) > 2 {
			n, _ := strconv.Atoi(m[2])
			if n == currentChapter {
				return
			}
			if n < currentChapter {
				prevChapter = &n
			} else if nextChapter == nil || n < *nextChapter {
				nextChapter = &n
			}
		}
	})

	return &ChapterDetail{
		Title:        title,
		BookTitle:    bookTitle,
		Content:      content,
		ChapterIndex: currentChapter,
		PrevChapter:  prevChapter,
		NextChapter:  nextChapter,
	}, nil
}

func ParseNovelCards(rawHTML string) []model.ChapterLink {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return []model.ChapterLink{}
	}
	var links []model.ChapterLink
	seen := make(map[string]bool)
	doc.Find("article.home-feed-item, article.list-feed-item").Each(func(_ int, s *goquery.Selection) {
		a := s.Find("a[href^='/novel/']").First()
		href, _ := a.Attr("href")
		parts := strings.Split(strings.Trim(href, "/"), "/")
		var cid string
		if len(parts) >= 2 {
			cid = parts[1]
		}
		title := strings.TrimSpace(a.Find("h3").First().Text())
		if title == "" {
			title = strings.TrimSpace(a.Text())
		}
		if cid == "" || title == "" || seen[cid] {
			return
		}
		seen[cid] = true
		links = append(links, model.ChapterLink{
			Index: len(links) + 1,
			Title: title,
			Tid:   cid,
		})
	})
	if links == nil {
		links = []model.ChapterLink{}
	}
	return links
}

func HasNextPage(rawHTML string) bool {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return false
	}
	hasNext := false
	doc.Find("nav.list-pagination a").Each(func(_ int, s *goquery.Selection) {
		if strings.TrimSpace(s.Text()) == "下一页" {
			hasNext = true
		}
	})
	return hasNext
}

// HasMoreLink 首页时间线「更多 → /novels」链接存在 → 有下一页
func HasMoreLink(rawHTML, target string) bool {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return false
	}
	found := false
	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		if found {
			return
		}
		href, _ := s.Attr("href")
		if href == target && strings.Contains(s.Text(), "更多") {
			found = true
		}
	})
	return found
}

var tagSlugRegex = regexp.MustCompile(`^/tag/([^/?#]+)$`)

// ParseCategoryLinks 解析「主题浏览」题材入口 + 「有声小说」→ CategoryLink[]。
// url 形如 /browse?type=<slug>&site=2，与 cool18 侧结构保持一致。
func ParseCategoryLinks(rawHTML string) []model.CategoryLink {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return []model.CategoryLink{}
	}
	links := []model.CategoryLink{}
	seen := make(map[string]bool)

	doc.Find("h2").Each(func(_ int, h *goquery.Selection) {
		heading := strings.TrimSpace(h.Text())
		if !strings.Contains(heading, "主题浏览") {
			return
		}
		h.Closest("section").Find("a[href^='/tag/']").Each(func(_ int, a *goquery.Selection) {
			href, _ := a.Attr("href")
			m := tagSlugRegex.FindStringSubmatch(href)
			if len(m) < 2 {
				return
			}
			slug := m[1]
			label := strings.TrimSpace(a.Text())
			if slug == "" || label == "" || seen[slug] {
				return
			}
			seen[slug] = true
			links = append(links, model.CategoryLink{
				Label: label,
				URL:   "/browse?type=" + url.QueryEscape(slug) + "&site=" + XChinaSiteID,
				Kind:  "type",
			})
		})
	})

	// 有声小说区块「更多 → /tag/999」归一为 audio
	audio := false
	doc.Find("h2").Each(func(_ int, h *goquery.Selection) {
		if audio || !strings.Contains(strings.TrimSpace(h.Text()), "有声小说") {
			return
		}
		href, _ := h.Closest("section").Find("a[href^='/tag/']").First().Attr("href")
		if href == "" {
			return
		}
		audio = true
		if seen["audio"] {
			return
		}
		seen["audio"] = true
		links = append(links, model.CategoryLink{
			Label: "有声",
			URL:   "/browse?type=audio&site=" + XChinaSiteID,
			Kind:  "type",
		})
	})

	return links
}

// ParseHotPosts 解析首页 #hot-ranking 今日热读榜（xbookcn 无阅读数，reads=0）
func ParseHotPosts(rawHTML string) []model.HotPost {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return []model.HotPost{}
	}
	posts := []model.HotPost{}
	doc.Find("#hot-ranking ol li a").Each(func(_ int, a *goquery.Selection) {
		href, _ := a.Attr("href")
		cid := cidFromHref(href)
		rankText := strings.TrimSpace(a.Find("span").First().Text())
		titleText := strings.TrimSpace(a.Find("span").Eq(1).Text())
		if titleText == "" {
			// 回退：取最后一个 span（避免把首个 span 的名次拼进标题）
			if spans := a.Find("span"); spans.Length() > 1 {
				titleText = strings.TrimSpace(spans.Last().Text())
			} else {
				titleText = strings.TrimSpace(a.Text())
			}
		}
		if cid == "" || titleText == "" {
			return
		}
		rank := len(posts) + 1
		if n, err := strconv.Atoi(rankText); err == nil {
			rank = n
		}
		posts = append(posts, model.HotPost{
			Rank:  rank,
			Title: titleText,
			Tid:   cid,
			Reads: 0,
		})
	})
	return posts
}

func cidFromHref(href string) string {
	m := novelCidRegex.FindStringSubmatch(href)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

var novelCidRegex = regexp.MustCompile(`/novel/([^/?#]+)`)
