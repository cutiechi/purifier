# AGENTS.md

## 项目概述

Purifier 是一个纯净小说与论坛阅读应用，采用现代化前后端分离架构：

- `backend/`：**Go 1.22+** 原生 HTTP 服务（基于轻量优雅的 **Chi (`go-chi/chi/v5`)** 路由），内置上游爬虫（先 ReadAll 再按 charset 转码）、DOM 白名单安全清洗、Singleflight 防击穿与二级磁盘缓存、SQLite 持久化（未来切换 PG）。生产环境支持直接托管前端 SPA。
- `frontend/`：**Vite + React 19** SPA，基于 **shadcn UI (React 19)**、**Tailwind CSS 4** 与 **React Router 7**。

### 架构核心准则（2026 规范）

1. **内容源垂直切片隔离（Vertical Slice）**：
   - 论坛形态源（如 **Cool18**）与小说书库形态源（如 **XChina / XBookCN**）在 `/api/v1/` 下分立独立接口，数据模型与清洗管道互不污染。
   - 保留 `/api/posts` 与 `/api/books` 兼容层以平滑支持历史客户端调用。
2. **个人资产域下沉统合**：
   - 用户的阅读历史、收藏、书签、标签、阅读会话统一归口于 `/api/v1/me/*`，底层通过 `(site, kind, id)` 联合主键无缝支持跨站聚合。
3. **数据库无缝平迁 PG 策略**：
   - 当前采用零外部依赖的纯 Go 驱动 `modernc.org/sqlite`（WAL 模式，`SetMaxOpenConns(8)`）。
   - SQL 统一封装在 `internal/storage` 领域 DAO 内。当前实现使用 SQLite 专有语法（`AUTOINCREMENT`、`COLLATE NOCASE`、`INSERT OR IGNORE`、`strftime`、`rowid`、`LastInsertId`、`?` 占位符），迁移 PG 时需逐处改写。
   - schema 变更只能通过 `storage/db.go` 的 `migrations` 顺序追加（版本号存 `PRAGMA user_version`），不得再直接改 DDL 常量。

## 常用命令

| 命令                                                  | 作用                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `cd backend && go run ./cmd/server`                   | 启动 Go 后端服务（默认 `:3001`）                         |
| `cd backend && go build -o bin/purifier ./cmd/server` | 编译 Go 后端可执行单文件                                 |
| `cd backend && go test ./...`                         | 运行 Go 后端单元与集成测试                               |
| `cd frontend && bun run dev`                          | 启动 Vite 前端开发服务器（`:3000`，代理 `/api` 到 3001） |
| `cd frontend && bun run build`                        | 构建前端静态生产产物到 `dist`                            |
| `cd frontend && bun run typecheck`                    | 前端 TypeScript 类型检查                                 |
| `bun run format`                                      | Prettier 代码格式化                                      |
| `docker build -t purifier .`                          | 多阶段构建生产容器镜像（含前端静态与 Go 纯静态单文件）   |
| `docker run -d -p 3000:3000 -v purifier_data:/data purifier` | 启动单容器生产部署（暴露 `:3000` 端口）                  |

## 目录与关键文件

```text
backend/
├── cmd/server/main.go               # 服务启动入口、配置注入、优雅停机
├── internal/
│   ├── config/config.go             # 环境变量读取 (PORT, DATA_DIR, HTTPS_PROXY, TZ)
│   ├── model/model.go               # 核心领域实体 (Item, Bookmark, Favorite, Job 等)
│   ├── pkg/httputil/response.go     # 统一 JSON 与缓存头工具 (LIST/CONTENT/NO_STORE)
│   ├── core/
│   │   ├── upstream/                # 连接池、代理、Singleflight 协程防击穿、原子磁盘缓存
│   │   └── sanitize/                # HTML DOM 遍历白名单安全清洗管道
│   ├── storage/                     # 持久化存储 DAO (SQLite / 预备平迁 PG)
│   │   ├── db.go                    # 数据库初始化、顺序迁移（user_version）与连接池
│   │   ├── item.go                  # 浏览记录与阅读状态
│   │   ├── history.go               # 历史记录与收藏
│   │   ├── tag.go                   # 标签管理与分类筛选
│   │   └── bookmark.go              # 书签增删改查
│   ├── provider/                    # 垂直内容源领域 (Vertical Slices)
│   │   ├── cool18/                  # Cool18 论坛 (帖子、目录、跟帖树、排行榜)
│   │   └── xchina/                  # XChina 书库 (书籍目录、章节正文、上下文导航)
│   └── api/
│       ├── router.go                # Chi 总路由 (v1 切片、兼容层与 SPA 托管)
│       ├── listcache.go             # 列表响应进程内短 TTL 缓存中间件
│       └── me/handler.go            # /api/v1/me/* 个人中心控制器
frontend/                            # Vite + React 19 + shadcn UI
├── src/
│   ├── components/ui/               # shadcn 基础原语组件
│   ├── pages/                       # 业务页面级组件
│   └── lib/                         # 纯前端工具函数与路由定义
```

## 技术约定

- **前端**：**凡是可以使用 shadcn/ui 组件的地方，绝对不要手写原生 HTML 或重复造轮子**。必须优先通过 `bunx --bun shadcn@latest add <component>` 添加标准 shadcn/ui 组件（如 `button`, `dialog`, `dropdown-menu`, `input`, `select`, `badge`, `tooltip`, `tabs`, `card`, `sheet`, `popover`, `scroll-area`, `separator` 等）并在页面中复用，保持设计语言、无障碍访问（a11y）与统一暗黑主题。
- **设计 token**：语义色一律走 `index.css` 的 shadcn 变量（`--background/--foreground/--muted/--accent/--destructive/--success/--info/--warning/--border/--ring/--glow` 及 `--radius` 阶梯，`@theme inline` 映射为 Tailwind 类）。禁止在组件里写 Tailwind 原始色板（`amber-*/sky-*/emerald-*/blue-*`）；仅生成式装饰色（图书封面按标题取色、榜单排名奖牌色）例外。状态横幅用 `<Alert variant="success|info|warning|destructive">`，按钮/链接按钮用 `Button` / `buttonVariants`（Base UI 版不支持 `render=<a>`）。
- **后端**：Go 1.22+，使用 Chi 作为轻量路由，坚持标准 `net/http` 语义，错误返回统一结构 `{"error": "..."}`。
- **存储**：SQL 统一封装在 `internal/storage` 领域 DAO 内。当前实现使用 SQLite 语法（`AUTOINCREMENT`、`COLLATE NOCASE`、`INSERT OR IGNORE`、`strftime`、`rowid`、`LastInsertId`、`?` 占位符），迁移 PostgreSQL 时需逐处改写，不承诺零改动切换。
- **正文清洗**：所有外部 HTML 抓取内容必须经 `sanitize.SanitizeContentHTML` 管道清洗，剥除外链追踪与恶意脚本，只放行 `/cool-18/:tid` 与 `/xbook-cn/:cid`（含 `?chapter=`）站内安全链接。

## 前端路由

一级 = 内容类型（首页/分类/榜单/目录/搜索/我的），二级 = 内容源，由路径前缀表达：论坛 `/cool-18`，书库 `/xbook-cn`。`/` 重定向到 `/cool-18`。

| 一级 | 论坛 | 书库 |
| ---- | ---- | ---- |
| 首页 | `/cool-18` | `/xbook-cn` |
| 分类 | `/cool-18/categories` · `/cool-18/browse?type=&q=&page=` | `/xbook-cn/categories` · `/xbook-cn/browse?type=&q=&page=` |
| 榜单 | `/cool-18/featured` · `/cool-18/picks` · `/cool-18/comments` · `/cool-18/trending` | `/xbook-cn/trending` |
| 目录 | `/cool-18/archive` · `/cool-18/groups` | `/xbook-cn/archive` |
| 搜索 | `/cool-18/search?q=&page=` | `/xbook-cn/search?q=&page=` |
| 内容 | `/cool-18/:tid?bm=` | `/xbook-cn/:cid?chapter=&bm=` |
| 我的（跨站，可选 `?site=1\|2` 过滤） | `/me` `/history` `/favorites` `/tags` `/bookmarks` `/stats` `/jobs` | 同左 |
| 其他 | `/login`、`*` 404 | — |

## API 约定

### 2026 规范路由 (`/api/v1/*`)

| 路径                                                            | 说明                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/cool18/posts?mtid=`                                | Cool18 论坛首页列表（支持 `mtid` 游标）                   |
| `GET /api/v1/cool18/posts/{tid}?refresh=1`                      | Cool18 帖子详情（含正文、章节联想、完整跟帖树 `replies`） |
| `GET /api/v1/xchina/books/{cid}?refresh=1`                      | XChina 小说详情与章节目录                                 |
| `GET /api/v1/xchina/books/{cid}/chapters/{chapterId}?refresh=1` | XChina 章节正文与上下文导航                               |
| `GET/PUT/DELETE /api/v1/me/*`                                   | 统一的个人资产中心（历史、收藏、标签、书签、阅读进度）    |

### 兼容层路由（对齐老客户端）

| 路径                                     | 参数                                                                                                                                                                                                               | 行为                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                        | 无                                                                                                                                                                                                                 | `{ status: "ok", runtime: "go" }`                                                                                                             |
| `GET /api/auth/config`                   | 无                                                                                                                                                                                                                 | `{ enabled, buttonText }`                                                                                                                     |
| `GET /api/auth/me`                       | 无                                                                                                                                                                                                                 | `AuthMe`；OIDC 开且未登录 401；关则 `enabled: false` 且 claim 为 null                                                                         |
| `POST /api/auth/authorize`               | 无                                                                                                                                                                                                                 | `{ url }` + PKCE Cookie；未开 400 `oidc disabled`                                                                                             |
| `POST /api/auth/callback`                | body `{ url }`                                                                                                                                                                                                     | 成功设会话                                                                                                                                    |
| `POST /api/auth/logout`                  | 无                                                                                                                                                                                                                 | 清 Cookie `{ ok }`                                                                                                                            |
| `GET /api/posts`                         | `tid`、`site`（默认 `1`）                                                                                                                                                                                          | 帖子正文 + 章节链接 + 元信息 + 跟帖树；`site=2` 无帖子模型返回 404                                                                            |
| `GET /api/posts`                         | `mtid`、`site`（默认 `1`）                                                                                                                                                                                         | 首页分页列表 `{ links, nextMtid }`；`site=2` 返回书库更新流（`mtid` 为页码，首页给 `1`）                                                       |
| `GET /api/books`                         | `cid`、`chapter`、`site`（默认 `1`）                                                                                                                                                                               | `site=1` 返回 Cool18 藏文单页 `{ title, content, meta, url }`（无章节模型，带 `chapter` 返回 404）；`site=2` 返回书库目录页或章节正文页       |
| `GET /api/browse`                        | `type` 或 `q`、`page`、`site`（默认 `1`）                                                                                                                                                                          | 分类 / 关键词列表 `{ category, links, nextPage }`                                                                                             |
| `GET /api/categories`                    | `site`（默认 `1`）                                                                                                                                                                                                 | `{ links: CategoryLink[] }`；`site=2` 返回书库题材入口（`url` 形如 `/xbook-cn/browse?type=<slug>`）                                            |
| `GET /api/featured`                      | `site`（默认 `1`）                                                                                                                                                                                                 | `{ links }` 精华热贴；`site=2` 404                                                                                                            |
| `GET /api/picks`                         | `site`（默认 `1`）                                                                                                                                                                                                 | `{ sections }` 扫文推荐分组；`site=2` 404                                                                                                     |
| `GET /api/comments`                      | `site`（默认 `1`）                                                                                                                                                                                                 | `{ posts }` 评论榜（抓 `?act=cmtrank&y=1`）；`site=2` 404                                                                                     |
| `GET /api/trending`                      | `site`（默认 `1`）                                                                                                                                                                                                 | `{ posts }` 人气榜（`site=1` 抓 `?app=forum&act=hot`，`site=2` 抓书库首页 `#hot-ranking`）                                                     |
| `GET /api/me/history`                    | `q`、`kind`、`page`、`site?`                                                                                                                                                                                       | 阅读历史 `{ items, nextPage?, total }`；省略 `site` 跨站，带 `site` 只列该站                                                                  |
| `DELETE /api/me/history`                 | `all=1` 或 `kind`+`id` 或 body `{ items }`；均可带 `site`                                                                                                                                                          | 清空全部 / 删单条 / 批量（清空本页）；连带清收藏与标签；`all=1` 省略 `site` 跨站清空，单条/批量默认 `1`                                       |
| `GET /api/me/favorites`                  | `q`、`kind`、`page`、`site?`                                                                                                                                                                                       | 收藏列表 `{ items, nextPage?, total }`；省略 `site` 跨站，带 `site` 只列该站                                                                  |
| `PUT/DELETE /api/me/favorites`           | `kind`、`id` 走 query；body `{ site? }`（默认 `1`）                                                                                                                                                                | 加 / 取消收藏 `{ ok }`；`PUT` 对象不存在 404                                                                                                  |
| `GET /api/me/tags`                       | `site?`                                                                                                                                                                                                            | `{ tags: TagCount[] }` 全部标签及计数；省略 `site` 跨站统计，带 `site` 只统计该站                                                             |
| `PUT /api/me/tags`                       | body `{ kind, id, tags, site? }`（默认 `1`）                                                                                                                                                                       | 整体替换标签 `{ ok, tags }`；对象不存在 404                                                                                                   |
| `DELETE /api/me/tags`                    | `tag`、`site?`                                                                                                                                                                                                     | 全局删除该标签 `{ ok, removed }`（从所有对象上移除）；省略 `site` 跨站删除，带 `site` 只删该站                                                |
| `GET /api/me/items`                      | `tag`、`q`、`kind`、`page`、`site?`                                                                                                                                                                                | 按标签精确筛选 `{ items, nextPage?, total }`；省略 `site` 跨站，带 `site` 只列该站                                                            |
| `GET /api/me/state`                      | `kind`、`id`、`site`（默认 `1`）                                                                                                                                                                                   | `{ site, kind, id, title, url, visit_count, favorited, tags, read_progress, lastChapter, groupId?, groupTitle? }`；无记录返回 200 空状态      |
| `GET /api/me/link-stats`                 | `kind`（`post`\|`book`）、`site`（默认 `1`）、`ids`（逗号分隔，上限 200）                                                                                                                                            | `{ items: [{ id, title, visitCount, lastVisitedAt, totalDurationS, lastReadAt }] }`；正文链接导航面板用，仅返回已访问过的目标（未访问由前端补零） |
| `PUT /api/me/progress`                   | body `{ kind, id, progress, site?, chapter? }`                                                                                                                                                                     | 保存阅读进度 `{ ok }`；`chapter` 可选，记录 `last_chapter`；对象不存在 404                                                                    |
| `DELETE /api/me/cache`                   | 无                                                                                                                                                                                                                 | 清空内容缓存（磁盘 + 内存 L1）`{ cleared: n }`                                                                                                |
| `GET /api/me/groups`                     | `q`、`key`；可选 `page`/`limit`/`favorited=1`/`sort=updated\|title\|chapters`                                                                                                                                       | 始终分页 `{ items, nextPage?, total }`（limit 默认 20 上限 100）；成员一条 IN 查询批量填充；v1 仅论坛                                          |
| `GET /api/me/groups/:id`                 | 无                                                                                                                                                                                                                 | `{ group }`（含 items）；不存在 404                                                                                                           |
| `PUT /api/me/groups`                     | body `{ key, title, items:[{tid,title}], author?, genre? }`                                                                                                                                                        | 按 key upsert 并入成员 `{ ok, group }`；`items` 非空；tid 已在其它组 409                                                                      |
| `DELETE /api/me/groups/:id`              | 无                                                                                                                                                                                                                 | 删分组（级联成员）`{ ok }`                                                                                                                    |
| `DELETE /api/me/groups/:id/items`        | body `{ items:[{tid}] }`                                                                                                                                                                                           | 移除成员；组空自动删组 `{ ok, removed, deleted }`                                                                                             |
| `PUT/DELETE /api/me/groups/:id/favorite` | 无                                                                                                                                                                                                                 | 收藏 / 取消收藏整个分组 `{ ok }`；不存在 404                                                                                                  |
| `GET /api/me/characters`                 | `kind`、`id`                                                                                                                                                                                                       | `{ scope, clusters: [{ id, hue, names }] }`；`kind=post` 且 tid 已在分组时 scope 指向该组                                                     |
| `PUT /api/me/characters`                 | body `{ kind, id, name, clusterId? }`                                                                                                                                                                              | 新增角色（幂等）`{ ok, cluster, clusters }`；`name` 规范化（trim、禁换行/Tab、1-32 字符）后为空 400；跨组同名 409                             |
| `PATCH /api/me/characters`               | body `{ kind, id, op: merge\|split\|recolor, ... }`                                                                                                                                                                | `{ ok, clusters }`                                                                                                                            |
| `DELETE /api/me/characters`              | `kind`、`id`、`name`                                                                                                                                                                                               | 删除角色 `{ ok, removed }`                                                                                                                    |
| `GET /api/me/bookmarks`                  | `kind`+`id`（书可加 `chapter`）或 `q`/`kind`/`page`                                                                                                                                                                | 当前篇不分页 `{ items }`；否则跨站分页 `{ items, nextPage?, total }`；item 字段为 camelCase（`itemId`/`scrollProgress`/`createdAt`）          |
| `POST /api/me/bookmarks`                 | body `{ kind, id, quote, site?, chapter?, note?, scrollProgress }`                                                                                                                                                 | `{ ok, bookmark }`；无 item 404、满 50 条 409                                                                                                 |
| `PATCH /api/me/bookmarks/:id`            | body `{ note }`                                                                                                                                                                                                    | 改备注                                                                                                                                        |
| `DELETE /api/me/bookmarks/:id`           | 无                                                                                                                                                                                                                 | `{ ok, removed }`                                                                                                                             |
| `GET /api/me/jobs`                       | `type`、`status`（含聚合 `active`=running\|paused\|pending、`finished`=终态 finished\|error\|cancelled）、`sort`（created_at\|type\|status\|duration 默认 created_at）、`order`（asc\|desc 默认 desc）、`limit`（默认 20 上限 100）、`offset` | `{ items, nextPage?, total }` 任务列表                                                                                                        |
| `POST /api/me/jobs`                      | body `{ type, payload? }`                                                                                                                                                                                          | 启动任务 `{ job }`；未知 type 400、同 type 已运行 409                                                                                         |
| `DELETE /api/me/jobs`                    | body `{ ids: number[] }`                                                                                                                                                                                           | 批量删除已结束任务 `{ ok, removed }`；含活动任务整批 409                                                                                      |
| `GET /api/me/jobs/:id`                   | 无                                                                                                                                                                                                                 | `{ job }`；不存在 404                                                                                                                         |
| `DELETE /api/me/jobs/:id`                | 无                                                                                                                                                                                                                 | `{ ok }`；不存在 404、仅终态可删（否则 409）                                                                                                  |
| `GET /api/me/jobs/:id/logs`              | `limit`（默认 200 上限 1000）、`offset`、`level`、`order`                                                                                                                                                          | `{ items }` 日志                                                                                                                              |
| `POST /api/me/jobs/:id/stop`             | 无                                                                                                                                                                                                                 | `{ ok }`；不存在 404、非 running/paused 可停 409                                                                                              |
| `POST /api/me/jobs/:id/pause`            | 无                                                                                                                                                                                                                 | `{ ok }`；不存在 404、仅 running 可暂停（否则 409）                                                                                           |
| `POST /api/me/jobs/:id/resume`           | 无                                                                                                                                                                                                                 | `{ ok }`；不存在 404、仅 paused 可继续（否则 409）                                                                                            |
| `GET /api/me/archive`                    | `site`（默认 1）、`q`、`page`、`limit`（默认 50 上限 100）、`sort`（title\|tid\|archived_at 默认 tid）、`order`                                                                                                    | `{ items, nextPage?, total }` 归档目录                                                                                                        |
| `GET /api/me/archive/status`             | `site`（默认 1）                                                                                                                                                                                                   | `{ total, maxTid, cursor }` 归档库规模与续跑游标                                                                                              |
| `GET /api/me/export`                     | 无                                                                                                                                                                                                                 | 下载 JSON 备份（version: 3；items/favorites/tags/bookmarks/groups/archive_posts/character_names/character_clusters/cursors/reading_sessions） |
| `POST /api/me/sessions`                  | body `{ site?, kind, id, title, startedAt, durationS }`                                                                                                                                                            | 记一段阅读会话 `{ ok }`；`site`/`id` 走 `assertSafeId`、`kind` 限 post\|book，非法 400；`durationS<3` 丢弃、`>300` clamp，`startedAt>now+5m` 400 |
| `GET /api/me/stats`                      | `site?`                                                                                                                                                                                                            | `{ summary: { totalDurationS, currentStreak, longestStreak, activeDays, thisWeekS, thisMonthS, trackedSince, lastActiveAt }, calendar, timeOfDay, topItems, recentSessions, inventory }`；省略 `site` 跨站 |

错误处理：

- `ExtractorError` 使用其 `statusCode`（实现于 `core/upstream/errors.go`，经 `httputil.Error(w, err)` 统一映射）。
- `UpstreamTimeoutError` 返回 `504`；`context.DeadlineExceeded` 与 `net.Error.Timeout()` 同样映射 504。
- 上游非 2xx 返回 `502`；上游 `404`/`410` 映射 `404`（内容不存在）。
- 其余未知错误返回 `500`。
- 错误体统一为 `{ "error": "..." }`。
- `AuthError` 使用其 `statusCode` 与 `error` 字符串。
- 400：`oidc disabled`、`url mismatch`、`invalid state`、`invalid_grant`。
- 401：`unauthorized`（会话或 ID Token）。
- 502：`oidc upstream`。ID Token 的 `iss`/`aud`/`exp`/`nonce` 校验失败同样映射 502（`invalid id token: ...`、`id token issuer mismatch`、`id token audience mismatch`、`id token nonce mismatch`）。

列表响应使用 `LIST_CACHE_HEADERS`（`s-maxage=60`），正文响应使用 `CONTENT_CACHE_HEADERS`（`s-maxage=300`）。

`GET /api/posts` / `GET /api/books` 带 `refresh=1` 时跳过缓存强制抓上游：成功覆盖缓存，失败回退旧缓存并附 `stale`/`refreshError`，无旧缓存则抛错。正文缓存命中是 `public, max-age=300`；只有 `refresh=1` 或 `stale` 才 `no-store`（统一走 `httputil.ContentHeaders`）。全部 `/api/me/*` 响应使用 `NO_STORE_HEADERS`。

请求防护（`internal/api/limits.go`）：

- 所有 `/api/*` 请求体上限 1 MiB（`http.MaxBytesReader`），超限由 handler 返回 400。

## 环境变量

| 变量                         | 默认值                  | 说明                                                                                           |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                       | `3001`                  | API 端口；Docker 内为 `3000`                                                                   |
| `HOSTNAME`                   | `0.0.0.0`               | 监听地址                                                                                       |
| `WEB_DIST`                   | `frontend/dist`         | SPA 静态目录；存在时才托管                                                                     |
| `DATA_DIR`                   | `./data`                | SQLite 库与内容缓存目录；Docker 内为 `/data`                                                   |
| `HTTPS_PROXY` / `HTTP_PROXY` | 无                      | 上游请求代理                                                                                   |
| `TZ`                         | `Asia/Shanghai`         | 进程本地时区；启动时 `time.LoadLocation` 并写入 `time.Local`，日志打印解析结果。时区数据由二进制内嵌 `time/tzdata` 提供，镜像不含 zoneinfo |
| `API_PROXY`                  | `http://127.0.0.1:3001` | Vite dev 代理目标                                                                              |
| `OIDC_ISSUER`                | 无                      | OIDC 发行方（Pocket ID）URL；与其它 4 项任一缺失则关闭 OIDC 并启动告警                         |
| `OIDC_CLIENT_ID`             | 无                      | OIDC 客户端 ID                                                                                 |
| `OIDC_CLIENT_SECRET`         | 无                      | OIDC 客户端密钥                                                                                |
| `OIDC_REDIRECT_URI`          | 无                      | OIDC 回调地址；须与 Pocket ID Client 注册一致                                                  |
| `AUTH_SECRET`                | 无                      | 会话签名密钥（HMAC，≥32 字符）。过短不会退出，只会让 OIDC 保持关闭、`/api/me/*` 对匿名开放     |
| `OIDC_BUTTON_TEXT`           | `使用 Pocket ID 登录`   | 登录按钮文案（可选）                                                                           |
| `ALLOWED_ORIGINS`            | 无                      | 逗号分隔的跨源白名单；为空时不挂 CORS（同源部署无需跨域）                                      |
| `TRUST_PROXY`                | 无                      | 设为 `1` 时才信任 `X-Forwarded-For`/`X-Real-IP`（`middleware.RealIP`）。反向代理后必须设，否则日志里的客户端 IP 可被伪造头冒充 |

## 常见改动路径

- 新增前端页面：在 `frontend/src/App.tsx` 注册路由，必要时在 `frontend/src/lib/routes.ts` 添加导航项和 API 常量，页面放到 `frontend/src/pages/`（必须复用 `shadcn/ui` 组件）。
- 新增 API：在 `backend/internal/api/router.go` 注册路由，控制器在对应领域包（如 `provider/cool18`、`provider/xchina` 或 `api/me`）。
- 改动历史/收藏/标签或内容缓存：数据层在 `backend/internal/storage/`，API 层在 `backend/internal/api/me/`；加列/加索引走 `db.go` 的顺序迁移。
- 改动任务（jobs）系统：执行器在 `backend/internal/jobs/`（`archive_posts` / `archive_books` / `archive_auto_group` / `archive_linked`），数据持久化在 `backend/internal/storage/job.go`。链接归档（`archive_linked`）消费 `archive_frontier` 队列：评论即章节/正文内链指向的帖子不在 feed 里（上游翻页有深度上限），靠浏览时收割 + 队列消费补进归档目录。
- 新增内容源切片：在 `backend/internal/provider/<site>/` 建立独立领域切片，实现专属的 extractor 与 service，在 `backend/internal/api/router.go` 挂载路由。
- 调整正文清洗：统一在 `backend/internal/core/sanitize/sanitize.go` 管道中维护。
- 鉴权逻辑：核心在 `backend/internal/auth/` 与 API 控制器 `backend/internal/api/auth/`。

## 验证

```bash
# 后端测试
cd backend && go test ./...

# 前端类型检查与构建
cd frontend && bun run typecheck && bun run build
```

改动涉及 Docker 或生产托管时，可额外验证：

```bash
docker build -t purifier:latest .
docker run -p 3000:3000 purifier:latest
```

上游不可达时记得为请求配置 `HTTPS_PROXY`，否则启动后的抓取接口会超时。

## 生产部署、备份与运维指南 (Oracle Cloud)

### 1. 部署架构信息

- **目标主机**：`oracle-cloud` (CPU: `aarch64` / ARM64，4 核 / 22G)
- **源码构建目录**：`~/sources/purifier`（rsync 同步的构建副本，不是权威源；权威源始终是本地工作区）
- **Compose 目录**：`~/composes/purifier/compose.yaml`
- **持久化数据**：`~/datas/purifier`（挂载至容器内部 `/data`，包含 SQLite 库 `purifier.db` 及二级磁盘缓存 `cache/`）
- **外部网络**：`my-bridge` (通过 Nginx Proxy Manager 反向代理提供 HTTPS 访问)
- **镜像名称**：`purifier:latest`（远端本地构建，**不带 registry 前缀**）

镜像名不带 registry 前缀是硬约束：只要标签带 `ghcr.io/...`，`compose up`、`docker pull`、Watchtower 任一路径都可能把线上换回 GHCR 的旧镜像。仓库内已删除 GitHub Actions 构建 workflow，GHCR 不再是镜像来源。

purifier 通过 `com.centurylinklabs.watchtower.enable=false` 排除在 Watchtower 之外（容器级 label，不改全局 `WATCHTOWER_DISABLE_CONTAINERS`）。**禁止**给它加回自动更新，镜像只能由本流程产出。

### 2. 标准更新与发布流程 (Rsync Source -> Remote Build -> Deploy)

生产环境原生 arm64，直接在服务器上构建：源码只有 1.6MB / 217 文件，rsync 耗时 ~1s；首次构建 ~53s（基础镜像已预热），改代码后命中 BuildKit 缓存约 3s。不要再用 `docker save` 传镜像。

#### Step 1: 远程数据与配置安全备份（发布前必须执行）

```bash
# 1. 备份数据目录 (SQLite 与缓存)
ssh oracle-cloud "tar -czvf ~/datas/purifier-backup-\$(date +%Y%m%d%H%M%S).tar.gz -C ~/datas purifier"

# 2. 备份 Compose 配置文件
ssh oracle-cloud "cp ~/composes/purifier/compose.yaml ~/composes/purifier/compose.yaml.bak-\$(date +%Y%m%d%H%M%S)"
```

#### Step 2: 同步源码并打回滚点

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'data' \
  --exclude 'backend/bin' \
  --exclude '.worktrees' \
  --exclude '.DS_Store' \
  ./ oracle-cloud:~/sources/purifier/

# 回滚点必须在 build 之前打，否则备份到的是新镜像
ssh oracle-cloud "docker tag purifier:latest purifier:backup-\$(date +%Y%m%d%H%M%S)"
```

`--delete` 会清掉远端构建副本里已删除的文件，保证构建内容与本地一致；因为构建目录只放源码，该行为是安全的。

#### Step 3: 远端构建并重建容器

```bash
ssh oracle-cloud "cd ~/sources/purifier && docker build -t purifier:latest ."

ssh oracle-cloud "cd ~/composes/purifier && docker compose up -d --force-recreate"
```

构建产物自检（可选，改动涉及抓取/前端时建议做）：

```bash
ssh oracle-cloud "docker run --rm --entrypoint sh purifier:latest -c 'ls /app/purifier /app/web | head'"
```

#### Step 4: 服务健康与功能验证

```bash
# 查看容器状态与内建探针 (需显示 healthy)
ssh oracle-cloud "docker ps -f name=purifier"

# 验证健康探针接口响应
ssh oracle-cloud "docker exec purifier wget -qO- http://127.0.0.1:3000/api/health"

# 检查最新容器启动日志
ssh oracle-cloud "docker logs --tail 50 purifier"
```

上线要看到容器 `Up (healthy)`，且 `docker inspect purifier` 的 `.Image` 是刚构建的 ID。镜像构建成功不代表线上换了镜像，这两步都要看。

#### 镜像清理

`backup-*` tag 只保留最近 3 个，避免镜像堆积（该机 build cache 已占数十 GB）：

```bash
ssh oracle-cloud "docker images purifier --format '{{.Tag}}' | grep '^backup-' | sort -r | tail -n +4 | xargs -r -I{} docker rmi purifier:{}"
```

### 3. Compose 参考配置 (`composes/purifier/compose.yaml`)

```yaml
networks:
  my-bridge:
    external: true
    name: my-bridge

services:
  purifier:
    container_name: purifier
    environment:
      - TZ=Asia/Shanghai
      - PORT=3000
      - HOSTNAME=0.0.0.0
      - DATA_DIR=/data
      - OIDC_ISSUER=https://pocket-id.example.com
      - OIDC_CLIENT_ID=your-client-id
      - OIDC_CLIENT_SECRET=your-client-secret
      - OIDC_REDIRECT_URI=https://purifier.example.com/login
      - AUTH_SECRET=your-32-chars-auth-secret
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health | grep -q '\"status\":\"ok\"' || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    image: purifier:latest
    labels:
      - com.centurylinklabs.watchtower.enable=false
    networks:
      - my-bridge
    restart: always
    volumes:
      - $HOME/datas/purifier:/data
```

### 4. 故障快速回滚流程

若上线后出现异常需紧急回退（镜像全部在本地，无需拉取远端仓库）：

```bash
# 1. 列出可用回滚点
ssh oracle-cloud "docker images purifier --format '{{.Tag}} {{.CreatedAt}}' | grep '^backup-' | head"

# 2. 把备份 tag 指回 latest，再重建容器
ssh oracle-cloud "docker tag purifier:backup-<TIMESTAMP> purifier:latest"
ssh oracle-cloud "cd ~/composes/purifier && docker compose up -d --force-recreate"

# 3. 若同时改坏了 compose.yaml
ssh oracle-cloud "cp ~/composes/purifier/compose.yaml.bak-<TIMESTAMP> ~/composes/purifier/compose.yaml"

# 4. 若数据库损坏（会丢掉备份时间点之后的数据）
ssh oracle-cloud "rm -rf ~/datas/purifier && tar -xzvf ~/datas/purifier-backup-<TIMESTAMP>.tar.gz -C ~/datas"
```

回滚只切 tag，不回退远端源码副本：`~/sources/purifier` 是构建输入，不是发布产物，回滚后再按新流程发布即可覆盖。
