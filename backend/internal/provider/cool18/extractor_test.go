package cool18

import (
	"strings"
	"testing"
)

func TestExtractPost(t *testing.T) {
	rawHTML := `<!DOCTYPE html>
<html>
<head>
    <title>【清冷师尊的另一面】（1-2）作者：山山月 - 禁忌书屋 cool18</title>
</head>
<body>
    <h1 class="main-title">【清冷师尊的另一面】（1-2）作者：山山月</h1>
    <div class="sender">由 <a href="#">红魔留名</a> [侠客] 于 2026-09-21 03:23:24 </div>
    <div class="views">已读 98,403 次 12 赞</div>
    <div id="content-section">
        <pre>第一章　　疼。<br />　　这是燕星宇恢复意识后的第一个感觉。<br /><font color="#E6E6DD">水印噪音</font><br />正文测试内容。<a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=14621195">下篇：第3-5章</a></pre>
        <a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=14621196">扩展章节：第6-9章</a>
    </div>
</body>
</html>`

	post, err := ExtractPost(rawHTML)
	if err != nil {
		t.Fatalf("ExtractPost failed: %v", err)
	}

	if post.Title != "【清冷师尊的另一面】（1-2）作者：山山月" {
		t.Fatalf("unexpected title: %s", post.Title)
	}
	if !strings.Contains(post.Content, "第一章　　疼。") {
		t.Fatalf("content should contain text, got: %s", post.Content)
	}
	if strings.Contains(post.Content, "水印噪音") {
		t.Fatalf("watermark font should be removed, got: %s", post.Content)
	}
	if !strings.Contains(post.Content, `<a href="/cool-18/14621195">下篇：第3-5章</a>`) {
		t.Fatalf("internal link in content should be preserved, got: %s", post.Content)
	}
	if len(post.Links) != 1 || post.Links[0].Tid != "14621196" {
		t.Fatalf("expected 1 external chapter link, got: %+v", post.Links)
	}
}

// 回归：父帖先于子帖出现时，子回复不得丢失（原实现按值拷贝建树会丢）
func TestBuildReplyTreeParentBeforeChild(t *testing.T) {
	raw := `[
	  {"tid":"10","uptid":"1","rootid":"1","uid":"u1","username":"父","subject":"父帖","dateline":"d1"},
	  {"tid":"11","uptid":"10","rootid":"1","uid":"u2","username":"子A","subject":"子A","dateline":"d2"},
	  {"tid":"12","uptid":"10","rootid":"1","uid":"u3","username":"子B","subject":"子B","dateline":"d3"},
	  {"tid":"13","uptid":"12","rootid":"1","uid":"u4","username":"孙","subject":"孙","dateline":"d4"}
	]`

	roots, err := BuildReplyTree(raw, "1")
	if err != nil {
		t.Fatalf("BuildReplyTree failed: %v", err)
	}
	if len(roots) != 1 {
		t.Fatalf("want 1 root, got %d", len(roots))
	}
	if len(roots[0].Children) != 2 {
		t.Fatalf("want 2 children on parent, got %d", len(roots[0].Children))
	}
	var childB *ReplyNode
	for i := range roots[0].Children {
		if roots[0].Children[i].Tid == "12" {
			childB = &roots[0].Children[i]
		}
	}
	if childB == nil {
		t.Fatal("child 12 missing")
	}
	if len(childB.Children) != 1 || childB.Children[0].Tid != "13" {
		t.Fatalf("want grandchild 13 under 12, got %+v", childB.Children)
	}
}

// 回归：子帖先于父帖出现时同样不得丢失
func TestBuildReplyTreeChildBeforeParent(t *testing.T) {
	raw := `[
	  {"tid":"21","uptid":"20","rootid":"1","username":"子","subject":"子"},
	  {"tid":"20","uptid":"1","rootid":"1","username":"父","subject":"父"}
	]`
	roots, err := BuildReplyTree(raw, "1")
	if err != nil {
		t.Fatalf("BuildReplyTree failed: %v", err)
	}
	if len(roots) != 1 || roots[0].Tid != "20" {
		t.Fatalf("want single root 20, got %+v", roots)
	}
	if len(roots[0].Children) != 1 || roots[0].Children[0].Tid != "21" {
		t.Fatalf("want child 21, got %+v", roots[0].Children)
	}
}

// 回归：互引 uptid（环）不得导致无限递归
func TestBuildReplyTreeCycleTerminates(t *testing.T) {
	raw := `[
	  {"tid":"30","uptid":"31","rootid":"1","subject":"a"},
	  {"tid":"31","uptid":"30","rootid":"1","subject":"b"}
	]`
	if _, err := BuildReplyTree(raw, "1"); err != nil {
		t.Fatalf("BuildReplyTree on cycle failed: %v", err)
	}
}

// 回归：栏目链接必须是 SPA 内部 /browse 路由，不能透出上游相对 URL
func TestExtractCategoryLinksAreSPARoutes(t *testing.T) {
	html := `<div class="ext_org_title">
      <a href="index.php?act=threadsearch&app=forum&keywords=原创&submit=栏目搜索&first=1&p=0">书屋原创区</a>
      <a href="index.php?action=search&act=threadsearch&app=forum&type=%E9%83%BD%E5%B8%82&submit=%E6%9F%A5%E8%AF%A2">都市</a>
      <a href="https://evil.example.com/x">外链</a>
    </div>`

	links, err := ExtractCategoryLinks(html)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 {
		t.Fatalf("want 2 links (外链被剔除), got %d: %+v", len(links), links)
	}
	for _, l := range links {
		if !strings.HasPrefix(l.URL, "/cool-18/browse?") {
			t.Errorf("url must be an internal /cool-18/browse route, got %q", l.URL)
		}
		if l.Label == "" {
			t.Errorf("missing label for %q", l.URL)
		}
	}
	if links[0].URL != "/cool-18/browse?q=%E5%8E%9F%E5%88%9B" {
		t.Errorf("column link wrong: %q", links[0].URL)
	}
	if links[1].URL != "/cool-18/browse?type=%E9%83%BD%E5%B8%82" {
		t.Errorf("type link wrong: %q", links[1].URL)
	}
	if links[0].Kind != "column" || links[1].Kind != "type" {
		t.Errorf("kinds wrong: %q / %q", links[0].Kind, links[1].Kind)
	}
}
