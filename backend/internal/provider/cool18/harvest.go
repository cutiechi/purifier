package cool18

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
)

// spaTidRegex 从已清洗正文里提取站内链接 tid（清洗管道把内链改写成 /cool-18/<tid>）。
var spaTidRegex = regexp.MustCompile(`/cool-18/(\d+)`)

// maxHarvestPerPost 单帖收割上限：热门帖回复可达数百条，防止一次刷爆前沿队列。
const maxHarvestPerPost = 200

// isNoisyReply 过滤系统/应援类跟帖（不承载内容，抓取只会浪费一次上游请求）。
func isNoisyReply(subject string) bool {
	s := strings.TrimSpace(subject)
	if s == "" {
		return true
	}
	for _, n := range []string{"点“赞”", "点\"赞\"", "银元", "评分完成", "该贴评分"} {
		if strings.Contains(s, n) {
			return true
		}
	}
	return strings.HasPrefix(s, "++")
}

// CollectContentTids 收集正文站内链接与章节联想里的 tid（去重、保留顺序）。
func CollectContentTids(content string, links []ChapterLink) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(links)+8)
	add := func(tid string) {
		if tid == "" || seen[tid] {
			return
		}
		seen[tid] = true
		out = append(out, tid)
	}
	for _, m := range spaTidRegex.FindAllStringSubmatch(content, -1) {
		add(m[1])
	}
	for _, l := range links {
		add(l.Tid)
	}
	return out
}

// CollectReplyTids 收集可入库的回复 tid（回复即章节的主要入口）。
// 跳过自身与噪音跟帖，按 BFS 顺序（与 UI 层级一致），最多 maxHarvestPerPost 条。
func CollectReplyTids(nodes []ReplyNode, selfTid string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, 16)
	queue := append([]ReplyNode{}, nodes...)
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		queue = append(queue, n.Children...)
		if n.Tid == "" || n.Tid == selfTid || seen[n.Tid] {
			continue
		}
		if isNoisyReply(n.Subject) {
			continue
		}
		seen[n.Tid] = true
		out = append(out, n.Tid)
		if len(out) >= maxHarvestPerPost {
			break
		}
	}
	return out
}

// HarvestPost 抓正文（缓存优先，不抓回复），返回标题与正文内链 tid，供前沿任务使用。
func (s *Service) HarvestPost(ctx context.Context, tid string) (title string, tids []string, err error) {
	if err := upstream.AssertSafeID(tid); err != nil {
		return "", nil, upstream.NewExtractorError("invalid tid", http.StatusBadRequest)
	}
	pageURL := fmt.Sprintf("%s?app=forum&act=threadview&tid=%s", Cool18HomeURL, tid)
	cacheKey := fmt.Sprintf("%s:post:%s", Cool18SiteID, tid)

	var rawHTML string
	if cached, cErr := upstream.ReadContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, nil); cErr == nil && cached != nil {
		rawHTML = cached.Data
	}
	if rawHTML == "" {
		fetched, fErr := s.client.FetchSingleflight(ctx, cacheKey, func(fctx context.Context) (string, error) {
			return s.client.Fetch(fctx, pageURL)
		})
		if fErr != nil {
			return "", nil, fErr
		}
		rawHTML = fetched
		_ = upstream.WriteContentCache(s.dataDir, Cool18SiteID, model.KindPost, tid, rawHTML, nil)
	}

	extracted, exErr := ExtractPost(rawHTML)
	if exErr != nil {
		return "", nil, exErr
	}
	return extracted.Title, CollectContentTids(extracted.Content, extracted.Links), nil
}

// ReplyTids 抓跟帖（缓存优先）并返回可入库的回复 tid（噪音过滤），供回填任务使用。
func (s *Service) ReplyTids(ctx context.Context, tid string) ([]string, error) {
	if err := upstream.AssertSafeID(tid); err != nil {
		return nil, upstream.NewExtractorError("invalid tid", http.StatusBadRequest)
	}
	replies, err := s.getReplies(ctx, tid, false)
	if err != nil {
		return nil, err
	}
	return CollectReplyTids(replies, tid), nil
}

// enqueueHarvest 把正文内链与可入库回复 tid 记入发现前沿（失败静默：阅读不受影响）。
// 已在归档目录里的 tid 不再入队，避免每次浏览都堆无用条目。
func (s *Service) enqueueHarvest(ctx context.Context, tid string, post *ExtractedPost, replies []ReplyNode) {
	if s.store == nil || post == nil {
		return
	}
	tids := CollectContentTids(post.Content, post.Links)
	tids = append(tids, CollectReplyTids(replies, tid)...)

	seen := map[string]bool{tid: true}
	candidates := make([]string, 0, len(tids))
	for _, t := range tids {
		if seen[t] {
			continue
		}
		seen[t] = true
		candidates = append(candidates, t)
	}
	if len(candidates) == 0 {
		return
	}
	archived, err := s.store.ArchiveExistingTids(ctx, Cool18SiteID, candidates)
	if err != nil {
		return
	}
	fresh := candidates[:0]
	for _, t := range candidates {
		if !archived[t] {
			fresh = append(fresh, t)
		}
	}
	_, _ = s.store.EnqueueFrontier(ctx, Cool18SiteID, fresh, tid, 1)
}
