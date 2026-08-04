# 历史 / 收藏 / 标签 / HTML 缓存设计

日期：2026-08-04

## 背景与目标

当前 Purifier 完全无状态：API 每次请求都实时抓取 cool18，前端没有任何持久化。本设计为个人单用户部署增加四块能力：

- 浏览历史：全量保留，可搜索
- 收藏：单一收藏列表，可搜索
- 标签：自由文本多标签，可点击筛选贴子/书库
- 内容缓存：正文/书库/回复的原始 HTML 落盘，手动刷新，可手动清空

## 已确认的产品决策

- 个人单用户部署，无账号系统
- 状态存 API 端 SQLite 单文件；HTML 缓存为独立文件
- 历史记录贴子（`post`）与书库（`book`），全量保留，按最近访问倒序，支持标题 + 标签搜索
- 收藏为单一列表，支持标题 + 标签搜索
- 标签为自由文本，一个对象可挂多个；点击标签可筛选贴子/书库
- HTML 缓存只覆盖正文页、书库页、回复页；列表页保持实时抓取
- 缓存默认永不过期，页面提供"刷新"按钮触发重新抓取
- 缓存不设容量上限，提供手动清空入口
- 历史/收藏搜索不全文检索正文，只匹配标题与标签
- 前端提供三个独立导航入口：历史、收藏、标签

## 架构

- 持久化层放在 `packages/core`，新增存储模块，API 不直接接触 SQL
- 抓取逻辑保持现有 `Cool18Extractor` 不变；缓存命中时读取 HTML 文件后仍走提取逻辑
- 新增状态端点统一挂在 `/api/me/*` 下
- 正文/书库接口增加 `refresh=1` 参数，用于手动刷新

## 存储

新增环境变量 `DATA_DIR`，默认 `./data`；Docker 内默认 `/data`。

### SQLite 文件

`$DATA_DIR/purifier.db`，使用 Bun 内置 `bun:sqlite`，共三张表：

```sql
CREATE TABLE IF NOT EXISTS items (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS favorites (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  favorited_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS tags (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
  id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);
CREATE INDEX IF NOT EXISTS idx_items_visited ON items (last_visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_time ON favorites (favorited_at DESC);
```

历史即 `items` 全表；收藏与标签只存关系，展示标题从 `items` 读取，因此清空 HTML 缓存不会影响历史/收藏/标签。

标签写入前统一处理：trim、折叠连续空白、最长 24 个字符；空标签直接忽略。整体替换语义：提交的标签集合即为该对象最终标签。

### 缓存文件

缓存目录为 `$DATA_DIR/cache/`，文件名由类型与 ID 唯一决定，不建元数据表：

| 内容       | 文件名             |
| ---------- | ------------------ |
| 贴子正文   | `post-<tid>.html`  |
| 书库内容   | `book-<cid>.html`  |
| 贴子回复   | `replies-<tid>.html` |

三个上游 URL 均可由 ID 唯一推导，对应关系：

- `https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=<tid>`
- `https://www.cool18.com/bbs4/index.php?app=book&act=bookview&cid=<cid>`
- `https://www.cool18.com/bbs4/index.php?app=forum&act=achildlist&tid=<tid>`

文件大小与更新时间直接从文件系统读取。实现时必须校验 `tid/cid` 只包含安全字符（数字与字母），防止路径穿越。清空缓存即删除 `cache/` 目录下全部文件。

## API

### 状态端点（`/api/me/*`）

| 方法 | 路径与参数 | 行为 |
| ---- | ---------- | ---- |
| GET  | `/api/me/history?q=&kind=&page=` | 全量历史，按最近访问倒序；`q` 匹配标题或标签，`kind` 可筛选 `post`/`book` |
| GET  | `/api/me/favorites?q=&kind=&page=` | 收藏列表，按收藏时间倒序，支持同样搜索 |
| GET  | `/api/me/tags` | 全部标签及计数，按数量倒序 |
| GET  | `/api/me/items?tag=&q=&kind=&page=` | 按标签筛选出的对象列表；`tag` 必填 |
| GET  | `/api/me/state?kind=&id=` | 单个对象的已读状态、访问次数、是否收藏、标签列表 |
| PUT  | `/api/me/favorites?kind=&id=` | 收藏；对象必须已存在于 `items`（正文页打开后会自动创建），否则 404 |
| DELETE | `/api/me/favorites?kind=&id=` | 取消收藏 |
| PUT  | `/api/me/tags` | Body `{ kind, id, tags: string[] }`，整体替换标签 |
| POST | `/api/me/cache/clear` | 清空 `cache/` 目录，返回 `{ cleared: n }` |

历史记录不设独立写入端点：正文/书库接口成功响应后自动 upsert `items` 并累计访问次数。

列表类状态端点统一返回 `{ items, nextPage? }`，`page` 语义与现有列表接口一致。

### 正文/书库端点扩展

`GET /api/posts?tid=&refresh=1` 与 `GET /api/books?cid=&refresh=1`：

- 无 `refresh`：先查缓存文件，命中则读文件并提取，未命中则抓上游并落盘
- 有 `refresh`：跳过缓存直接抓上游；成功后覆盖缓存文件
- 刷新失败但旧缓存存在：返回 200，响应带 `stale: true` 与 `refreshError`，前端显示轻提示
- 刷新失败且无旧缓存：走现有 502/504 错误映射

回复请求同样读写 `replies-<tid>.html`；`refresh=1` 时回复与正文一起重新抓取。

列表端点（`/api/posts?mtid=`、`/api/browse`、`/api/categories`、`/api/featured`、`/api/picks`、`/api/comments`、`/api/trending`）保持不变，不缓存。

## 前端

### 导航与路由

`routes.ts` 新增：

- `/history` → 历史页
- `/favorites` → 收藏页
- `/tags` → 标签页

`NAV_ITEMS` 加入三项，移动端导航横向滚动。

### 页面

- 历史页：搜索框 + 类型筛选（全部/贴子/书库）+ 列表；列表项显示标题、类型图标、最近访问时间、标签 chips；复用现有分页组件
- 收藏页：同样的搜索/筛选/列表，每项带"取消收藏"按钮
- 标签页：搜索框 + 标签计数列表；点击标签切换 `?tag=xxx` 并展示该标签下的对象列表，结果内可继续搜索
- 正文页与书库页：标题下方新增操作行，含收藏切换、标签编辑（输入框 + chips，保存时整体替换）、刷新按钮；打开时调 `/api/me/state` 回填状态
- 标签 chips 全局可点，跳转到 `/tags?tag=xxx`
- "清空缓存"入口放在标签页底部"数据管理"区块

## 错误处理

- 非法 `kind`/`id`：400
- SQLite 异常：500，统一 `{ error }`
- 刷新失败但缓存可用：200 + `stale: true`
- 无缓存且上游失败：沿用现有 502/504 映射
- 清空缓存：200 `{ cleared: n }`

## 测试

- `packages/core` 新增 `bun test`，覆盖：
  - 历史 upsert、访问次数累计、标题/标签搜索、类型筛选
  - 收藏添加/取消、列表与搜索
  - 标签整体替换、按标签筛选
  - 缓存文件写入/读取/刷新覆盖/清空
- 验证命令：`bun run typecheck` 与 `bun run build`

## 部署

- `Dockerfile` 中新增 `DATA_DIR=/data` 并创建目录
- README 记录挂载方式：`docker run -v purifier-data:/data ...`
- `bun:sqlite` 为 Bun 内置能力，无需新增原生依赖

## 不在本次范围

- 列表页缓存
- 正文全文搜索
- 多用户/账号体系
- 收藏多列表
- 历史删除/清空
