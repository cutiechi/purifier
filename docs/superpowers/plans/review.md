# 实现计划评审：xbookcn.org 上游支持

- 计划：`2026-08-06-xbookcn-support.md`
- 对照：`docs/superpowers/specs/2026-08-06-xbookcn-support-design.md`
- 日期：2026-08-06
- 结论：**有条件可执行** — 任务切分与 TDD 节奏好，但有几处会在实现中途炸 API / 写错迁移 / 测不过的硬伤，建议先改 plan 再开干。

---

## Critical

### C1. Task 3 改掉 `getExtractor` 后立刻弄坏 API

现状 API 全是 `getExtractor("cool18")`（按 **name**）。

Task 3 把 `getExtractor` 改为 `resolveSite(id)`，且 `SITES` **只有** `"1"`。于是：

```ts
getExtractor("cool18") // → SITES["cool18"] === undefined → 400 unknown site
```

Task 3 提交后、Task 7 改 API 之前，**`bun run dev` / 任何 content 请求全挂**。Task 3 验证只跑 `sites.test.ts`，发现不了。

**改法（三选一，写进 plan）**：

1. **推荐**：Task 3 暂不改 `getExtractor` 签名；新增 `resolveSite`，API 到 Task 7 再全部 `resolveSite(site)`，最后删 name 语义。  
2. Task 3 起保留兼容：`if (id === "cool18" || !id) return resolveSite("1")`。  
3. Task 3 同步把 API 里 7 处先改成 `getExtractor("1")` / `resolveSite()`（工作量挪到 Task 3）。

---

### C2. Task 4 迁移 `INSERT` 列清单与 `items_new` 结构不匹配

Plan 片段：

```ts
const cols2 = db.query(`PRAGMA table_info(${table})`) // 旧表
const colList = cols2.map((c) => c.name).join(", ")
// items:
INSERT INTO items_new (${colList}, last_chapter) SELECT ${colList}, NULL FROM items
```

问题：

1. 旧表 **无 `site`**，`items_new` **有 `site NOT NULL DEFAULT '1'`**。省略 `site` 时靠 DEFAULT 一般可行，但应 **显式** `INSERT ... site ... SELECT ..., '1' AS site, ...`，避免以后关掉 DEFAULT 或列序变化踩坑。  
2. 更严重：若执行迁移前已跑过「仅 `ADD COLUMN site`」的半成品路径，或 `colList` 已含 `site`，再拼 `, last_chapter` 还行；但 plan 在 **无 site 时整表重建**，却从未把 `site` 写进 SELECT。依赖 DEFAULT 可以，**文档必须写死**「依赖 DEFAULT '1'」。  
3. `favorites`/`tags` 的 `INSERT INTO ${table}_new (${colList}) SELECT ${colList}`：旧表无 site，同样靠 DEFAULT——OK，但与 items 策略应统一写明。  
4. **PK 是否含 site**：plan 只判断「有无 site 列」，不判断 PK。旧库若已有 `site` 列但 PK 仍是 `(kind,id)`（半迁移），会 **跳过重建**，`ON CONFLICT(site,kind,id)` 仍炸。Spec 要求检测 PK；plan 应补：

   ```ts
   // 例如：sqlite_master SQL 文本含 PRIMARY KEY (site 或用 PRAGMA index_list
   ```

   或始终：无 `(site,kind,id)` 唯一索引则重建。

---

### C3. Task 7 `handleBooks` 对 `buildChapterUrl` 非可选调用

```ts
const pageUrl = chapter
  ? extractor.buildChapterUrl(cid, chapter)  // cool18 无此方法 → runtime TypeError
  : extractor.buildBookUrl(cid)
```

同 Task 后文写「`buildChapterUrl?.`」，**代码片段与文字矛盾**。

**应写成**：

```ts
const pageUrl =
  chapter && extractor.buildChapterUrl
    ? extractor.buildChapterUrl(cid, chapter)
    : extractor.buildBookUrl(cid)
```

site=1 误带 `chapter` 时忽略 chapter，与 cool18「整本一页」一致。

---

### C4. Task 6 fixture / 测试与解析逻辑自相矛盾

| 位置 | 问题 |
|---|---|
| `chapter.html` 面包屑 | `<a href="/novel/MjI4NzE">📄书页</a>` 与 `<a href="/novel/MjI4NzE/2">欲望夜</a>`：按 plan「无章号后缀取书名」会得到 **「📄书页」**，测试却 `expect(r.bookTitle).toBe("欲望夜")` |
| TOC 章标题 | fixture 文案 `第 1 章 序：…`，测试要 `title: "序：不是开始的开始"`，骨架 `$(a).text().trim()` **不 strip 前缀** |
| `cidFromUrl` 注释 | 写 `/novel/MjI4NzE/2` → `MjI4NzI`（错误 id 且像取了错段）；应为 **第二 path 段 = cid** |
| 选择器 | `#chapter-list` / `#intro` / `#related-section` / `p.meta` 为 **虚构**，真实 xbookcn DOM 未验证。TDD 可用，但 Step 1 必须写：**fixture 选择器 = 实现选择器；上线前用真实 HTML 校对一次**，否则 Task 6 绿、联调全红 |

`bookTitle` fixture 建议改成：

```html
<nav>
  <a href="/novel/MjI4NzE">欲望夜</a>
  <a href="/novel/MjI4NzE/2">→下一章</a>
</nav>
```

---

## Important

### I1. 批量删除 / `deleteItems` 与跨站历史冲突

- Spec：`DELETE` body `items` 每项可带 `site`；列表默认 **跨站**。  
- Task 4：`deleteItems(site, pairs)` **单 site**。  
- Task 7：body「每项可含 site」。

跨站历史页「清空本页」会混 site=1/2，单 site API **删错站或删不掉**。

**改法**：`deleteItems(pairs: Array<{ site: string; kind; id }>)`，缺省 site=`"1"`。

---

### I2. `recordVisit` 书名策略未落到 store SQL

Spec：`bookTitle` 缺失时 **不覆盖** 已有 title（`COALESCE` / 读旧 title）。

Task 7：`visitTitle = result.bookTitle ?? result.title` → 解析失败时 **用章节名覆盖书名**。

应在 `recordVisit` 或 API 层：

- 有 `bookTitle` → 用书名；  
- 无则 `UPDATE` 只碰 `last_visited_at`/`visit_count`/`url`，**不动 title**；或先 `getState` 取旧 title。

---

### I3. Task 10：cool18 书页与 site=2 目录分支需按 **site** 分，不能只看 chapter

「无 chapter → 目录 UI」对 cool18 错误（cool18 无 chapter 时应直接 `ArticleView` 整本）。

Plan 后文有「cool18 忽略 chapter，正文直接渲染」，但 Step 3 分支描述以 chapter 有无为第一刀，**易实现成 site=1 空白目录**。

应写死：

```ts
if (site === "2" && !chapter) → TOC
else if (site === "2" && chapter) → 章节正文 + progress
else → 现有 ArticleView（cool18 book）
```

---

### I4. `useReadingProgress` 的 `id` 仍是 cid：换章时 restore 决策缓存

现 hook 用 `restoreId.current !== id` 重置决策。同 cid 从 ch1→ch2 时 **id 不变**，`restoreTarget` 可能仍是 ch1 的决策结果。

Plan 加了 `chapterMatches`，但若 `restoreTarget.current !== undefined` 早退在章号判断之前，换章不重算。

**要求**：`restoreId` 改为 `` `${id}:${chapter ?? ""}` ``，或 chapter 变化时强制 `restoreTarget = undefined`。

---

### I5. Agents.md / 导出面

Spec 改动清单含更新 `Agents.md` API 表；plan Task 12 未列。  
Task 3 `index.ts` 重导出 `resolveSite`/`DEFAULT_SITE` 后 `@workspace/core` 可用——OK。前端 `isValidSite` 注释摇摆，**routes 本地校验即可**，不必强依赖 core。

---

### I6. 验证清单「搜索单字空」

Plan Task 12：`搜索双字关键词有结果，单字空`——**spec 与实测未要求**单字为空。以线上 `/search` 行为为准，勿写死错误产品规则。

---

## Suggestion

### S1. Task 顺序与「半残状态」

即使修了 C1，Task 4–6 完成后 API 仍用旧 `getExtractor("cool18")` 直到 Task 7——若 C1 用兼容别名则 dev 可用。在 plan 头「Global Constraints」注明：**Task 3–6 期间不要依赖 name 版 getExtractor**。

### S2. `fetchHotHtml` 错误处理

xbookcn 骨架直接 `.text()`；cool18 有 `!resp.ok → 502`。两站应对齐。

### S3. `handlePosts` 用 `siteId !== "1"` 判无帖

第三站若也是书站会误伤；可改为 `extractor.name === "xbookcn"` 或「调用 extractContent 前看能力表」。两站阶段可接受。

### S4. 首页有声区块

Spec 能力由 `/tag/audio` 覆盖；plan 未做首页有声条——与 spec「可选」一致，可保持。

### S5. Task 体量

Task 4（store 全改）与 Task 6（extractor+fixtures）偏大，可接受；执行时注意单 commit 可回滚。

---

## 已对齐、不再列为问题

- 进度方案 A（`last_chapter` + 章号匹配）在 Task 4/7/10 贯穿  
- `bookTitle` 类型 → extract → recordVisit 链路（除 I2 回退细节）  
- `fetchHotHtml` 进 Extractor，trending 统一调用  
- 缓存 `cache/{site}/{kind}-{id}[-ch{n}]` + 分段 `assertSafeId`  
- NAV `sites` + SiteSwitcher 个人区/内容区行为  
- 列表 `tid`=cid + site=2 → `bookPath`  
- 能力矩阵与 Task 6/7/11 映射（自检备注）  

---

## 建议改 plan 的最小 diff

1. **C1** 兼容 `cool18` name 或推迟改 `getExtractor`  
2. **C2** 迁移显式写入 `site='1'` + 检测/强制 PK 重建  
3. **C3** `buildChapterUrl` 可选链 + fallback  
4. **C4** 修正 chapter fixture、`cidFromUrl` 注释、章标题 strip、注明选择器契约  
5. **I1** `deleteItems` 逐条 site  
6. **I2** recordVisit 无 bookTitle 不覆盖 title  
7. **I3/I4** BookPage 分支与 progress restore key 写死  

改完后可按 Task 1→12 顺序执行。
