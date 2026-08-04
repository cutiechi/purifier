# Purifier

Cool18 净化阅读端：Bun API + Vite React SPA。抓取并清洗 cool18 的帖子、书库、分类和榜单内容，提供适配移动端的干净阅读体验。

## 功能

- 首页时间线：无限滚动加载最新主帖
- 帖子阅读：清洗后的正文、章节链接、元信息和跟帖树
- 书库阅读：按 `cid` 读取藏文
- 分类与搜索：题材分类、栏目关键词、分页浏览
- 榜单页：精华、扫文推荐、评论榜、人气榜
- 深色 / 浅色主题

## 技术栈

- Bun 1.3：workspaces、HTTP server、前端构建与依赖管理
- Vite 7 + React 19 + React Router 7
- Tailwind CSS 4 + lucide-react + next-themes
- `@workspace/core`：基于 Cheerio 的上游抓取与 HTML 清洗
- Turbo：任务编排（build / typecheck / dev）

## 目录结构

```text
apps/
  api/                 # Bun 原生 HTTP API + SPA 静态托管
  web/                 # Vite React 前端
packages/
  core/                # 抓取器、上游请求、缓存与错误工具
  ui/                  # 共享样式与工具函数
  typescript-config/   # 共享 TS 配置
```

## 快速开始

需要 Bun 1.3.14+。

```bash
bun install
bun run dev:api   # API 在 :3001
bun run dev:web   # 前端在 :3000，/api 代理到 :3001
```

也可以直接 `bun run dev` 同时启动两端。

## 生产运行

```bash
bun run build:web
WEB_DIST=apps/web/dist PORT=3000 bun run start
```

生产模式下同一个 API 进程同时提供静态 SPA；非 `/api` 路由回退到 `index.html`，由前端路由接管。

## Docker

```bash
docker build -t purifier:latest .
docker run -p 3000:3000 -e HTTPS_PROXY=http://host:7890 purifier:latest
```

如果部署环境无法直连上游 cool18，需要设置 `HTTPS_PROXY` / `HTTP_PROXY`。

## 环境变量

| 变量                         | 默认值                     | 说明                        |
| ---------------------------- | -------------------------- | --------------------------- |
| `PORT`                       | `3001`（Docker 内 `3000`） | API 监听端口                |
| `HOSTNAME`                   | `0.0.0.0`                  | 监听地址                    |
| `WEB_DIST`                   | `apps/web/dist`            | Vite 构建产物目录           |
| `HTTPS_PROXY` / `HTTP_PROXY` | 无                         | 上游请求使用的代理          |
| `API_PROXY`                  | `http://127.0.0.1:3001`    | Vite dev 的 `/api` 代理目标 |

## API

| 路径                  | 参数                  | 说明                     |
| --------------------- | --------------------- | ------------------------ |
| `GET /api/health`     | 无                    | 健康检查                 |
| `GET /api/posts`      | `tid` 或 `mtid`       | 帖子正文，或首页分页列表 |
| `GET /api/books`      | `cid`                 | 书库内容                 |
| `GET /api/browse`     | `type` 或 `q`，`page` | 分类 / 关键词列表        |
| `GET /api/categories` | 无                    | 分类入口                 |
| `GET /api/featured`   | 无                    | 首页精华热贴             |
| `GET /api/picks`      | 无                    | 扫文推荐分组             |
| `GET /api/comments`   | 无                    | 评论榜                   |
| `GET /api/trending`   | 无                    | 人气榜                   |

错误统一返回 `{ "error": "..." }`，并带对应的 HTTP 状态码。

## 注意事项

- 上游是 HTML 页面，选择器变更可能导致抓取失效；解析逻辑集中在 `packages/core/src/extractor`。
- 正文只保留清洗后的安全 HTML 与站内 `/read/:tid`、`/book/:cid` 链接，外部链接仅保留文字。
- 列表接口默认 `Cache-Control: s-maxage=60`，正文接口为 `s-maxage=300`。
