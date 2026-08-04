# AGENTS.md

## 项目概述

Purifier 是一个 Cool18 净化阅读应用，Bun workspace 单仓，Turbo 编排任务：

- `apps/api`：Bun 原生 HTTP API，同时负责生产环境 SPA 静态托管；不使用 Hono / Express / Next。
- `apps/web`：Vite + React 19 SPA，Tailwind CSS 4，React Router 7。
- `packages/core`：`@workspace/core`，包含 Cheerio 抓取器、上游请求、缓存与错误工具。
- `packages/ui`：`@workspace/ui`，共享样式与工具函数。
- `packages/typescript-config`：共享 TypeScript 配置。

上游内容来自 cool18，抓取结果经过清洗后由 API 返回 JSON，前端只渲染安全 HTML 和站内链接。

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
packages/core/src/storage/                # SQLite（历史/收藏/标签）与磁盘内容缓存
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

## API 约定

| 路径                    | 参数                       | 行为                                                    |
| ----------------------- | -------------------------- | ------------------------------------------------------- |
| `GET /api/health`       | 无                         | `{ status: "ok", runtime: "bun" }`                      |
| `GET /api/posts`        | `tid`                      | 帖子正文 + 章节链接 + 元信息 + 跟帖树                   |
| `GET /api/posts`        | `mtid`                     | 首页分页列表 `{ links, nextMtid }`                      |
| `GET /api/books`        | `cid`                      | 书库内容 `{ title, content, meta, url }`                |
| `GET /api/browse`       | `type` 或 `q`，`page`      | 分类 / 关键词列表 `{ category, links, nextPage }`       |
| `GET /api/categories`   | 无                         | `{ links: CategoryLink[] }`                             |
| `GET /api/featured`     | 无                         | `{ links }` 精华热贴                                    |
| `GET /api/picks`        | 无                         | `{ sections }` 扫文推荐分组                             |
| `GET /api/comments`     | 无                         | `{ posts }` 评论榜                                      |
| `GET /api/trending`     | 无                         | `{ posts }` 人气榜                                      |
| `GET /api/me/history`   | `q`、`kind`、`page`        | 阅读历史 `{ items, nextPage? }`                         |
| `DELETE /api/me/history`| `all=1` 或 `kind`+`id` 或 body `{ items }` | 清空全部 / 删单条 / 批量（清空本页）；连带清收藏与标签 |
| `GET /api/me/favorites` | `q`、`kind`、`page`        | 收藏列表；`PUT`/`DELETE` 加/取消收藏（带 `kind`、`id`） |
| `GET /api/me/tags`      | 无                         | `{ tags: TagCount[] }` 全部标签及计数                   |
| `PUT /api/me/tags`      | body `{ kind, id, tags }`  | 整体替换标签 `{ ok, tags }`；对象不存在 404             |
| `DELETE /api/me/tags`   | `tag`                      | 全局删除该标签 `{ ok, removed }`（从所有对象上移除）    |
| `GET /api/me/items`     | `tag`、`q`、`kind`、`page` | 按标签精确筛选 `{ items, nextPage? }`                   |
| `GET /api/me/state`     | `kind`、`id`               | 条目收藏/标签/访问状态；无记录返回 200 空状态           |
| `DELETE /api/me/cache`  | 无                         | 清空内容缓存 `{ cleared: n }`                           |

错误处理：

- `ExtractorError` 使用其 `statusCode`。
- `UpstreamTimeoutError` 返回 `504`。
- 上游非 2xx 返回 `502`。
- 其余未知错误返回 `500`。
- 错误体统一为 `{ "error": "..." }`。

列表响应使用 `LIST_CACHE_HEADERS`（`s-maxage=60`），正文响应使用 `CONTENT_CACHE_HEADERS`（`s-maxage=300`）。

`GET /api/posts` / `GET /api/books` 带 `refresh=1` 时跳过缓存强制抓上游：成功覆盖缓存，失败回退旧缓存并附 `stale`/`refreshError`，无旧缓存则抛错。缓存命中、刷新与全部 `/api/me/*` 响应使用 `NO_STORE_HEADERS`（`no-store`）。

## 环境变量

| 变量                         | 默认值                  | 说明                                         |
| ---------------------------- | ----------------------- | -------------------------------------------- |
| `PORT`                       | `3001`                  | API 端口；Docker 内为 `3000`                 |
| `HOSTNAME`                   | `0.0.0.0`               | 监听地址                                     |
| `WEB_DIST`                   | `apps/web/dist`         | SPA 静态目录；存在时才托管                   |
| `DATA_DIR`                   | `./data`                | SQLite 库与内容缓存目录；Docker 内为 `/data` |
| `HTTPS_PROXY` / `HTTP_PROXY` | 无                      | 上游请求代理，Bun 下走原生 `proxy`           |
| `API_PROXY`                  | `http://127.0.0.1:3001` | Vite dev 代理目标                            |

## 常见改动路径

- 新增前端页面：在 `apps/web/src/App.tsx` 注册路由，必要时在 `routes.ts` 添加导航项和 API 常量，页面放到 `apps/web/src/pages/`。
- 新增 API：在 `apps/api/src/index.ts` 的 `route` 中加分支，内容抓取逻辑放入 `packages/core`。
- 改动历史/收藏/标签或内容缓存：数据层在 `packages/core/src/storage/`（`db.ts` / `store.ts` / `cache.ts`），API 层在 `apps/api/src/index.ts` 的 `/api/me/*` 分支；测试在同目录 `*.test.ts`。
- 新增上游站点：实现 `Extractor` 接口并在 `getExtractor` 注册；解析方法仍返回定义好的模型。
- 调整正文清洗：只改 `Cool18Extractor.extractPreHtml`，并保持输出为清洗后 HTML。

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
