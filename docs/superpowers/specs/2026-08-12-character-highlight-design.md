# 阅读页人物名称标记与高亮

日期：2026-08-12  
状态：brainstorming 已通过；已按 `review.md` 修订，待写实施计划

## 背景

阅读正文经 `Cool18Extractor.extractPreHtml` 清洗后由 API 返回 HTML 片段，前端 `ContentBody`（`article-view.tsx`）再经 DOMPurify 渲染。已有阅读设置（localStorage）、进度/收藏/标签（SQLite）、论坛持久化分组（`groups` / `group_items`）。

长篇小说/连载里人物多，读者希望：**选中人名 → 标记 → 全文同名高亮**，并在同一系列内共享名单。

## 目标

1. 正文选中文字，一键标记为人物；该作用域内全文高亮同名。
2. 论坛：人物名单挂在现有 **group**；未入组帖按 **tid** 独立；**一帖只能属于一组**。
3. 书库：按 **cid** 各章共享。
4. 名单存 SQLite，进入 `/api/me/export` 备份。
5. 颜色自动轮换；人物面板管理 + 点击高亮名可取消。

## 非目标（YAGNI）

- 不改 `/api/posts` / `/api/books` 返回的正文（不高亮写入缓存）。
- **上游 / `extractPreHtml` / `sanitizeContentHtml` 零改动**（后端清洗管线完全不动）。
- 不做自动 NER / 抽人名。
- 不做别名、手动改色、重命名、跨作用域搜索人物。
- 不高亮标题、跟帖。
- 帖子入组时**不**自动把 `scope=post` 名单合并进 `group`（见「入组与作用域」）。
- **不引入 `site` 列**（见下）。

### 多站点边界（与 groups 一致）

v1 **假设论坛单站、书库单站语义**，`character_names` **不带 `site`**，与现有 `groups` / `group_items`（亦无 `site`）对齐。`items` 等其它 `/api/me/*` 带 `site` 是历史分叉；本功能不顺带给 groups 补 `site`。未来多站若 tid/cid 跨站碰撞，需一并重构 groups + characters。

## 方案选择

采用 **后端只存名单 + 前端渲染期包裹 `<mark>`**（相对服务端注入 HTML、或 CSS Highlight API）：不污染内容缓存，开关高亮无需重抓。

渲染管线固定为：

```
DOMPurify（现有配置，不改） → characterHighlight(html, names) → dangerouslySetInnerHTML
```

`<mark>` **只由净化后的纯函数注入**，不再回流 DOMPurify，因此**不修改** DOMPurify 白名单（无需允许 `mark` / `data-*`）。

## 架构

```
选中文字 / 人物面板
        │
        ▼
GET|PUT|DELETE /api/me/characters  ──► Store.character_names
        │                               scope: group | post | book
        ▼
ContentBody：DOMPurify → characterHighlight → <mark class="character-mark character-mark--N">
```

作用域解析（服务端，客户端只传阅读上下文 `kind` + `id`）：

1. `kind=post` + `tid`：查 `group_items`；命中则 `scope_type=group`, `scope_id=String(group_id)`；否则 `post` + `tid`。
2. `kind=book` + `cid`：固定 `book` + `cid`。

`scope_id` **一律 TEXT**；`group` 作用域前后端都用 `String(group_id)`。级联删除时比较也用 `String(id)`（或 SQL 里 `scope_id = ?` 绑定字符串），避免整数/文本隐式转换歧义。

## 数据模型

### 新表 `character_names`

```sql
CREATE TABLE IF NOT EXISTS character_names (
  scope_type  TEXT NOT NULL,  -- 'group' | 'post' | 'book'
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  color_index INTEGER NOT NULL,  -- 单调递增原值，非取模结果
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id, name)
);
```

- PK `(scope_type, scope_id, name)` 已覆盖按作用域等值查询前缀，**不再**另建 `idx_character_names_scope`。
- `name`：提交前规范化（见「选区与 name 规范化」）；应用层限制 1–32 字符。
- **`color_index`（B1 决断）**：存**原始递增值**，不在入库时取模。
  - 新建：`color_index = COALESCE(MAX(color_index), -1) + 1`（空作用域首次为 `0`）。
  - 已存在：幂等，不改 `color_index`。
  - 渲染：`colorSlot = color_index % COLOR_COUNT`，`COLOR_COUNT = 6`。
  - 删光该作用域全部人物后 `MAX` 为 NULL，再添从 `0` 起——**有意**允许复用；未删光时 `MAX` 单调增，已有人物色槽稳定。

### 一帖一组（破坏性语义变更）

当前 `upsertGroup` 用 `INSERT OR IGNORE`，同一 tid **可以**静默存在于多组。本功能将改为**全局一帖一组**：

- `group_items.tid` 增加 **全局 UNIQUE**。
- **迁移（不可逆）**：若已有重复 tid，保留 `group_id` 最小的行，**删除**其余行。这会改变既有用户「一帖出现在多组」的展示，属有意产品收紧，不是静默 bugfix。
- 迁移实现：在 DDL/migrate 路径中执行去重；`console` 或一次启动日志打印「removed N duplicate group_items rows」（个人单用户库，不做 job_log / 额外备份提示；用户可用既有 export 自行备份）。
- `upsertGroup` 行为（显式）：
  1. 插入前 `SELECT group_id FROM group_items WHERE tid = ? AND group_id <> ?`：命中 → 抛错 → API **409**。
  2. **同组已存在**同一 tid → **200 幂等**，**不更新**既有 `title`（保持当前 `INSERT OR IGNORE` 语义）。
  3. 仅跨组冲突返回 409。

### 级联

- **任何**删除 `groups` 行的路径都必须级联清理该组人物名：封装 `deleteGroupCascade(id)`（删 `character_names` where `scope_type='group' AND scope_id=String(id)` → 删 `group_items` → 删 `groups`），供「主动删组」与「移除成员后组空自动删组」共用。
- 清空阅读历史**不**删除人物名（与 groups 策略一致）。

### 入组与作用域

- 入组后阅读只解析到 `group` 作用域；原先该 tid 的 `post` 作用域名单**保留但不展示**。
- **离组后**（移出成员或删组导致不再属于任何组）：作用域重新解析为 `post`，原先 `post` 名单**原样恢复展示**——这是**期望行为**（不是 bug）。
- v1 **不做**自动迁移/合并 post → group。

### 导出

`exportBackup()` 增加 `character_names` 数组（表行快照）。备份 `version` 保持 `1`，仅追加字段。本功能不实现导入恢复。

## API

全部 `/api/me/characters*`，`NO_STORE_HEADERS`。

### 解析参数

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `kind` | query（GET/DELETE）或 body（PUT） | `post` \| `book` |
| `id` | 同上 | `tid` 或 `cid`；校验**复用** `assertSafeId`（与现有 me/内容 API 一致，不另写正则） |
| `name` | DELETE query / PUT body | 见规范化规则；1–32 字 |

### 端点

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/me/characters?kind=&id=` | `{ scope: { type, id }, characters: [{ name, colorIndex }] }`；无则空数组。`colorIndex` 为库内原值；前端自行 `% 6` |
| `PUT` | `/api/me/characters` | body `{ kind, id, name }` → 加入；已存在 200 幂等；返回 `{ ok, character, characters }` |
| `DELETE` | `/api/me/characters?kind=&id=&name=` | `{ ok, removed: 0\|1 }` |

**不校验**对应 `items` 行是否存在（允许「先标后看」）；与 favorites 的 404 对齐**刻意不做**，避免上游 transient / 未访问帖拦下标记。

### 错误

- 非法参数 / 非法 name → 400 `{ error }`
- 加组 tid 跨组冲突 → 409
- 未知错误 → 500

### 现有 API 改动

- `PUT /api/me/groups`：tid 已在他组 → 409；同组重复仍 200 幂等。
- `GET /api/me/export`：含 `character_names`。
- **不改** DOMPurify、extractPreHtml、sanitizeContentHtml。

## 前端

### 页面

- `ReadPage`、`BookPage`（章节正文）加载后拉名单；`kind`/`id` 与当前阅读对象一致。
- 高亮结果用 `useMemo`，依赖「正文 HTML + 名单签名（name/colorIndex 序列）」；名单变更只重跑包裹，不重抓正文。

### 选区与 name 规范化

1. `.reading-body` 内选区 mouseup/touchend。
2. 取 `selection.toString()`，若含换行或制表符 → **拒绝**（不显示浮条）。其余空白 trim；长度须 1–32。
3. 合法则浮条「标记为人物」（已存在则「取消标记」）。
4. 确认 → PUT/DELETE → 更新本地名单 → 重跑高亮。
5. Esc / 点空白 / 滚动关闭浮条。
6. 不要求选区落在单一文本节点；跨 `<a>` 文本选出的名字可标记，高亮时可能出现 `a > mark`。

### 高亮渲染（`ContentBody`）

1. **不修改** DOMPurify 配置；先净化，再调用纯函数。
2. 人名按**长度降序**匹配文本节点；已覆盖区间不再匹配。
3. 输出（无 `data-*`，缩小安全面）：  
   `<mark class="character-mark character-mark--{slot}">…</mark>`  
   其中 `slot = color_index % 6`（0–5）。
4. `COLOR_COUNT = 6`；亮/暗模式用 CSS 变量，例如  
   `--character-mark-0` … `--character-mark-5`（或等价），由 `.character-mark--N` 引用背景色。
5. 总开关「显示人物高亮」存 localStorage（默认开）；**关闭时不生成 `<mark>`**（不是生成后 CSS 隐藏）。

### 安全契约（纯函数）

`characterHighlight(html, characters)`：

- **输入**：已 DOMPurify 净化的 HTML 字符串 + `{ name, colorIndex }[]`。
- **输出**：仅额外插入 `<mark>`；属性**仅** `class`（`character-mark` + `character-mark--N`）。不写 `data-*`，避免把 `name` 塞进属性。
- 文本节点内容来自已净化 HTML，重写时**不得** HTML 反转义。
- 若未来改回把 name 写入属性，必须按属性规则转义；当前方案用 class 色槽，name 只用于文本匹配。
- 单测须覆盖：`name` 含 `"`、`>`、`</mark>` 等时不得破坏 HTML 结构 / 注入标签（匹配字面文本即可，不应把 name 当 HTML 拼接）。

### 点高亮 / 面板

- 点击 `mark`：统一 `preventDefault` + `stopPropagation`，再开浮层（人名、色点、「取消标记」），避免 `a > mark` 时跳转站内链接。
- 「人物」入口（`ItemActions` 一带）：列表色点 + 名 + 删除；总开关；空态文案引导选中标记。

### 纯函数位置

`packages/core`（如 `character-highlight.ts`），供 web 在 DOMPurify 之后调用；`bun test` 覆盖长名优先、结构不破坏、恶意 name 字面量。

## 错误与降级

| 情况 | 行为 |
| --- | --- |
| GET 名单失败 | 正文可读；面板可重试；不高亮 |
| PUT/DELETE 失败 | 提示错误；本地名单不变 |
| 选区非法（空、过长、含换行/制表符） | 不显示浮条 |
| 离组后出现曾隐藏的 post 名单 | **期望行为**（见「入组与作用域」） |

## 测试与验收

### 自动化

- store：增删幂等、`COALESCE(MAX,-1)+1` 空作用域首条为 0、未删光时单调递增、渲染侧 `% 6` 不入库取模。
- store：删组 / 组空自动删 均级联清理 `character_names`（经 `deleteGroupCascade`）。
- store/API：`group_items.tid` UNIQUE；跨组 tid → 409；同组重复 → 幂等且不改 title。
- API：GET 空名单；post 解析到 group vs post；book 作用域；`assertSafeId`；name 规范化/校验。
- 纯函数：长名优先；不破坏已有 `a`/`p`/`br`；`name` 含 `"` / `</mark>` 等不注入；跨作用域同名各自独立 color_index。
- 行为：离组后同一 tid 重新读到 post 作用域旧名单（store 解析 + 列表断言）。

### 手动验收

1. 未入组帖：标两人名 → 刷新仍在 → 轮色高亮（第 7 人与第 1 人同槽可接受）。
2. 同组两章：一章标记，另一章可见；将该帖移出组后，仅该帖恢复其旧 post 名单（若有），组内其余章仍用 group 名单。
3. 书两章同 cid 共享。
4. 关总开关无 mark；再开恢复。
5. 点 mark（含链接内 mark）取消且不跳转；再选中标记。
6. export JSON 含 `character_names`。
7. 将 tid 加入第二组失败（409）；同组再加同一 tid 成功幂等。

## 改动面（实施时）

| 区域 | 文件（预期） |
| --- | --- |
| DDL / 迁移 | `packages/core/src/storage/db.ts` |
| Store | `packages/core/src/storage/store.ts` + `*.test.ts`；`deleteGroupCascade` |
| 高亮纯函数 | `packages/core/src/character-highlight.ts` + 测试 |
| API | `apps/api/src/index.ts`；`AGENTS.md` API 表 |
| 路由常量 | `apps/web/src/lib/routes.ts` |
| 高亮 / 选区 UI | `article-view.tsx`、新组件/hook、Read/Book 页接线 |
| 导出 | `exportBackup` |

## 推进顺序（供计划拆分）

1. DDL + tid UNIQUE 迁移（含去重日志）+ store CRUD / cascade + 测
2. API 端点 + groups 409/同组幂等 + export
3. `characterHighlight` 纯函数 + ContentBody 接线（不改 DOMPurify）
4. 选区浮条 + 面板 + mark 点击拦截
5. Read/Book 接线与手动验收
