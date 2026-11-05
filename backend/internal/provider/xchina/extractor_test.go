package xchina

import (
	"strings"
	"testing"
)

// 目录页：标题、作者、简介、章节序号都必须从真实结构里取到。
// 上游改版时这些断言会先失败，而不是让正文静默变空。
func TestExtractToc(t *testing.T) {
	rawHTML := `<!DOCTYPE html>
<html><body>
<main>
  <h1>测试书名</h1>
  <div class="tk-meta">作者：某作者 · 连载中</div>
  <section><p class="tk-body">这是一段简介。</p></section>
  <div id="chapters-list">
    <a href="/novel/abc123/1">第 1 章 开端</a>
    <a href="/novel/abc123/2">第 2 章 转折</a>
    <a href="/novel/abc123/7">第七章 尾声</a>
  </div>
</main>
</body></html>`

	detail, err := ExtractToc(rawHTML)
	if err != nil {
		t.Fatalf("ExtractToc failed: %v", err)
	}
	if detail.Title != "测试书名" {
		t.Fatalf("title = %q, want 测试书名", detail.Title)
	}
	if detail.Meta.Author == nil || *detail.Meta.Author != "某作者" {
		t.Fatalf("author = %v, want 某作者", detail.Meta.Author)
	}
	if detail.Intro != "这是一段简介。" {
		t.Fatalf("intro = %q", detail.Intro)
	}
	if len(detail.Chapters) != 3 {
		t.Fatalf("chapters = %d, want 3", len(detail.Chapters))
	}
	// Index 是列表序号，N 是 URL 里的真实章节号，两者不能混用。
	if detail.Chapters[0].Index != 1 || detail.Chapters[0].N != 1 {
		t.Fatalf("chapter[0] = %+v", detail.Chapters[0])
	}
	if detail.Chapters[2].Index != 3 || detail.Chapters[2].N != 7 {
		t.Fatalf("chapter[2] = %+v, want index 3 n 7", detail.Chapters[2])
	}
	// 「第 N 章」前缀要剥掉，只剩章节名。
	if detail.Chapters[0].Title != "开端" {
		t.Fatalf("chapter title = %q, want 开端", detail.Chapters[0].Title)
	}
	if detail.Chapters[2].Title != "尾声" {
		t.Fatalf("chapter title = %q, want 尾声", detail.Chapters[2].Title)
	}
}

// 目录页没有 h1 时视为书不存在，返回 404 语义的 ExtractorError。
func TestExtractTocMissingBook(t *testing.T) {
	if _, err := ExtractToc(`<html><body><main></main></body></html>`); err == nil {
		t.Fatal("expected error for missing book title")
	}
}

// 正文：站内章节链接改写为 SPA 路由，外链丢弃，水印字体剥除，
// 并且上下章从导航里推出来。
func TestExtractChapter(t *testing.T) {
	rawHTML := `<!DOCTYPE html>
<html><head><title>测试书名 - 第 2 章 转折</title></head>
<body>
<main>
  <h1>第 2 章 转折</h1>
  <div id="read-article">
    <p>正文第一段。</p>
    <p><a href="/novel/abc123/3">下一章</a> <a href="https://evil.example.com/x">外链</a></p>
    <p><font color="#E6E6DD">水印噪音</font></p>
  </div>
  <nav aria-label="本章导航">
    <a href="/novel/abc123/1">上一章</a>
    <a href="/novel/abc123/3">下一章</a>
  </nav>
</main>
</body></html>`

	ch, err := ExtractChapter(rawHTML, 2, "abc123")
	if err != nil {
		t.Fatalf("ExtractChapter failed: %v", err)
	}
	if ch.Title != "第 2 章 转折" {
		t.Fatalf("title = %q", ch.Title)
	}
	if !strings.Contains(ch.Content, "正文第一段。") {
		t.Fatalf("content missing body text: %s", ch.Content)
	}
	if strings.Contains(ch.Content, "水印噪音") {
		t.Fatalf("watermark font should be removed: %s", ch.Content)
	}
	if !strings.Contains(ch.Content, `href="/xbook-cn/abc123?chapter=3"`) {
		t.Fatalf("internal chapter link should be rewritten: %s", ch.Content)
	}
	if strings.Contains(ch.Content, "evil.example.com") {
		t.Fatalf("external link should be dropped: %s", ch.Content)
	}
	if ch.PrevChapter == nil || *ch.PrevChapter != 1 {
		t.Fatalf("prevChapter = %v, want 1", ch.PrevChapter)
	}
	if ch.NextChapter == nil || *ch.NextChapter != 3 {
		t.Fatalf("nextChapter = %v, want 3", ch.NextChapter)
	}
}

// 正文容器缺失必须报错，不能返回空字符串让前端显示空白页。
func TestExtractChapterMissingArticle(t *testing.T) {
	if _, err := ExtractChapter(`<html><body><main><h1>空</h1></main></body></html>`, 1, "abc"); err == nil {
		t.Fatal("expected error when #read-article is missing")
	}
}

// 更新流卡片：cid 从 href 取，标题从 h3 取，重复 cid 只保留第一次。
func TestParseNovelCards(t *testing.T) {
	rawHTML := `<html><body>
<article class="home-feed-item">
  <a href="/novel/abc123"><h3>书甲</h3></a>
</article>
<article class="list-feed-item">
  <a href="/novel/def456"><h3>书乙</h3></a>
</article>
<article class="home-feed-item">
  <a href="/novel/abc123"><h3>书甲重复</h3></a>
</article>
</body></html>`

	links := ParseNovelCards(rawHTML)
	if len(links) != 2 {
		t.Fatalf("links = %d, want 2 (dedup by cid)", len(links))
	}
	if links[0].Tid != "abc123" || links[0].Title != "书甲" {
		t.Fatalf("links[0] = %+v", links[0])
	}
	if links[1].Index != 2 {
		t.Fatalf("index = %d, want 2", links[1].Index)
	}
}

// 题材入口：只认「主题浏览」小节下的 /tag/ 链接，并拼成站内 browse 路由。
func TestParseCategoryLinks(t *testing.T) {
	rawHTML := `<html><body>
<section>
  <h2>主题浏览</h2>
  <a href="/tag/fantasy">奇幻</a>
  <a href="/tag/scifi">科幻</a>
  <a href="/tag/fantasy">奇幻重复</a>
  <a href="/other/x">噪声</a>
</section>
<section>
  <h2>无关小节</h2>
  <a href="/tag/ignored">应忽略</a>
</section>
</body></html>`

	links := ParseCategoryLinks(rawHTML)
	if len(links) != 2 {
		t.Fatalf("links = %d, want 2", len(links))
	}
	if links[0].Label != "奇幻" || links[0].URL != "/xbook-cn/browse?type=fantasy" {
		t.Fatalf("links[0] = %+v", links[0])
	}
	for _, l := range links {
		if strings.Contains(l.URL, "ignored") {
			t.Fatalf("link outside 主题浏览 should be ignored: %+v", l)
		}
	}
}
