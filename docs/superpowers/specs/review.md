# 设计评审：xbookcn.org 上游支持

- 被评文档：`2026-08-06-xbookcn-support-design.md`
- 初评日期：2026-08-06
- **复评日期：2026-08-06**（设计已按「站上全能力 + Critical 修订」更新）
- 结论：**通过，可实现** — 能力范围与实测对齐；原 Critical 项已在设计中拍板。

---

## 复评摘要

用户确认：**xbookcn 站上有的内容能力全部支持**（搜索、今日热读榜、相关推荐、有声标签、单篇等）。设计已改写能力矩阵与导航表。

Chrome 实测（`www.xbookcn.org`）与设计现表一致，不再重复能力清单；见设计文档 §站点结构 / §能力矩阵。

### 原 Critical 项状态

| ID | 问题 | 状态 |
|---|---|---|
| C1 | 缓存未区分 chapter | ✅ 设计改为 `site` 分层 + `book-{cid}-ch{n}` |
| C2 | assertSafeId 与冒号 | ✅ 分段校验 / 下划线编码，不把 `site:cid` 塞进旧正则 |
| C3 | 列表误用 readPath | ✅ 约定 site=2 时 `ChapterLink.tid`=cid → `bookPath` |
| C4 | mtid /novels 分页 | ✅ 游标表：0=首页，n≥1→`/novels/n`（含 1） |
| C5 | 进度语义矛盾 | ✅ 仍用 0..1 滚动；仅章节页；历史进目录 |
| C6 | 章节 recordVisit 污染书名 | ✅ 固定目录 url + 书名策略 |

### 原 Important 项状态

| ID | 状态 |
|---|---|
| I1 CategoryLink.url 带 site | ✅ 写死 |
| I2 posts 短路 | ✅ handlePosts site=2 短路 |
| I3 旧库 PK / ON CONFLICT | ✅ 改为重建三表 |
| I4 搜索 | ✅ **改为全支持**（范围变更） |
| I5 getExtractor 语义 | ✅ 保留 |
| I6 SiteSwitcher | ✅ 内容页回首页 |
| I7 books 响应字段 | ✅ 含 related/singleShot 等 |
| I8 me 前端带 site | ✅ 清单含 item-actions / progress |
| I9 fixtures 路径 | ✅ `packages/core/.../fixtures/xbookcn/` |

### 范围变更（相对初版设计）

| 能力 | 初版 | 现版 |
|---|---|---|
| 关键词搜索 | 不支持 | ✅ `/search` → browse?q= |
| 今日热读榜 | 归入「人气」不支持 | ✅ `/api/trending` + 导航保留人气 |
| 相关推荐 | 未提 | ✅ 目录响应 `related` |
| 有声 | 仅 slug 列表 | ✅ 标签 audio（+ 兼容 999） |
| 单篇 | 未写清 | ✅ `singleShot` + chapter=1 |
| 精华/扫文/评论/跟帖 | 不支持 | 仍不支持（上游无对等） |

### 实现前注意（非阻塞）

1. **HotPost.reads**：站上热榜无阅读数时填 `0`，UI 以 rank/title 为主。  
2. **`/tag/999` vs `audio`**：分类入口统一 `audio`；若 HTML 出现 999 链可规范化。  
3. **相关推荐 vs /api/picks**：不接 picks 路由，避免与 cool18 扫文混淆。  
4. **cid 字符集**：实测无 `=` padding；若遇异常字符再扩 SAFE_ID。  
5. 实现后跑设计 §验证 手动清单。

---

## 历史初评（归档，已被上文覆盖）

初评结论为「有条件通过」，Critical 6 / Important 9。细节见 git 历史；**以现设计与本复评为准**。
