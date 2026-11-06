package jobs

import (
	"testing"

	"purifier/internal/storage"
)

// 分组键必须与前端 title-parse 规则一致，否则自动分组与前端折叠分组会分叉。
func TestParseListTitleGroupKey(t *testing.T) {
	cases := []struct {
		raw   string
		key   string
		title string
	}{
		// 省略号、逗号等标点在新规则下从 key 中去除。
		{"【马屌少年…】（第三部 1-2）作者：热爱生活的小东『都市』", "马屌少年", "马屌少年…"},
		{"为妻子种下一片森林（13）[原创]『都市』", "为妻子种下一片森林", "为妻子种下一片森林"},
		{"【安环之乱】（01-22）作 者:可乐瓶子[原创]", "安环之乱", "安环之乱"},
		{"种魔（2）作者：随风", "种魔", "种魔"},
	}
	for _, c := range cases {
		p := ParseListTitle(c.raw)
		if got := storage.NormalizeTitleKey(p.Title); got != c.key {
			t.Errorf("%q → key %q, want %q", c.raw, got, c.key)
		}
		if got := storage.StripTrailingChapterMarker(p.Title); got != c.title {
			t.Errorf("%q → title %q, want %q", c.raw, got, c.title)
		}
	}
}

// 归一化必须把同一书名的不同章节收敛到同一 key。
func TestNormalizeTitleKeyCollapsesChapters(t *testing.T) {
	pairs := [][2]string{
		{"种魔（2）", "种魔（3）"},
		{"种魔（完）", "种魔"},
		{"《种魔》（2）", "种魔"},
	}
	for _, p := range pairs {
		a := storage.NormalizeTitleKey(storage.StripTrailingChapterMarker(p[0]))
		b := storage.NormalizeTitleKey(storage.StripTrailingChapterMarker(p[1]))
		if a != b {
			t.Errorf("%q vs %q → %q != %q", p[0], p[1], a, b)
		}
	}
}

// 同书名标点有无、顿号/逗号差异必须收敛到同一 key（主帖与跟帖标题常不一致）。
func TestNormalizeTitleKeyIgnoresPunctuation(t *testing.T) {
	variants := []string{
		"我的妈妈，我的孕母，我的母马",
		"我的妈妈、我的孕母、我的母马",
		"我的妈妈 我的孕母 我的母马",
		"我的妈妈我的孕母我的母马",
		"我的妈妈，我的孕母、我的母马",
		"我的妈妈， 我的孕母 ，我的母马 ",
	}
	want := storage.NormalizeTitleKey(variants[0])
	if want == "" {
		t.Fatal("sanity: empty key")
	}
	for _, v := range variants[1:] {
		if got := storage.NormalizeTitleKey(v); got != want {
			t.Errorf("%q → %q, want %q", v, got, want)
		}
	}
	// 标点差异不合并不同书名。
	if storage.NormalizeTitleKey("种魔") == storage.NormalizeTitleKey("种魔传") {
		t.Error("distinct titles must not collide")
	}
}

// 增量停止必须由「本页 0 新增」或「达到上轮深度」任一触发，
// 不能要求两者同时成立——否则第 1 页总有新书时永远退化成全量重扫。
func TestIncrementalStopConditionsAreIndependent(t *testing.T) {
	cases := []struct {
		name          string
		mode          string
		pageInserted  int
		pages         int
		savedDepth    int
		wantStop      bool
		wantReasonKey string
	}{
		{"full never stops early", "full", 0, 99, 10, false, ""},
		{"caught up on page 1", "incremental", 0, 1, 200, true, "incremental_caught_up"},
		{"reached depth with new books", "incremental", 5, 200, 200, true, "incremental_depth_reached"},
		{"new books, below depth", "incremental", 5, 50, 200, false, ""},
		{"no saved depth, still running", "incremental", 3, 1, 0, false, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStop, gotReason := incrementalStop(tc.mode, tc.pageInserted, tc.pages, tc.savedDepth)
			if gotStop != tc.wantStop {
				t.Fatalf("stop=%v want %v", gotStop, tc.wantStop)
			}
			if gotReason != tc.wantReasonKey {
				t.Fatalf("reason=%q want %q", gotReason, tc.wantReasonKey)
			}
		})
	}
}
