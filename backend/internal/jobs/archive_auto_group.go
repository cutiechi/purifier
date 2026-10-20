package jobs

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"purifier/internal/model"
	"purifier/internal/storage"
)

// ArchiveAutoGroupJob 从归档目录按书名自动建组（≥ minMembers 章）。
// 与前端 lib/title-parse.ts + lib/book-groups.ts 的分组键规则保持一致。
type ArchiveAutoGroupJob struct {
	store *storage.Store
}

func NewArchiveAutoGroupJob(store *storage.Store) *ArchiveAutoGroupJob {
	return &ArchiveAutoGroupJob{store: store}
}

func (j *ArchiveAutoGroupJob) Type() string {
	return "archive_auto_group"
}

func (j *ArchiveAutoGroupJob) Run(ctx *JobContext) (any, error) {
	site := payloadSite(ctx, "1")
	if site != "1" {
		return nil, fmt.Errorf("auto group only supports forum archive (site 1), got %s", site)
	}
	minMembers := payloadMinMembers(ctx.Payload)

	posts, err := j.store.ListAllArchivePosts(ctx.Ctx, site)
	if err != nil {
		return nil, err
	}
	ctx.Log("info", fmt.Sprintf("scanned %d archive posts (minMembers=%d)", len(posts), minMembers))

	type bucket struct {
		key    string
		title  string
		author string
		genre  string
		items  []model.GroupItem
		seen   map[string]bool
	}
	buckets := make(map[string]*bucket)
	order := make([]string, 0, len(posts))

	for i, p := range posts {
		if i%100 == 0 {
			if err := ctx.Checkpoint(); err != nil {
				ctx.Log("warn", "job aborted during bucket scan")
				return nil, ErrJobStopped
			}
		}
		parsed := ParseListTitle(p.Title)
		key := NormalizeTitleKey(parsed.Title)
		if key == "" {
			continue
		}
		b, ok := buckets[key]
		if !ok {
			title := strings.TrimSpace(StripTrailingChapterMarker(parsed.Title))
			if title == "" {
				title = key
			}
			b = &bucket{key: key, title: title, author: parsed.Author, genre: parsed.Genre, seen: make(map[string]bool)}
			buckets[key] = b
			order = append(order, key)
		} else {
			if b.author == "" && parsed.Author != "" {
				b.author = parsed.Author
			}
			if b.genre == "" && parsed.Genre != "" {
				b.genre = parsed.Genre
			}
		}
		if !b.seen[p.Tid] {
			b.seen[p.Tid] = true
			b.items = append(b.items, model.GroupItem{Tid: p.Tid, Title: p.Title})
		}
	}

	eligible := make([]*bucket, 0, len(buckets))
	for _, key := range order {
		if len(buckets[key].items) >= minMembers {
			eligible = append(eligible, buckets[key])
		}
	}
	skippedSingles := len(buckets) - len(eligible)

	groupsUpserted := 0
	membersLinked := 0
	skippedConflicts := 0

	for i, b := range eligible {
		if err := ctx.Checkpoint(); err != nil {
			ctx.Log("warn", "job aborted by checkpoint")
			return nil, ErrJobStopped
		}
		sort.Slice(b.items, func(x, y int) bool {
			l, _ := strconv.ParseInt(b.items[x].Tid, 10, 64)
			r, _ := strconv.ParseInt(b.items[y].Tid, 10, 64)
			return l < r
		})

		author := optionalString(b.author)
		genre := optionalString(b.genre)
		// 只补缺失成员，绝不删除。自动任务与用户手工分组共用 key 命名空间，
		// 走全量替换会把用户维护的成员静默删掉。
		added, skipped, err := j.store.EnsureGroupMembers(ctx.Ctx, b.key, b.title, author, genre, b.items)
		if err != nil {
			return nil, err
		}
		if skipped > 0 {
			ctx.Log("warn", fmt.Sprintf("group %q: skipped %d tid(s) already in another group", b.title, skipped))
			skippedConflicts += skipped
		}
		if added > 0 {
			groupsUpserted++
			membersLinked += added
		}

		if (i+1)%25 == 0 || i+1 == len(eligible) {
			ctx.Log("info", fmt.Sprintf("grouped %d/%d (members=%d)", i+1, len(eligible), membersLinked))
			ctx.ReportProgress(map[string]any{
				"scanned":        len(posts),
				"groupsUpserted": groupsUpserted,
				"membersLinked":  membersLinked,
				"skippedSingles": skippedSingles,
				"site":           site,
			})
		}
		if (i+1)%3 == 0 {
			if err := ctx.Sleep(0); err != nil {
				return nil, ErrJobStopped
			}
		}
	}

	ctx.Log("info", fmt.Sprintf("done: upserted %d groups, %d members, skipped %d singles, %d conflicts",
		groupsUpserted, membersLinked, skippedSingles, skippedConflicts))

	return map[string]any{
		"scanned":          len(posts),
		"buckets":          len(buckets),
		"groupsUpserted":   groupsUpserted,
		"membersLinked":    membersLinked,
		"skippedSingles":   skippedSingles,
		"skippedConflicts": skippedConflicts,
		"minMembers":       minMembers,
		"site":             site,
	}, nil
}

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ParsedTitle 是列表标题的解析结果（对应前端 ParsedTitle）。
type ParsedTitle struct {
	Title   string
	Author  string
	Genre   string
	Chapter string
}

var (
	reSpaces         = regexp.MustCompile(`\s+`)
	reLeadingJunk    = regexp.MustCompile(`^[_\s]+`)
	reDecor          = regexp.MustCompile(`^[★☆◇◆]+`)
	reLeadingBracket = regexp.MustCompile(`^\[[^\]\n]+\][_\s]*`)
	reLeadingTag     = regexp.MustCompile(`^(?:迎新|辞旧|贺岁|新春|元宵)[_\s]*`)
	reOriginalAuthor = regexp.MustCompile(`\[\s*([^\]\s]+?)_\s*原创\s*\]`)
	reOriginalMark   = regexp.MustCompile(`\[\s*[^\]\s]+?_\s*原创\s*\]|\[[^\]]*原创[^\]]*\]`)
	reAIMark         = regexp.MustCompile(`\[\s*AI辅助\s*\]`)
	reGenre          = regexp.MustCompile(`『([^』]+)』\s*$`)
	reTrailingChap   = regexp.MustCompile(`(?:[（(][^）)]{1,24}[）)]\s*)+$`)
	reWrapChars      = regexp.MustCompile(`^[「《【〖［[]+|[」》】〗］\]]+$`)
	reTitleChapter   = regexp.MustCompile(`^(.*?)[（(]([^）)]{1,24})[）)]\s*$`)
	reAuthorSplit    = regexp.MustCompile(`^(.*?)\s*(?:作者|原作|译者|作\s*_?\s*者)\s*[:：_]\s*.+$`)
	reAuthorTail     = regexp.MustCompile(`^(?:原作|作者|译者|翻译|作\s*_?\s*者)\s*[:：_]\s*(.+)$`)
	reByAuthor       = regexp.MustCompile(`^(.{0,24}?)[_\s]*(?:by|ｂｙ)\s*[:：_]?\s*(.+)$`)
	reAuthorLoose    = regexp.MustCompile(`^作\s*_?\s*[:：_]\s*(.+)$`)
	reChapParen      = regexp.MustCompile(`^[（(]([^）)]+)[）)]\s*(.*)$`)
	reSentence       = regexp.MustCompile(`[。！？\s]`)
)

var titleWrappers = []*regexp.Regexp{
	regexp.MustCompile(`^【([^】]+)】(.*)$`),
	regexp.MustCompile(`^《([^》]+)》(.*)$`),
	regexp.MustCompile(`^「([^」]+)」(.*)$`),
	regexp.MustCompile(`^〖([^〗]+)〗(.*)$`),
	regexp.MustCompile(`^［([^］]+)］(.*)$`),
	regexp.MustCompile(`^\[([^\]]+)\](.*)$`),
}

// ParseListTitle 解析论坛列表标题，拆出书名/作者/题材/章节标记。
// 规则与 frontend/src/lib/title-parse.ts 对齐；分组键依赖两侧一致。
func ParseListTitle(raw string) ParsedTitle {
	s := strings.TrimSpace(reSpaces.ReplaceAllString(raw, " "))
	s = strings.TrimSpace(reLeadingJunk.ReplaceAllString(s, ""))
	s = reDecor.ReplaceAllString(s, "")
	s = reLeadingBracket.ReplaceAllString(s, "")
	s = reLeadingTag.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)

	originalAuthor := ""
	if m := reOriginalAuthor.FindStringSubmatch(s); m != nil {
		originalAuthor = strings.TrimSpace(m[1])
	}
	s = reOriginalMark.ReplaceAllString(s, "")
	s = reAIMark.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)

	genre := ""
	if m := reGenre.FindStringSubmatchIndex(s); m != nil {
		genre = strings.TrimSpace(s[m[2]:m[3]])
		s = strings.TrimSpace(s[:m[0]])
	}

	title := s
	rest := ""
	for _, re := range titleWrappers {
		if m := re.FindStringSubmatch(s); m != nil {
			title = strings.TrimSpace(m[1])
			rest = strings.TrimSpace(m[2])
			break
		}
	}
	if rest == "" && title == s {
		if m := reAuthorSplit.FindStringSubmatch(s); m != nil {
			if t := strings.TrimSpace(m[1]); utf8.RuneCountInString(t) >= 2 {
				title = t
				rest = strings.TrimSpace(s[len(t):])
			}
		}
	}

	chapter := ""
	if rest == "" {
		if m := reTitleChapter.FindStringSubmatch(title); m != nil {
			if t := strings.TrimSpace(m[1]); utf8.RuneCountInString(t) >= 2 {
				title = t
				chapter = strings.TrimSpace(m[2])
			}
		}
	}

	rest = strings.TrimSpace(reLeadingJunk.ReplaceAllString(rest, ""))
	if m := reChapParen.FindStringSubmatch(rest); m != nil {
		chapter = strings.TrimSpace(m[1])
		rest = strings.TrimSpace(reLeadingJunk.ReplaceAllString(m[2], ""))
	}

	author := ""
	if m := reAuthorTail.FindStringSubmatch(rest); m != nil {
		author = strings.TrimSpace(m[1])
		rest = ""
	} else if m := reByAuthor.FindStringSubmatch(rest); m != nil && utf8.RuneCountInString(strings.TrimSpace(m[2])) <= 32 {
		author = strings.TrimSpace(m[2])
		rest = ""
	} else if m := reAuthorLoose.FindStringSubmatch(rest); m != nil {
		author = strings.TrimSpace(m[1])
		rest = ""
	} else if rest != "" && utf8.RuneCountInString(rest) <= 16 && !reSentence.MatchString(rest) && !strings.HasPrefix(rest, "第") {
		author = rest
	}

	author = strings.Trim(strings.TrimSpace(author), "「_」")
	author = strings.TrimRight(author, "_")
	author = strings.TrimSpace(reSpaces.ReplaceAllString(author, " "))
	if author == "" {
		author = originalAuthor
	}
	if title == "" {
		title = strings.TrimSpace(raw)
	}

	return ParsedTitle{Title: title, Author: author, Genre: genre, Chapter: chapter}
}

// StripTrailingChapterMarker 去掉尾随的（…）章节标记。
func StripTrailingChapterMarker(title string) string {
	return reTrailingChap.ReplaceAllString(title, "")
}

// NormalizeTitleKey 生成分组键：去装饰括号、去章节标记、转小写。
func NormalizeTitleKey(title string) string {
	trimmed := strings.TrimSpace(reWrapChars.ReplaceAllString(title, ""))
	return strings.ToLower(strings.TrimSpace(StripTrailingChapterMarker(trimmed)))
}
