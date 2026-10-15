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
	if !strings.Contains(post.Content, `<a href="/read/14621195">下篇：第3-5章</a>`) {
		t.Fatalf("internal link in content should be preserved, got: %s", post.Content)
	}
	if len(post.Links) != 1 || post.Links[0].Tid != "14621196" {
		t.Fatalf("expected 1 external chapter link, got: %+v", post.Links)
	}
}
