package xchina

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"purifier/internal/core/sanitize"
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
	Title    string        `json:"title"`
	Intro    string        `json:"intro"`
	Meta     BookMeta      `json:"meta"`
	Chapters []ChapterItem `json:"chapters"`
}

type ChapterDetail struct {
	Title        string   `json:"title"`
	BookTitle    string   `json:"bookTitle,omitempty"`
	Content      string   `json:"content"`
	ChapterIndex int      `json:"chapterIndex"`
	PrevChapter  *int     `json:"prevChapter,omitempty"`
	NextChapter  *int     `json:"nextChapter,omitempty"`
	Meta         BookMeta `json:"meta"`
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
		return nil, fmt.Errorf("book not found: 404")
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
		return nil, fmt.Errorf("article content not found: 404")
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

