package cool18

import (
	"strings"
	"testing"

	"purifier/internal/model"
)

func TestCollectContentTids(t *testing.T) {
	content := `<p>上文 <a href="/cool-18/14111111">上篇</a> 正文 <a href="/cool-18/14111111">重复链接</a></p>` +
		`<a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=14222222">外链应已被清洗，不匹配</a>`
	links := []model.ChapterLink{{Tid: "14333333", Title: "章节联想"}}

	got := CollectContentTids(content, links)
	want := []string{"14111111", "14333333"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("CollectContentTids = %v, want %v", got, want)
	}
}

func TestCollectReplyTids(t *testing.T) {
	replies := []ReplyNode{
		{Tid: "100", Subject: "给 红魔留名 点“赞”支持3银元奖励！！"},
		{Tid: "101", Subject: "第一章"},
		{Tid: "102", Subject: "续写在这里 https://example.com/x"},
		{Tid: "", Subject: "无 tid 应跳过"},
		{Children: []ReplyNode{
			{Tid: "103", Subject: "嵌套回复也收录"},
			{Tid: "104", Subject: "又一个银元奖励帖"},
		}},
		{Tid: "100", Subject: "重复 tid"},
	}

	got := CollectReplyTids(replies, "100")
	want := []string{"101", "102", "103"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("CollectReplyTids = %v, want %v", got, want)
	}
}

func TestCollectReplyTidsCap(t *testing.T) {
	var replies []ReplyNode
	for i := range maxHarvestPerPost + 50 {
		replies = append(replies, ReplyNode{Tid: strings.Repeat("1", i+1) + string(rune('a'+i%26)), Subject: "正文"})
	}
	if got := CollectReplyTids(replies, "self"); len(got) != maxHarvestPerPost {
		t.Fatalf("cap = %d, want %d", len(got), maxHarvestPerPost)
	}
}

// CollectReplyLinks 与 tids 同一过滤规则，但带标题：链接导航面板直接展示。
func TestCollectReplyLinks(t *testing.T) {
	replies := []ReplyNode{
		{Tid: "100", Subject: "给 红魔留名 点“赞”支持3银元奖励！！"},
		{Tid: "101", Subject: "第一章 童年"},
		{Children: []ReplyNode{
			{Tid: "103", Subject: " 嵌套回复也收录 "},
		}},
		{Tid: "self", Subject: "自身跳过"},
	}
	got := CollectReplyLinks(replies, "self")
	want := []ChapterLink{
		{Tid: "101", Title: "第一章 童年"},
		{Tid: "103", Title: "嵌套回复也收录"},
	}
	if len(got) != len(want) {
		t.Fatalf("CollectReplyLinks = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i].Tid != want[i].Tid || got[i].Title != want[i].Title {
			t.Fatalf("CollectReplyLinks[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestIsNoisyReply(t *testing.T) {
	noisy := []string{
		"给 红魔留名 点“赞”支持3银元奖励！！",
		`给 xx 点"赞"支持3银元奖励`,
		"++++++++该贴评分完成！",
		"  ",
	}
	for _, s := range noisy {
		if !isNoisyReply(s) {
			t.Errorf("isNoisyReply(%q) = false, want true", s)
		}
	}
	ok := []string{"第一章", "续写在这里", "总有人写出不一样的角度"}
	for _, s := range ok {
		if isNoisyReply(s) {
			t.Errorf("isNoisyReply(%q) = true, want false", s)
		}
	}
}
