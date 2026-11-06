package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"purifier/internal/model"
)

func newTestDB(t *testing.T) *Store {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db)
}

// 同一 tid 不得同时出现在两个分组里；冲突必须是可识别的 409 语义错误。
func TestUpsertGroupRejectsCrossGroupTid(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	if _, err := s.UpsertGroup(ctx, "book-a", "Book A", nil, nil, []model.GroupItem{{Tid: "1", Title: "A1"}}); err != nil {
		t.Fatalf("first group: %v", err)
	}

	_, err := s.UpsertGroup(ctx, "book-b", "Book B", nil, nil, []model.GroupItem{{Tid: "1", Title: "A1"}})
	if err == nil {
		t.Fatal("expected conflict when tid belongs to another group")
	}
	if err != ErrTidInOtherGroup {
		t.Fatalf("expected ErrTidInOtherGroup, got %v", err)
	}

	// 冲突不应留下半成品分组
	groups, err := s.ListGroups(ctx, GroupListQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 1 {
		t.Fatalf("expected 1 group after rejected upsert, got %d", groups.Total)
	}
}

// upsert 的 items 是整体替换：移出的成员不能再被加回来。
func TestUpsertGroupReplacesMembers(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	g, err := s.UpsertGroup(ctx, "book", "Book", nil, nil, []model.GroupItem{
		{Tid: "1", Title: "c1"},
		{Tid: "2", Title: "c2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Items) != 2 {
		t.Fatalf("expected 2 members, got %d", len(g.Items))
	}

	g, err = s.UpsertGroup(ctx, "book", "Book", nil, nil, []model.GroupItem{{Tid: "1", Title: "c1"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Items) != 1 || g.Items[0].Tid != "1" {
		t.Fatalf("expected only tid 1 after replacement, got %+v", g.Items)
	}

	// 移出的 tid 现在可以加入别的分组（唯一性只约束成员归属）
	if _, err := s.UpsertGroup(ctx, "book-2", "Book 2", nil, nil, []model.GroupItem{{Tid: "2", Title: "c2"}}); err != nil {
		t.Fatalf("removed tid should be reusable, got %v", err)
	}
}

// 分组列表必须分页：没有 page/limit 也不能返回全量。
func TestListGroupsAlwaysPaginates(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	for i := range 30 {
		key := string(rune('a' + i))
		if _, err := s.UpsertGroup(ctx, key, "T"+key, nil, nil, []model.GroupItem{{Tid: key, Title: key}}); err != nil {
			t.Fatal(err)
		}
	}

	res, err := s.ListGroups(ctx, GroupListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Items) != PageSize {
		t.Fatalf("expected default page size %d, got %d", PageSize, len(res.Items))
	}
	if res.NextPage == nil {
		t.Fatal("expected nextPage on a truncated list")
	}
	if res.Total != 30 {
		t.Fatalf("expected total 30, got %d", res.Total)
	}

	// 成员必须一次批量填充，不能是空数组
	for _, g := range res.Items {
		if len(g.Items) != 1 {
			t.Fatalf("group %s missing members: %+v", g.Key, g.Items)
		}
	}
}

// 归档 upsert 必须区分新增与更新，且标题未变时不刷新 archived_at。
func TestUpsertArchivePostsCountsAndKeepsArchivedAt(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	old := time.Now().Add(-24 * time.Hour).UnixMilli()
	inserted, updated, err := s.UpsertArchivePosts(ctx, []model.ArchivePost{
		{Site: "1", Tid: "10", Title: "t10", FirstSeenAt: old, ArchivedAt: old},
	})
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 1 || updated != 0 {
		t.Fatalf("first pass: inserted=%d updated=%d", inserted, updated)
	}

	// 标题未变：既不算新增也不算更新，archived_at 保持原值
	now := time.Now().UnixMilli()
	inserted, updated, err = s.UpsertArchivePosts(ctx, []model.ArchivePost{
		{Site: "1", Tid: "10", Title: "t10", FirstSeenAt: now, ArchivedAt: now},
	})
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 0 || updated != 0 {
		t.Fatalf("unchanged pass: inserted=%d updated=%d", inserted, updated)
	}
	res, err := s.ListArchivePosts(ctx, "1", "", 1, 10, "tid", "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Items[0].ArchivedAt != old {
		t.Fatalf("archived_at was refreshed: got %d want %d", res.Items[0].ArchivedAt, old)
	}

	// 标题变化：算更新
	inserted, updated, err = s.UpsertArchivePosts(ctx, []model.ArchivePost{
		{Site: "1", Tid: "10", Title: "t10 renamed", FirstSeenAt: now, ArchivedAt: now},
		{Site: "1", Tid: "11", Title: "t11", FirstSeenAt: now, ArchivedAt: now},
	})
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 1 || updated != 1 {
		t.Fatalf("changed pass: inserted=%d updated=%d", inserted, updated)
	}
}

// 导出必须是可解析的完整 JSON，且是单事务快照。
func TestExportBackupIsValidSnapshot(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	if _, _, err := s.UpsertArchivePosts(ctx, []model.ArchivePost{{Site: "1", Tid: "7", Title: "seven", FirstSeenAt: 1, ArchivedAt: 1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertGroup(ctx, "g", "G", nil, nil, []model.GroupItem{{Tid: "7", Title: "seven"}}); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := s.ExportBackup(ctx, &buf); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Version      int                 `json:"version"`
		ArchivePosts []model.ArchivePost `json:"archive_posts"`
		Groups       []map[string]any    `json:"groups"`
	}
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if got.Version != ExportVersion {
		t.Fatalf("version %d", got.Version)
	}
	if len(got.ArchivePosts) != 1 || got.ArchivePosts[0].Tid != "7" {
		t.Fatalf("archive posts missing: %+v", got.ArchivePosts)
	}
	if len(got.Groups) != 1 {
		t.Fatalf("groups missing: %+v", got.Groups)
	}
}

// v2 迁移：脏库里的重复 tid 要去重成一条，且必须真的建成 UNIQUE 索引——
// 同名但非 UNIQUE 的旧索引不能被 IF NOT EXISTS 静默放过。
func TestMigrateV2MakesTidIndexUnique(t *testing.T) {
	dir := t.TempDir()
	db, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// 回退到「v2 之前 + 已存在同名普通索引」的状态，再跑一次迁移。
	for _, stmt := range []string{
		"DROP INDEX IF EXISTS group_items_tid_unique",
		"CREATE INDEX group_items_tid_unique ON group_items(tid)",
		"PRAGMA user_version = 1",
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	now := time.Now().UnixMilli()
	if _, err := db.Exec(`INSERT INTO groups (key,title,created_at,updated_at) VALUES ('a','A',?,?),('b','B',?,?)`, now, now, now, now); err != nil {
		t.Fatalf("seed groups: %v", err)
	}
	// tid 9 同时挂在两个组；较早的 added_at 在组 2。
	if _, err := db.Exec(`INSERT INTO group_items (group_id,tid,title,added_at) VALUES
		(1,'9','late',?), (2,'9','early',?), (2,'10','other',?)`, now, now-1000, now); err != nil {
		t.Fatalf("seed items: %v", err)
	}
	_ = db.Close()

	db2, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()

	var ver int
	if err := db2.Get(&ver, "PRAGMA user_version"); err != nil || ver != SchemaVersion() {
		t.Fatalf("user_version=%d want %d (%v)", ver, SchemaVersion(), err)
	}

	var ddl string
	if err := db2.Get(&ddl, "SELECT sql FROM sqlite_master WHERE name='group_items_tid_unique'"); err != nil {
		t.Fatalf("read index: %v", err)
	}
	if !strings.Contains(strings.ToUpper(ddl), "UNIQUE") {
		t.Fatalf("index is not UNIQUE: %s", ddl)
	}

	// 去重保留 added_at 最早的那条（组 2 / 'early'）。
	var rows []struct {
		GroupID int64  `db:"group_id"`
		Tid     string `db:"tid"`
		Title   string `db:"title"`
	}
	if err := db2.Select(&rows, "SELECT group_id,tid,title FROM group_items WHERE tid='9'"); err != nil {
		t.Fatalf("select: %v", err)
	}
	if len(rows) != 1 || rows[0].GroupID != 2 || rows[0].Title != "early" {
		t.Fatalf("dedupe kept %+v, want one row (group 2, early)", rows)
	}

	// 唯一索引生效：再插同一 tid 必须失败。
	if _, err := db2.Exec(`INSERT INTO group_items (group_id,tid,title,added_at) VALUES (1,'9','dup',?)`, now); err == nil {
		t.Fatal("unique index did not reject duplicate tid")
	}
}

// 成员指向不存在的组（外键关闭时可能残留）不能卡住导出游标，
// 否则后面所有组的成员都会静默丢失。
func TestExportBackupSkipsOrphanMembers(t *testing.T) {
	dir := t.TempDir()
	db, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	now := time.Now().UnixMilli()
	if _, err := db.Exec(`INSERT INTO groups (id,key,title,created_at,updated_at) VALUES (5,'g5','G5',?,?)`, now, now); err != nil {
		t.Fatalf("seed group: %v", err)
	}
	// 外键在 DSN 里默认开着，临时关掉以写入孤儿行。
	if _, err := db.Exec("PRAGMA foreign_keys = OFF"); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO group_items (group_id,tid,title,added_at) VALUES
		(1,'orphan','orphan',?), (5,'member','member',?)`, now, now); err != nil {
		t.Fatalf("seed items: %v", err)
	}
	_ = db.Close()

	db2, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()

	var buf bytes.Buffer
	if err := NewStore(db2).ExportBackup(context.Background(), &buf); err != nil {
		t.Fatalf("export: %v", err)
	}
	var backup struct {
		Groups []model.Group `json:"groups"`
	}
	if err := json.Unmarshal(buf.Bytes(), &backup); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(backup.Groups) != 1 {
		t.Fatalf("groups=%d want 1", len(backup.Groups))
	}
	if len(backup.Groups[0].Items) != 1 || backup.Groups[0].Items[0].Tid != "member" {
		t.Fatalf("group 5 items=%+v, want [member] (orphan must not stall the cursor)", backup.Groups[0].Items)
	}
}

// 自动分组任务必须只补成员，不能删掉用户手工维护的成员。
func TestEnsureGroupMembersNeverDeletes(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	// 用户手工建组，成员 1/2/3。
	if _, err := s.UpsertGroup(ctx, "probe", "Probe", nil, nil, []model.GroupItem{
		{Tid: "1", Title: "A"}, {Tid: "2", Title: "B"}, {Tid: "3", Title: "C"},
	}); err != nil {
		t.Fatalf("seed group: %v", err)
	}

	// 自动任务想把这组变成 9001/9002。
	added, skipped, err := s.EnsureGroupMembers(ctx, "probe", "Probe", nil, nil, []model.GroupItem{
		{Tid: "9001", Title: "X"}, {Tid: "9002", Title: "Y"},
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if added != 2 || skipped != 0 {
		t.Fatalf("added=%d skipped=%d, want 2/0", added, skipped)
	}

	g, err := s.GetGroupByKey(ctx, "probe")
	if err != nil || g == nil {
		t.Fatalf("get group: %v", err)
	}
	got := make(map[string]bool)
	for _, it := range g.Items {
		got[it.Tid] = true
	}
	for _, want := range []string{"1", "2", "3", "9001", "9002"} {
		if !got[want] {
			t.Fatalf("member %s lost; have %v", want, got)
		}
	}

	// 已属别的组的 tid 必须跳过，不计入 added。
	if _, err := s.UpsertGroup(ctx, "other", "Other", nil, nil, []model.GroupItem{{Tid: "7777", Title: "Z"}}); err != nil {
		t.Fatalf("other group: %v", err)
	}
	added, skipped, err = s.EnsureGroupMembers(ctx, "probe", "Probe", nil, nil, []model.GroupItem{
		{Tid: "7777", Title: "Z"}, {Tid: "8888", Title: "W"},
	})
	if err != nil {
		t.Fatalf("ensure 2: %v", err)
	}
	if added != 1 || skipped != 1 {
		t.Fatalf("added=%d skipped=%d, want 1/1", added, skipped)
	}
}

// 标题变化时只更新标题，archived_at 必须保持首次归档时间。
func TestUpsertArchivePostsKeepsArchivedAtOnRename(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	old := int64(1_000_000)
	if _, _, err := s.UpsertArchivePosts(ctx, []model.ArchivePost{
		{Site: "2", Tid: "42", Title: "旧标题", FirstSeenAt: old, ArchivedAt: old},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	newer := old + 86_400_000
	inserted, updated, err := s.UpsertArchivePosts(ctx, []model.ArchivePost{
		{Site: "2", Tid: "42", Title: "新标题", FirstSeenAt: newer, ArchivedAt: newer},
	})
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if inserted != 0 || updated != 1 {
		t.Fatalf("inserted=%d updated=%d, want 0/1", inserted, updated)
	}

	res, err := s.ListArchivePosts(ctx, "2", "", 1, 10, "tid", "asc")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if res.Items[0].Title != "新标题" {
		t.Fatalf("title=%q, want 新标题", res.Items[0].Title)
	}
	if res.Items[0].ArchivedAt != old {
		t.Fatalf("archived_at refreshed to %d, want %d", res.Items[0].ArchivedAt, old)
	}
}

// v6 把存量分组键按新规则（追加去标点）重写；去标点后同 key 的组合并进最早组。
func TestMigrateV6StripsPunctuationFromGroupKeys(t *testing.T) {
	dir := t.TempDir()
	db, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// 回退到 v5，再种入旧规则 key 的行（顿号/逗号变体应合并，无标点 key 不动）。
	if _, err := db.Exec("PRAGMA user_version = 5"); err != nil {
		t.Fatalf("rewind: %v", err)
	}
	now := time.Now().UnixMilli()
	if _, err := db.Exec(`INSERT INTO groups (id,key,title,created_at,updated_at) VALUES
		(1,'我的妈妈，我的孕母，我的母马','母马·逗号',?,?),
		(2,'我的妈妈、我的孕母、我的母马','母马·顿号',?,?),
		(3,'种魔','种魔',?,?)`, now, now, now, now, now, now); err != nil {
		t.Fatalf("seed groups: %v", err)
	}
	// 组 1：tid 1、2；组 2：tid 3（并入组 1）；组 3：tid 9。
	// v2 起 group_items.tid 全局唯一，同 tid 不能预先挂在两个组。
	if _, err := db.Exec(`INSERT INTO group_items (group_id,tid,title,added_at) VALUES
		(1,'1','a',?), (1,'2','b',?),
		(2,'3','c',?),
		(3,'9','d',?)`, now, now, now, now); err != nil {
		t.Fatalf("seed items: %v", err)
	}
	_ = db.Close()

	db2, err := OpenDB(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()

	var keys []struct {
		ID  int64  `db:"id"`
		Key string `db:"key"`
	}
	if err := db2.Select(&keys, "SELECT id,key FROM groups ORDER BY id"); err != nil {
		t.Fatalf("read groups: %v", err)
	}
	want := []struct {
		ID  int64
		Key string
	}{{1, "我的妈妈我的孕母我的母马"}, {3, "种魔"}}
	if len(keys) != len(want) {
		t.Fatalf("groups %+v, want %v", keys, want)
	}
	for i, w := range want {
		if keys[i].ID != w.ID || keys[i].Key != w.Key {
			t.Fatalf("group[%d] = (%d,%q), want (%d,%q)", i, keys[i].ID, keys[i].Key, w.ID, w.Key)
		}
	}

	var members []struct {
		GroupID int64  `db:"group_id"`
		Tid     string `db:"tid"`
	}
	if err := db2.Select(&members, "SELECT group_id,tid FROM group_items ORDER BY group_id,tid"); err != nil {
		t.Fatalf("read members: %v", err)
	}
	if len(members) != 4 ||
		members[0].GroupID != 1 || members[0].Tid != "1" ||
		members[1].GroupID != 1 || members[1].Tid != "2" ||
		members[2].GroupID != 1 || members[2].Tid != "3" ||
		members[3].GroupID != 3 || members[3].Tid != "9" {
		t.Fatalf("members %+v, want tid 1,2,3 in group 1 and tid 9 in group 3", members)
	}
}

// GetLinkStats 合并 items 访问计数与 reading_sessions 时长；未访问目标不出现。
func TestGetLinkStatsMergesVisitsAndSessions(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	// 目标 1：2 次访问 + 2 段阅读（120s + 60s）；目标 2：仅访问；目标 3：从未访问。
	if err := s.RecordVisit(ctx, "1", model.KindPost, "1", "标题一", "u1"); err != nil {
		t.Fatalf("visit1: %v", err)
	}
	if err := s.RecordVisit(ctx, "1", model.KindPost, "1", "标题一", "u1"); err != nil {
		t.Fatalf("visit1 again: %v", err)
	}
	if err := s.RecordVisit(ctx, "1", model.KindPost, "2", "标题二", "u2"); err != nil {
		t.Fatalf("visit2: %v", err)
	}
	t0 := time.Now().Add(-time.Hour).UnixMilli()
	t1 := time.Now().UnixMilli()
	if err := s.RecordSession(ctx, SessionInput{Site: "1", Kind: model.KindPost, ID: "1", Title: "标题一", StartedAt: t0, DurationS: 120}); err != nil {
		t.Fatalf("session1: %v", err)
	}
	if err := s.RecordSession(ctx, SessionInput{Site: "1", Kind: model.KindPost, ID: "1", Title: "标题一", StartedAt: t1, DurationS: 60}); err != nil {
		t.Fatalf("session2: %v", err)
	}

	res, err := s.GetLinkStats(ctx, "1", model.KindPost, []string{"1", "2", "3"})
	if err != nil {
		t.Fatalf("GetLinkStats: %v", err)
	}
	byID := map[string]LinkStat{}
	for _, r := range res {
		byID[r.ID] = r
	}
	if len(res) != 2 {
		t.Fatalf("rows %+v, want only visited ids 1 and 2", res)
	}
	got := byID["1"]
	if got.VisitCount != 2 || got.TotalDurationS != 180 {
		t.Fatalf("id1: visit=%d duration=%d, want 2/180", got.VisitCount, got.TotalDurationS)
	}
	if got.LastReadAt == nil || *got.LastReadAt != t1 {
		t.Fatalf("id1: lastReadAt=%v, want %d", got.LastReadAt, t1)
	}
	if got.Title != "标题一" {
		t.Fatalf("id1: title=%q, want 标题一", got.Title)
	}
	if byID["2"].VisitCount != 1 || byID["2"].TotalDurationS != 0 || byID["2"].LastReadAt != nil {
		t.Fatalf("id2: %+v, want 1 visit, no sessions", byID["2"])
	}

	// site/kind 过滤：site=2 不可见。
	res, err = s.GetLinkStats(ctx, "2", model.KindPost, []string{"1"})
	if err != nil {
		t.Fatalf("GetLinkStats site2: %v", err)
	}
	if len(res) != 0 {
		t.Fatalf("site2 rows %+v, want empty", res)
	}

	// 空入参防御。
	res, err = s.GetLinkStats(ctx, "1", model.KindPost, nil)
	if err != nil || len(res) != 0 {
		t.Fatalf("empty ids: res=%v err=%v, want empty/no error", res, err)
	}
}
