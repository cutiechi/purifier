# 设计评审（复评）：xbookcn 全能力版

- 文档：`2026-08-06-xbookcn-support-design.md`（全能力 + 原 Critical 已吸收）
- 日期：2026-08-06
- **复评修订：2026-08-06** — Important 1/2 已在 spec 修订 2 落实，Suggestion 3 已采纳。
- 结论：**通过，可实现**。

---

## 复评 Important 状态

| ID | 问题 | 状态 |
|---|---|---|
| I1 | 进度语义自相矛盾（无 `last_chapter` 却承诺同章恢复）| ✅ 采用方案 A：`items` 加 `last_chapter`；`setProgress` 带章号；恢复仅当章号匹配 |
| I2 | `bookTitle` 未进响应类型 | ✅ `BookContentResponse.bookTitle?` 加入；`extractChapter` 解析；`handleBooks` recordVisit 用书名 |
| S3 | `handleTrending` 上游 URL 硬编码 | ✅ 新增 `Extractor.fetchHotHtml()`，两站各自实现，API 层统一调用 |

---

## 历史初评/复评（归档，已被上文覆盖）

下文为复评原文，保留以备追溯。**以 spec 修订 2 与本复评状态为准。**

---

## Important

### 1. 章内滚动进度：书级 0..1 无法兑现「同章再进可恢复」

§4 进度语义：

- 存储仍是 `(site, kind, cid)` 上的单一 `read_progress`（0..1）
- 声称「**同章**再进时」可恢复滚动
- 明确不做 `last_chapter`

与现有 `useReadingProgress(kind, id)` 一致：只认 `cid`，**不认 `chapter`**。

后果：

1. 读第 1 章到 50% → 写入 `0.5`
2. 打开第 3 章 → 恢复到 50%（错章）或写进度覆盖为第 3 章滚动值
3. 历史里「已读 50%」对多章书无稳定含义

验证清单「章节页滚动进度可恢复」在**多章切换**下不成立。

**请在实现前三选一写死**（推荐 A）：

| 方案 | 做法 |
|---|---|
| **A. 服务端记章** | `items` 增 `last_chapter TEXT/INTEGER`（可空）；`setProgress` 同时写章号；恢复仅当 `chapter === last_chapter` |
| **B. 纯前端恢复** | 服务端仍只存书级 %（历史展示用）；滚动恢复用 `sessionStorage`/`localStorage` key=`site:cid:chapter` |
| **C. 不做恢复** | site=2 章节页只显示即时进度条，**不** `restore`、可不落库；改验证清单 |

当前正文等于同时承诺了 B/C 未写明的 A，实现时会各写各的。

---

### 2. `bookTitle` 未进入响应类型

§4 `recordVisit` 要求章节请求用**书名**，并写「章节响应可带 `bookTitle` / 面包屑解析」。

§3 `BookContentResponse` **没有** `bookTitle?: string`。

实现时容易仍用章节 `title` 调 `recordVisit`，书名被覆盖（与已拍板的 title 策略冲突）。

**建议**：在 `BookContentResponse` 增加可选 `bookTitle?`；`handleBooks` 在带 `chapter` 时 `recordVisit(..., bookTitle ?? existingTitle, buildBookUrl(cid))`。

---

## Suggestion（不阻塞）

### 3. `handleTrending` / 同类 handler 的上游 URL

现状 cool18 热榜 URL 写死在 API：`homeUrl?app=forum&act=hot`。  
设计写 site=2 抓 `homeUrl` 再 `extractHotPosts`。

实现时 API 必须按 site 分支（或把「热榜 HTML 从哪来」收进 extractor，例如 `fetchHotPostsHtml()`）。建议在改动清单 §5 补一句，避免只换 extractor 仍请求 cool18 路径。

### 4. 首页「有声」区块

站上首页有独立「有声小说」区；设计用标签 `audio` + 分类覆盖能力，未要求首页镜像该区块。若「全覆盖」含信息架构而非仅 API，可在 HomePage site=2 加有声入口条；否则保持现状即可。

---

## 已对齐、不再列为问题

能力矩阵（搜索/热读/相关推荐/单篇）、列表 `tid`=cid + `bookPath`、mtid 游标、`/novels/1`、缓存 site+chapter、PK 重建、posts 短路、CategoryLink 带 site、导航显隐、SiteSwitcher 等——设计已写清，本评不重复。

---

## 建议动作

1. 拍板进度方案 **A / B / C** 并改 §4 + 验证清单  
2. `BookContentResponse.bookTitle?` 写入 §3  
3. （可选）extractor 或 API 明确热榜 fetch URL  

1、2 补上后可直接按改动清单开工。
