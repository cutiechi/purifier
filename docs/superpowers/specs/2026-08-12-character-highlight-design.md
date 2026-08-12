# 阅读页人物名称标记与高亮

日期：2026-08-12  
状态：brainstorming 已通过，待写实施计划

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
- 不做自动 NER / 抽人名。
- 不做别名、手动改色、重命名、跨作用域搜索人物。
- 不高亮标题、跟帖。
- 帖子入组时**不**自动把 `scope=post` 名单合并进 `group`（见「入组与作用域」）。

## 方案选择

采用 **后端只存名单 + 前端渲染期包裹 `<mark>`**（相对服务端注入 HTML、或 CSS Highlight API）：不污染内容缓存，开关高亮无需重抓，与现有 DOMPurify 管线兼容。

## 架构

```
选中文字 / 人物面板
        │
        ▼
GET|PUT|DELETE /api/me/characters  ──► Store.character_names
        │                               scope: group | post | book
        ▼
ContentBody：DOMPurify → 文本节点按长名优先包裹 <mark>
```

作用域解析（服务端，客户端只传阅读上下文 `kind` + `id`）：

1. `kind=post` + `tid`：查 `group_items`；命中则 `scope_type=group`, `scope_id=String(group_id)`；否则 `post` + `tid`。
2. `kind=book` + `cid`：固定 `book` + `cid`。

## 数据模型

### 新表 `character_names`

```sql
CREATE TABLE IF NOT EXISTS character_names (
  scope_type  TEXT NOT NULL,  -- 'group' | 'post' | 'book'
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  color_index INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id, name)
);

CREATE INDEX IF NOT EXISTS idx_character_names_scope
  ON character_names (scope_type, scope_id);
```

- `name`：trim 后存储；应用层限制 1–32 字符。
- `color_index`：新建时取该作用域 `MAX(color_index)+1`，再对预设色数 N（建议 6）取模；已存在则幂等，不改色。

### 一帖一组

- `group_items.tid` 增加 **全局 UNIQUE**（不仅 `(group_id, tid)`）。
- 迁移：若已有重复 tid，保留 `group_id` 最小的行，删除其余。
- `upsertGroup`：插入成员前若 tid 已在**另一组**，失败并由 API 返回 **409**。

### 级联

- 删除 `groups` 行时，显式删除 `character_names` 中 `scope_type='group' AND scope_id=String(id)`（与 `group_items` 一样不单靠隐式魔法）。
- 清空阅读历史**不**删除人物名（与 groups 策略一致）。

### 入组与作用域

- 入组后阅读只解析到 `group` 作用域；原先该 tid 的 `post` 作用域名单**保留但不展示**（孤儿数据，可忽略或日后再做合并工具）。
- v1 **不做**自动迁移/合并。

### 导出

`exportBackup()` 增加 `character_names` 数组（表行快照）。备份 `version` 保持 `1`，仅追加字段（与 archive 扩展方式一致）。本功能不实现导入恢复。

## API

全部 `/api/me/characters*`，`NO_STORE_HEADERS`。

### 解析参数

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `kind` | query（GET/DELETE）或 body（PUT） | `post` \| `book` |
| `id` | 同上 | `tid` 或 `cid`，`/^[A-Za-z0-9]+$/` |
| `name` | DELETE query / PUT body | trim 后 1–32 字 |

### 端点

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/me/characters?kind=&id=` | `{ scope: { type, id }, characters: [{ name, colorIndex }] }`；无则空数组 |
| `PUT` | `/api/me/characters` | body `{ kind, id, name }` → 加入；已存在 200 幂等；返回 `{ ok, character, characters }` |
| `DELETE` | `/api/me/characters?kind=&id=&name=` | `{ ok, removed: 0\|1 }` |

### 错误

- 非法参数 / 非法 name → 400 `{ error }`
- 加组 tid 冲突（改 groups）→ 409
- 未知错误 → 500

### 现有 API 改动

- `PUT /api/me/groups`：tid 已在他组 → 409。
- `GET /api/me/export`：含 `character_names`。

## 前端

### 页面

- `ReadPage`、`BookPage`（章节正文）加载后拉名单；`kind`/`id` 与当前阅读对象一致。

### 选中标记

1. `.reading-body` 内选区 mouseup/touchend：trim 后长度 1–32、无异常跨结构时，在选区旁显示浮条「标记为人物」（已存在则「取消标记」）。
2. 确认 → PUT/DELETE → 更新本地名单 → 重跑高亮。
3. Esc / 点空白 / 滚动关闭浮条。

### 高亮渲染（`ContentBody`）

1. DOMPurify：在现有白名单上允许 `mark`，以及 `data-character`、`data-color`（或等价 data 属性）。
2. 对净化后 HTML 的**文本节点**做替换：人名按**长度降序**；已覆盖区间不再匹配。
3. 输出  
   `<mark class="character-mark" data-character="…" data-color="N">…</mark>`。
4. 预设约 6 色 CSS（亮/暗均可辨）；`data-color` 映射变量。
5. 总开关「显示人物高亮」存 localStorage（默认开）；关闭则跳过包裹。

### 点高亮 / 面板

- 点击 `mark`：浮层显示人名、色点、「取消标记」；不触发站内链接导航。
- 「人物」入口（`ItemActions` 一带）：列表色点 + 名 + 删除；总开关；空态文案引导选中标记。

### 纯函数

匹配/包裹逻辑放在 `packages/core`（如 `character-highlight.ts`）：输入净化后 HTML 字符串 + 人名列表 → 输出带 `<mark>` 的 HTML。前端 DOMPurify 之后调用；`bun test` 覆盖长名优先与结构不破坏。选区标记只把选区 `toString().trim()` 当作 `name` 提交，不要求选区落在单一文本节点。

## 错误与降级

| 情况 | 行为 |
| --- | --- |
| GET 名单失败 | 正文可读；面板可重试；不高亮 |
| PUT/DELETE 失败 | 提示错误；本地名单不变 |
| 选区非法 | 不显示浮条 |

## 测试与验收

### 自动化

- store：增删幂等、color_index、按 scope 列表、删组级联清理人物名。
- store/API：`group_items.tid` UNIQUE；重复 tid → 409。
- API：GET 空名单；post 解析到 group vs post；book 作用域；name 校验。
- 前端纯函数：长名优先；不把标签结构拆坏（给定 HTML 片段断言）。

### 手动验收

1. 未入组帖：标两人名 → 刷新仍在 → 轮色高亮。
2. 同组两章：一章标记，另一章可见。
3. 书两章同 cid 共享。
4. 关总开关无 mark；再开恢复。
5. 点 mark 取消；再选中标记。
6. export JSON 含 `character_names`。
7. 将 tid 加入第二组失败（409）。

## 改动面（实施时）

| 区域 | 文件（预期） |
| --- | --- |
| DDL / 迁移 | `packages/core/src/storage/db.ts` |
| Store | `packages/core/src/storage/store.ts` + `*.test.ts` |
| API | `apps/api/src/index.ts`；`AGENTS.md` API 表 |
| 路由常量 | `apps/web/src/lib/routes.ts` |
| 高亮 / 选区 UI | `article-view.tsx`、新组件/hook、Read/Book 页接线 |
| 导出 | `exportBackup` |

## 推进顺序（供计划拆分）

1. DDL + tid UNIQUE 迁移 + store CRUD + 测
2. API 端点 + groups 409 + export
3. 前端匹配纯函数 + ContentBody 高亮
4. 选区浮条 + 面板 + 点击取消
5. Read/Book 接线与手动验收
