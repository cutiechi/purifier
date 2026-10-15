package sanitize

import (
	"testing"
)

func TestSanitizeContentHTML(t *testing.T) {
	input := `
		<div>
			第一段<br>第二行
			<font color="#E6E6DD">这是水印噪音</font>
			<font style="color: #E6E6DD">这是样式水印</font>
			<p>一个段落</p>
			<script>alert("bad")</script>
			<a href="https://example.com/read?tid=12345">章节1</a>
			<a href="https://other.com">外部链接</a>
		</div>
	`

	res, err := SanitizeContentHTML(input, func(href, label string) (string, string, bool) {
		tid := ExtractTid(href)
		if tid != "" {
			return "/read/" + tid, label, true
		}
		return "", "", false
	}, Options{PBreakClosing: false})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if contains(res, "水印") {
		t.Fatalf("watermark should be removed, got: %s", res)
	}
	if contains(res, "bad") {
		t.Fatalf("script should be removed, got: %s", res)
	}
	if !contains(res, "第一段\n第二行") {
		t.Fatalf("br should become newline, got: %s", res)
	}
	if !contains(res, `<a href="/read/12345">章节1</a>`) {
		t.Fatalf("internal link should be preserved, got: %s", res)
	}
	if contains(res, `href="https://other.com"`) {
		t.Fatalf("external link href should be stripped, got: %s", res)
	}
	if !contains(res, "外部链接") {
		t.Fatalf("external link text should remain, got: %s", res)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || (len(s) > 0 && len(substr) > 0 && stringContains(s, substr)))
}

func stringContains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
