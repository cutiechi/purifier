# AGENTS.md

## 项目概述

Purifier 是一个 Cool18 净化阅读应用，Bun workspace 单仓，Turbo 编排任务：

- `apps/api`：Bun 原生 HTTP API，同时负责生产环境 SPA 静态托管；不使用 Hono / Express / Next。
- `apps/web`：Vite + React 19 SPA，Tailwind CSS 4，React Router 7。
- `packages/core`：`@workspace/core`，包含 Cheerio 抓取器、上游请求、缓存与错误工具。
- `packages/ui`：`@workspace/ui`，共享样式与工具函数。
- `packages/typescript-config`：共享 TypeScript 配置。

上游内容来自 cool18，抓取结果经过清洗后由 API 返回 JSON，前端只渲染安全 HTML 和站内链接。

OIDC 只锁谁能进实例，登录者共享同一 SQLite。

## 常用命令

| 命令                | 作用                                     |
| ------------------- | ---------------------------------------- |
| `bun install`       | 安装依赖                                 |
| `bun run dev`       | 同时启动 API 与前端                      |
| `bun run dev:api`   | 启动 API（`:3001`，watch）               |
| `bun run dev:web`   | 启动 Vite（`:3000`，`/api` 代理到 3001） |
| `bun run typecheck` | Turbo 全仓类型检查                       |
| `bun run build`     | Turbo 全仓构建                           |
| `bun run build:web` | 只构建前端                               |
| `bun run test`      | 运行测试（`turbo test` → `bun test`）    |
| `bun run start`     | 生产模式运行 API（可托管 `WEB_DIST`）    |
| `bun run format`    | Prettier 格式化                          |

## 目录与关键文件

```text
apps/api/src/index.ts                 # 路由、错误映射、SPA 托管
apps/web/src/App.tsx                  # 前端路由表
apps/web/src/lib/routes.ts            # 路由、API 常量、导航项
apps/web/src/pages/                   # 页面级组件
apps/web/src/components/              # 共享 UI 组件
packages/core/src/extractor/extractor.ts  # Cool18Extractor
packages/core/src/extractor/types.ts      # Extractor 接口与数据模型
packages/core/src/storage/                # SQLite（历史/收藏/书签/标签/jobs/job_logs/archive_posts）与磁盘内容缓存
packages/core/src/jobs/                   # JobRunner / JobHandler 任务执行
packages/core/src/upstream.ts             # 代理请求、超时、缓存头
packages/typescript-config/               # base / react-library 配置
```

## 技术约定

- TypeScript `strict`；`noEmit` 类型检查在各自包内运行。
- API 只使用 Bun 内置 `Bun.serve`，不引入 HTTP 框架。
- 代码风格由 Prettier 定义：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 前端页面导入使用 `@/` 别名；跨包导入使用 `@workspace/...`。
- 前端样式使用 Tailwind CSS 4 工具类，图标优先使用 lucide-react。
- 页面组件放在 `pages/`，可复用 UI 放在 `components/`；路由常量集中在 `lib/routes.ts`。
- 上游解析统一走 `packages/core` 的 `Extractor` 接口，不要在 API 或前端直接解析 HTML。
- 正文安全清洗在 `Cool18Extractor.extractPreHtml`：剥标签、转义文本，只保留 `/read/:tid` 与 `/book/:cid` 站内链接。
- 测试位于 `packages/core`（`bun test`，经根目录 `bun run test` 触发）；改动后用 `bun run test`、`bun run typecheck` 和 `bun run build` 验证。

## 前端路由

| 页面      | 路由         |
| --------- | ------------ |
| Bookmarks | `/bookmarks` |

## API 约定

| 路径                                     | 参数                                                                                                            | 行为                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                        | 无                                                                                                               | `{ status: "ok", runtime: "bun" }`                                                                                                            |
| `GET /api/auth/config`                   | 无                                                                                                               | `{ enabled, buttonText }`                                                                                                                     |
| `GET /api/auth/me`                       | 无                                                                                                               | `AuthMe`；OIDC 开且未登录 401；关则 `enabled: false` 且 claim 为 null                                                                                    |
| `POST /api/auth/authorize`               | 无                                                                                                               | `{ url }` + PKCE Cookie；未开 400 `oidc disabled`                                                                                                |
| `POST /api/auth/callback`                | body `{ url }`                                                                                                  | 成功设会话                                                                                                                                         |
| `POST /api/auth/logout`                  | 无                                                                                                               | 清 Cookie `{ ok }`                                                                                                                             |
| `GET /api/posts`                         | `tid`、`site`（默认 `1`）                                                                                       | 帖子正文 + 章节链接 + 元信息 + 跟帖树                                                                                                         |
| `GET /api/posts`                         | `mtid`、`site`（默认 `1`）                                                                                      | 首页分页列表 `{ links, nextMtid }`                                                                                                            |
| `GET /api/books`                         | `cid`、`chapter`、`site`（默认 `1`）                                                                            | 书库内容 `{ title, content, meta, url }`；`chapter` 为章节号时返回章节正文页，否则返回目录页                                                  |
| `GET /api/browse`                        | `type` 或 `q`、`page`、`site`（默认 `1`）                                                                       | 分类 / 关键词列表 `{ category, links, nextPage }`                                                                                             |
| `GET /api/categories`                    | `site`（默认 `1`）                                                                                              | `{ links: CategoryLink[] }`                                                                                                                   |
| `GET /api/featured`                      | `site`（默认 `1`）                                                                                              | `{ links }` 精华热贴                                                                                                                          |
| `GET /api/picks`                         | `site`（默认 `1`）                                                                                              | `{ sections }` 扫文推荐分组                                                                                                                   |
| `GET /api/comments`                      | `site`（默认 `1`）                                                                                              | `{ posts }` 评论榜                                                                                                                            |
| `GET /api/trending`                      | `site`（默认 `1`）                                                                                              | `{ posts }` 人气榜                                                                                                                            |
| `GET /api/me/history`                    | `q`、`kind`、`page`、`site?`                                                                                    | 阅读历史 `{ items, nextPage? }`；省略 `site` 跨站，带 `site` 只列该站                                                                         |
| `DELETE /api/me/history`                 | `all=1` 或 `kind`+`id` 或 body `{ items }`；均可带 `site`                                                       | 清空全部 / 删单条 / 批量（清空本页）；连带清收藏与标签；`all=1` 省略 `site` 跨站清空，单条/批量默认 `1`                                       |
| `GET /api/me/favorites`                  | `q`、`kind`、`page`、`site?`                                                                                    | 收藏列表 `{ items, nextPage? }`；省略 `site` 跨站，带 `site` 只列该站                                                                         |
| `PUT/DELETE /api/me/favorites`           | `kind`、`id` 走 query；body `{ site? }`（默认 `1`）                                                             | 加 / 取消收藏 `{ ok }`；`PUT` 对象不存在 404                                                                                                  |
| `GET /api/me/tags`                       | `site?`                                                                                                         | `{ tags: TagCount[] }` 全部标签及计数；省略 `site` 跨站统计，带 `site` 只统计该站                                                             |
| `PUT /api/me/tags`                       | body `{ kind, id, tags, site? }`（默认 `1`）                                                                    | 整体替换标签 `{ ok, tags }`；对象不存在 404                                                                                                   |
| `DELETE /api/me/tags`                    | `tag`、`site?`                                                                                                  | 全局删除该标签 `{ ok, removed }`（从所有对象上移除）；省略 `site` 跨站删除，带 `site` 只删该站                                                |
| `GET /api/me/items`                      | `tag`、`q`、`kind`、`page`、`site?`                                                                             | 按标签精确筛选 `{ items, nextPage? }`；省略 `site` 跨站，带 `site` 只列该站                                                                   |
| `GET /api/me/state`                      | `kind`、`id`、`site`（默认 `1`）                                                                                | 条目收藏/标签/访问状态；无记录返回 200 空状态                                                                                                 |
| `PUT /api/me/progress`                   | body `{ kind, id, progress, site?, chapter? }`                                                                  | 保存阅读进度 `{ ok }`；`chapter` 可选，记录 `last_chapter`；对象不存在 404                                                                    |
| `DELETE /api/me/cache`                   | 无                                                                                                              | 清空内容缓存 `{ cleared: n }`                                                                                                                 |
| `GET /api/me/groups`                     | `q`；可选 `page`/`limit`/`favorited=1`/`sort=updated\|title\|chapters`                                          | 无 page/limit 时 `{ groups }` 全量；有 page 或 limit 时 `{ items, nextPage?, total }` 分页；v1 仅论坛                                         |
| `PUT /api/me/groups`                     | body `{ key, title, items:[{tid,title}], author?, genre? }`                                                     | 按 key upsert 并入成员 `{ ok, group }`；`items` 非空；tid 已在其它组 409                                                                      |
| `DELETE /api/me/groups/:id`              | 无                                                                                                              | 删分组（级联成员）`{ ok }`                                                                                                                    |
| `DELETE /api/me/groups/:id/items`        | body `{ items:[{tid}] }`                                                                                        | 移除成员；组空自动删组 `{ ok, removed, deleted }`                                                                                             |
| `PUT/DELETE /api/me/groups/:id/favorite` | 无                                                                                                              | 收藏 / 取消收藏整个分组 `{ ok }`；不存在 404                                                                                                  |
| `GET /api/me/characters`                 | `kind`、`id`                                                                                                    | `{ scope, clusters: [{ id, hue, names }] }`；`kind=post` 且 tid 已在分组时 scope 指向该组                                                     |
| `PUT /api/me/characters`                 | body `{ kind, id, name, clusterId? }`                                                                           | 新增角色（幂等）`{ ok, cluster, clusters }`；`name` 规范化（trim、禁换行/Tab、1-32 字符）后为空 400；跨组同名 409                             |
| `PATCH /api/me/characters`               | body `{ kind, id, op: merge\|split\|recolor, ... }`                                                             | `{ ok, clusters }`                                                                                                                            |
| `DELETE /api/me/characters`              | `kind`、`id`、`name`                                                                                            | 删除角色 `{ ok, removed }`                                                                                                                    |
| `GET /api/me/bookmarks`                  | `kind`+`id`（书可加 `chapter`）或 `q`/`kind`/`page`                                                             | 当前篇不分页 `{ items }`；否则跨站分页 `{ items, nextPage?, total }`                                                                          |
| `POST /api/me/bookmarks`                 | body `{ kind, id, quote, site?, chapter?, note?, scrollProgress }`                                              | `{ ok, bookmark }`；无 item 404、满 50 条 409                                                                                                 |
| `PATCH /api/me/bookmarks/:id`            | body `{ note }`                                                                                                 | 改备注                                                                                                                                        |
| `DELETE /api/me/bookmarks/:id`           | 无                                                                                                              | `{ ok, removed }`                                                                                                                             |
| `GET /api/me/jobs`                       | `type`、`status`、`limit`（默认 20 上限 100）、`offset`                                                         | `{ items, nextPage?, total }` 任务列表                                                                                                        |
| `POST /api/me/jobs`                      | body `{ type, payload? }`                                                                                       | 启动任务 `{ job }`；未知 type 400、同 type 已运行 409                                                                                         |
| `DELETE /api/me/jobs`                    | 无                                                                                                              | 清空已结束任务 `{ ok, removed }`                                                                                                              |
| `GET /api/me/jobs/:id`                   | 无                                                                                                              | `{ job }`；不存在 404                                                                                                                         |
| `DELETE /api/me/jobs/:id`                | 无                                                                                                              | `{ ok }`；不存在 404、运行中 409                                                                                                              |
| `GET /api/me/jobs/:id/logs`              | `limit`（默认 200 上限 1000）、`offset`、`level`、`order`                                                       | `{ items }` 日志                                                                                                                              |
| `POST /api/me/jobs/:id/stop`             | 无                                                                                                              | `{ ok }`；不存在 404、非运行中 409                                                                                                            |
| `GET /api/me/archive`                    | `site`（默认 1）、`q`、`page`、`limit`（默认 50 上限 100）、`sort`（title\|tid\|archived_at 默认 tid）、`order` | `{ items, nextPage?, total }` 归档目录                                                                                                        |
| `GET /api/me/archive/status`             | `site`（默认 1）                                                                                                | `{ total, maxTid, cursor }` 归档库规模与续跑游标                                                                                              |
| `GET /api/me/export`                     | 无                                                                                                              | 下载 JSON 备份（version: 3；items/favorites/tags/bookmarks/groups/archive_posts/character_names/character_clusters/cursors/reading_sessions） |
| `POST /api/me/sessions`                  | body `{ site?, kind, id, title, startedAt, durationS }`                                                         | 记一段阅读会话 `{ ok }`；`id` 走 `assertSafeId`，`durationS<3` 丢弃、`>300` clamp，`startedAt>now+5m` 400                                     |
| `GET /api/me/stats`                      | `site?`                                                                                                         | `{ summary, calendar, timeOfDay, topItems, recentSessions, inventory }`（inventory 含 bookmarks）；省略 `site` 跨站                           |

错误处理：

- `ExtractorError` 使用其 `statusCode`。
- `UpstreamTimeoutError` 返回 `504`。
- 上游非 2xx 返回 `502`。
- 其余未知错误返回 `500`。
- 错误体统一为 `{ "error": "..." }`。
- `AuthError` 使用其 `statusCode` 与 `error` 字符串。
- 400：`oidc disabled`、`url mismatch`、`invalid state`、`invalid iss`、`invalid_grant`。
- 401：`unauthorized`（会话或 ID Token）。
- 502：`oidc upstream`。

列表响应使用 `LIST_CACHE_HEADERS`（`s-maxage=60`），正文响应使用 `CONTENT_CACHE_HEADERS`（`s-maxage=300`）。

`GET /api/posts` / `GET /api/books` 带 `refresh=1` 时跳过缓存强制抓上游：成功覆盖缓存，失败回退旧缓存并附 `stale`/`refreshError`，无旧缓存则抛错。缓存命中、刷新与全部 `/api/me/*` 响应使用 `NO_STORE_HEADERS`（`no-store`）。

## 环境变量

| 变量                         | 默认值                  | 说明                                                                                           |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                       | `3001`                  | API 端口；Docker 内为 `3000`                                                                   |
| `HOSTNAME`                   | `0.0.0.0`               | 监听地址                                                                                       |
| `WEB_DIST`                   | `apps/web/dist`         | SPA 静态目录；存在时才托管                                                                     |
| `DATA_DIR`                   | `./data`                | SQLite 库与内容缓存目录；Docker 内为 `/data`                                                   |
| `HTTPS_PROXY` / `HTTP_PROXY` | 无                      | 上游请求代理，Bun 下走原生 `proxy`                                                             |
| `TZ`                         | `Asia/Shanghai`         | 容器本地时区；阅读统计按本地日分桶，须与用户一致（镜像需含 tzdata，见 Dockerfile runner 阶段） |
| `API_PROXY`                  | `http://127.0.0.1:3001` | Vite dev 代理目标                                                                                  |
| `OIDC_ISSUER`                | 无                       | OIDC 发行方（Pocket ID）URL；与其它 4 项任一缺失则关闭 OIDC 并启动告警                                               |
| `OIDC_CLIENT_ID`             | 无                       | OIDC 客户端 ID                                                                                    |
| `OIDC_CLIENT_SECRET`         | 无                       | OIDC 客户端密钥                                                                                     |
| `OIDC_REDIRECT_URI`          | 无                       | OIDC 回调地址；须与 Pocket ID Client 注册一致                                                             |
| `AUTH_SECRET`                | 无                       | 会话签名密钥（HMAC，≥32 字符，过短启动退出）；轮换会使全部会话失效                                                          |
| `OIDC_BUTTON_TEXT`           | `使用 Pocket ID 登录`       | 登录按钮文案（可选）                                                                                     |

## 常见改动路径

- 新增前端页面：在 `apps/web/src/App.tsx` 注册路由，必要时在 `routes.ts` 添加导航项和 API 常量，页面放到 `apps/web/src/pages/`。
- 新增 API：在 `apps/api/src/index.ts` 的 `route` 中加分支，内容抓取逻辑放入 `packages/core`。
- 改动历史/收藏/标签或内容缓存：数据层在 `packages/core/src/storage/`（`db.ts` / `store.ts` / `cache.ts`），API 层在 `apps/api/src/index.ts` 的 `/api/me/*` 分支；测试在同目录 `*.test.ts`。
- 改动任务（jobs）系统：任务执行在 `packages/core/src/jobs/`（`runner.ts` / `handler.ts` / `handlers/`），数据表在 `packages/core/src/storage/db.ts`（`jobs` / `job_logs` / `archive_posts`），API 在 `apps/api/src/index.ts` 的 `/api/me/jobs*` 分支；测试在对应目录 `*.test.ts`。
- 新增上游站点：在 `packages/core/src/extractor/sites.ts` 的 `SITES` 注册表中加一行，实现 `Extractor` 接口；API 经 `resolveSite(site)` 按 `site` 参数解析对应站点，解析方法仍返回定义好的模型。
- 调整正文清洗：只改 `Cool18Extractor.extractPreHtml`，并保持输出为清洗后 HTML。
- 鉴权在 `packages/core/src/auth/` 与 `apps/api` 的 `/api/auth*`。

## 验证

```bash
bun run test
bun run typecheck
bun run build
```

改动涉及 Docker 或生产托管时，可额外验证：

```bash
docker build -t purifier:latest .
docker run -p 3000:3000 purifier:latest
```

上游不可达时记得为请求配置 `HTTPS_PROXY`，否则启动后的抓取接口会超时。
