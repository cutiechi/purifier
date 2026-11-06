package storage

import (
	"regexp"
	"strings"
	"unicode"
)

// 分组键归一化规则与前端 lib/title-parse.ts 的 normalizeTitleKey 保持一致，
// 消费方：分组表 key、archive_auto_group 任务。改规则必须两端同步，
// 且先评估存量 groups.key（迁移按「旧管道输出去标点 = 新 key」重写）。

var (
	reTrailingChap = regexp.MustCompile(`(?:[（(][^）)]{1,24}[）)]\s*)+$`)
	reWrapChars    = regexp.MustCompile(`^[「《【〖［[]+|[」》】〗］\]]+$`)
)

// StripTrailingChapterMarker 去掉尾随的（…）章节标记。
func StripTrailingChapterMarker(title string) string {
	return reTrailingChap.ReplaceAllString(title, "")
}

// NormalizeTitleKey 生成分组键：去装饰括号、去章节标记、去标点/符号/空白
//（同书名标点有无、顿号逗号差异均收敛到同一 key）、转小写。
func NormalizeTitleKey(title string) string {
	trimmed := strings.TrimSpace(reWrapChars.ReplaceAllString(title, ""))
	key := strings.ToLower(StripTrailingChapterMarker(trimmed))
	return strings.Map(func(r rune) rune {
		if unicode.IsPunct(r) || unicode.IsSymbol(r) || unicode.IsSpace(r) {
			return -1
		}
		return r
	}, key)
}
