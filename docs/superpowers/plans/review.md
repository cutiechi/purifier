# 实现计划复评：xbookcn.org 上游支持

- 计划：`2026-08-06-xbookcn-support.md`（已吸收上轮 C1–C4 / I1–I6 等）
- 日期：2026-08-06
- 结论：**几乎可执行**；上轮问题已基本关闭，仅剩 1 处代码片段自相矛盾。

---

## Important（仍未解决）

### 1. Task 4 `recordVisit`：`title ?? url` 抵消了「不覆盖 title」

意图（review I2 / 注释）：

- 章节页无 `bookTitle` → 传 `undefined` → SQL `COALESCE(?4, items.title)` **保留旧书名**
- 新行 title 必填 → 仅首次插入需要兜底

片段实际：

```ts
.run(site, kind, id, title ?? url, url, now)
// ON CONFLICT DO UPDATE SET title = COALESCE(?4, items.title)
```

`title ?? url` 在 `title === undefined` 时传入的是 **url 字符串**，不是 `NULL`。  
于是 `COALESCE` 永远拿到 truthy 的 url，**把书名盖成 URL**——比盖成章节名也好不到哪去。

**应改成**（示意）：

```ts
// 绑定：title 用 null 表示「更新时不改」
.run(site, kind, id, title ?? null, url, now)

// SQL
INSERT INTO items (site, kind, id, title, url, first_seen_at, last_visited_at, visit_count)
VALUES (?1, ?2, ?3, COALESCE(?4, ?5), ?5, ?6, ?6, 1)  -- 新行：title 缺省用 url
ON CONFLICT(site, kind, id) DO UPDATE SET
  title = COALESCE(?4, items.title),  -- 更新：?4 为 NULL 则保留
  url = excluded.url,
  last_visited_at = excluded.last_visited_at,
  visit_count = visit_count + 1
```

Task 7 侧 `visitTitle = result.bookTitle ?? (chapter ? undefined : result.title)` 可保持；store 层必须真正把 `undefined`/`null` 绑成 SQL NULL。

建议在 `store.test.ts` 加一条：先 `recordVisit(..., "书名", ...)`，再 `recordVisit(..., undefined, ...)`，断言 title 仍为 `"书名"`。

---

## 已关闭（不再跟踪）

C1 getExtractor 兼容、C2 迁移/PK、C3 buildChapterUrl 可选链、C4 fixture/cidFromUrl/章标题/选择器契约、I1 deleteItems 逐条 site、I3 BookPage 三分支、I4 restoreKey 含 chapter、I5 AGENTS.md、I6 搜索措辞、fetchHotHtml 错误处理等——plan 正文已修订，本评不重复。

---

## 建议

修掉上述 `recordVisit` 绑定后即可按 Task 1→12 开工；其余为执行期细节（真实 DOM 校对选择器），plan 已写明，不阻塞。
