package sanitize

import (
	"html"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type LinkMapper func(href, label string) (mappedHref string, mappedLabel string, ok bool)

type Options struct {
	PBreakClosing bool // true for xchina: newline after </p>; false for cool18: only empty <p> -> newline
}

const NoiseFontColor = "E6E6DD"

func isNoiseFont(s *goquery.Selection) bool {
	color, _ := s.Attr("color")
	color = strings.ToUpper(strings.TrimPrefix(color, "#"))
	if color == NoiseFontColor {
		return true
	}
	style, _ := s.Attr("style")
	style = strings.ToUpper(strings.ReplaceAll(style, " ", ""))
	return strings.Contains(style, "COLOR:"+NoiseFontColor) || strings.Contains(style, "COLOR:#"+NoiseFontColor)
}

func SanitizeContentHTML(rawHTML string, mapLink LinkMapper, opts Options) (string, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return "", err
	}

	body := doc.Find("body")
	if body.Length() == 0 {
		body = doc.Selection
	}

	// 1. 删除噪音字体 (水印)
	doc.Find("font").Each(func(_ int, s *goquery.Selection) {
		if isNoiseFont(s) {
			s.Remove()
		}
	})

	// 2. 深度优先遍历 AST 提取正文并转义
	var sb strings.Builder

	var walk func(n *xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n == nil {
			return
		}

		switch n.Type {
		case xhtml.TextNode:
			sb.WriteString(html.EscapeString(n.Data))

		case xhtml.ElementNode:
			switch n.DataAtom {
			case atom.Br:
				sb.WriteString("\n")
				return

			case atom.P:
				pSel := goquery.NewDocumentFromNode(n).Selection
				if opts.PBreakClosing {
					// xchina: </p> 后强制换行
					for c := n.FirstChild; c != nil; c = c.NextSibling {
						walk(c)
					}
					sb.WriteString("\n")
					return
				} else {
					// cool18: 仅空 <p> 替换为换行
					if strings.TrimSpace(pSel.Text()) == "" {
						sb.WriteString("\n")
						return
					}
					for c := n.FirstChild; c != nil; c = c.NextSibling {
						walk(c)
					}
					return
				}

			case atom.A:
				aSel := goquery.NewDocumentFromNode(n).Selection
				href, _ := aSel.Attr("href")
				label := strings.TrimSpace(aSel.Text())
				if mapLink != nil {
					mappedHref, mappedLabel, ok := mapLink(href, label)
					if ok {
						if mappedLabel == "" {
							mappedLabel = label
						}
						if mappedLabel == "" {
							mappedLabel = "链接"
						}
						sb.WriteString(`<a href="` + html.EscapeString(mappedHref) + `">` + html.EscapeString(mappedLabel) + `</a>`)
						return
					}
				}
				// 外链只保留纯文字
				sb.WriteString(html.EscapeString(label))
				return

			case atom.Script, atom.Style, atom.Iframe, atom.Noscript:
				// 丢弃脚本、样式及内联嵌入
				return

			default:
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					walk(c)
				}
			}

		case xhtml.DocumentNode:
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
	}

	for _, node := range body.Nodes {
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}

	res := strings.TrimSpace(sb.String())
	return res, nil
}

// ExtractTid 从 href 中提取 tid
var tidRegex = regexp.MustCompile(`[?&]tid=(\d+)`)

func ExtractTid(href string) string {
	m := tidRegex.FindStringSubmatch(href)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}
