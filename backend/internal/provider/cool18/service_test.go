package cool18

import (
	"context"
	"net/url"
	"reflect"
	"testing"
)

// ParseCategoryPage 可解析的最小搜索结果页：单条命中。
const searchHitHTML = `<ul class="thread-list">` +
	`<li class="l-m1"><a href="index.php?app=forum&amp;act=threadview&amp;tid=14527517">【被觊觎的媚肉 祭品之妻·宿命】（1-2）作者：结城彩雨</a></li>` +
	`</ul>`

const emptyListHTML = `<ul class="thread-list"></ul>`

func fakeFetch(pages map[string]string, queries *[]string) func(context.Context, string) (string, error) {
	return func(_ context.Context, target string) (string, error) {
		u, err := url.Parse(target)
		if err != nil {
			return "", err
		}
		kw := u.Query().Get("keywords")
		*queries = append(*queries, kw)
		if html, ok := pages[kw]; ok && html != "" {
			return html, nil
		}
		return emptyListHTML, nil
	}
}

// 整串多词查询上游恒空：必须按 token 长度降序回退，首个非空 token 生效。
func TestSearchKeywordsFallsBackToLongestToken(t *testing.T) {
	var queries []string
	pages := map[string]string{"祭品之妻·宿命": searchHitHTML}
	svc := &Service{}

	res, err := svc.searchKeywords(context.Background(), fakeFetch(pages, &queries), "被觊觎的媚肉 祭品之妻·宿命", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Links) != 1 || res.Links[0].Tid != "14527517" {
		t.Fatalf("expected fallback hit tid=14527517, got %+v", res.Links)
	}
	if res.Category != "祭品之妻·宿命" {
		t.Errorf("category should echo effective token, got %q", res.Category)
	}
	if res.NextPage != nil {
		t.Errorf("no pagination bar in fixture, got nextPage=%v", *res.NextPage)
	}
	// 顺序：整串 → 最长 token 命中即停（不再请求更短 token 与前缀截断）
	want := []string{"被觊觎的媚肉 祭品之妻·宿命", "祭品之妻·宿命"}
	if !reflect.DeepEqual(queries, want) {
		t.Errorf("queries = %v, want %v", queries, want)
	}
}

// 单个长词（无 token 可拆）整串空手时，按 6/4 字前缀截断逐级放宽；含空白的多词前缀被跳过。
func TestSearchKeywordsFallsBackToPrefixTruncation(t *testing.T) {
	var queries []string
	pages := map[string]string{"催眠！清纯巨": searchHitHTML}
	svc := &Service{}

	res, err := svc.searchKeywords(context.Background(), fakeFetch(pages, &queries), "催眠！清纯巨乳肥臀校花被强迫在教室里进行课后辅导", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Links) != 1 || res.Links[0].Tid != "14527517" {
		t.Fatalf("expected prefix fallback hit tid=14527517, got %+v", res.Links)
	}
	if res.Category != "催眠！清纯巨" {
		t.Errorf("category should echo effective prefix, got %q", res.Category)
	}
	// 顺序：整串 → 6 字前缀命中即停（不再请求 4 字前缀）
	want := []string{"催眠！清纯巨乳肥臀校花被强迫在教室里进行课后辅导", "催眠！清纯巨"}
	if !reflect.DeepEqual(queries, want) {
		t.Errorf("queries = %v, want %v", queries, want)
	}

	// 多词且全部回退为空：含空白的前缀不请求，最短 4 字前缀兜底
	queries = nil
	pages = map[string]string{"公主在下": searchHitHTML}
	res, err = svc.searchKeywords(context.Background(), fakeFetch(pages, &queries), "公主在下我在上 其他 续写", 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.Category != "公主在下" {
		t.Fatalf("expected 4-char prefix fallback, got category=%q", res.Category)
	}
	want = []string{"公主在下我在上 其他 续写", "公主在下我在上", "其他", "续写", "公主在下我在", "公主在下"}
	if !reflect.DeepEqual(queries, want) {
		t.Errorf("queries = %v, want %v", queries, want)
	}
}

// 整串命中时不多打上游；全部为空时回显原始整串。
func TestSearchKeywordsNoFallbackWhenFullQueryHits(t *testing.T) {
	var queries []string
	pages := map[string]string{"宿命": searchHitHTML}
	svc := &Service{}

	res, err := svc.searchKeywords(context.Background(), fakeFetch(pages, &queries), "宿命", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Links) != 1 || res.Category != "宿命" {
		t.Fatalf("expected direct hit for 宿命, got category=%q links=%+v", res.Category, res.Links)
	}
	if len(queries) != 1 {
		t.Errorf("single-token query must not fallback, queries = %v", queries)
	}

	queries = nil
	res, err = svc.searchKeywords(context.Background(), fakeFetch(nil, &queries), "不存在的书名 上/下 全集", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Links) != 0 || res.Category != "不存在的书名 上/下 全集" {
		t.Fatalf("expected empty result echoing original query, got category=%q links=%+v", res.Category, res.Links)
	}
}

func TestSearchTokens(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"祭品之妻", nil},
		{"被觊觎的媚肉 祭品之妻·宿命", []string{"祭品之妻·宿命", "被觊觎的媚肉"}},
		{"a bb ccc dddd eeeee", []string{"eeeee", "dddd", "ccc"}}, // 最多 3 个
		{"  多  空格   拆分  ", []string{"空格", "拆分", "多"}},
	}
	for _, c := range cases {
		if got := searchTokens(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("searchTokens(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestPrefixTruncations(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"催眠！清纯巨乳肥臀校花被强迫在教室里进行课后辅导", []string{"催眠！清纯巨", "催眠！清"}},
		{"界能", nil}, // 不长于最短窗口
		{"公主在下我在上", []string{"公主在下我在", "公主在下"}},
		{"被觊觎的媚肉 祭品之妻·宿命", []string{"被觊觎的媚肉", "被觊觎的"}}, // 6/4 字前缀均不含空白，保留
	}
	for _, c := range cases {
		if got := prefixTruncations(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("prefixTruncations(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
