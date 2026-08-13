# 人物多称呼关联与同色高亮

日期：2026-08-13  
状态：brainstorming 已通过  
前置：`docs/superpowers/specs/2026-08-12-character-highlight-design.md`（已落地）

## 背景

阅读页已能按作用域标记人名并高亮。当前每人名独立一行、`color_index` 单调递增后 `% 6` 取色。同一人的多个称呼（林远 / 少爷 / 远哥）会变成不同色、无法表达「是同一个人」。

v1 非目标明确写了「不做别名、手动改色」；本 spec 只放开这两项，其余边界（作用域、不改上游 HTML、不做 NER）不变。

## 目标

1. 多个称呼可关联为同一人物组；组内称呼彼此**平等**（无主/次）。
2. 同组所有称呼高亮**同一颜色**。
3. 选中正文时可：新建人物，或挂到已有组。
4. 人物面板可：合并两组、从组中拆出一个称呼、随时改整组颜色、删除称呼。
5. 自动配色在本作用域内尽量不重复：存色相 `hue` 0–359，人多时色相接近但整数 hue 不碰撞（用户手动改色允许撞色）。

## 非目标

- 不改 `/api/posts` / `/api/books` 正文，不改上游 / `extractPreHtml` / DOMPurify 白名单。
- 不做 NER、不重命名、不跨作用域搜索人物。
- 不高亮标题、跟帖。
- 帖子入组仍不自动合并 `post` 名单进 `group`。
- 不引入 `site` 列。
- 不做备份导入。
- 正文 mark 浮层不做改色/合并（避免阅读中误触）。
- 选区浮条不做两组合并（合并只在面板）。

## 方案选择

采用 **cluster 实体存颜色 + names 挂组上**（相对「每行复制 color」或「同人边/连通分量」）：颜色是组的属性，称呼平等，合并/拆开/改色都是对组操作。

高亮纯函数仍吃扁平 `{ name, hue }[]`，按称呼字面匹配；色相来自所属 cluster。

## 架构

```
选中文字 / 人物面板
        │
        ▼
GET|PUT|PATCH|DELETE /api/me/characters
        │
        ▼
character_clusters (scope, hue)
character_names    (scope, name, cluster_id)
        │
        ▼
ContentBody：DOMPurify → characterHighlight →
  <mark class="character-mark" style="--character-mark-h: H">
```

作用域解析与 v1 相同：`kind=post` 查 `group_items`，命中则 `group`，否则 `post`；`kind=book` → `book`。`scope_id` 一律 TEXT。

## 数据模型

### `character_clusters`

```sql
CREATE TABLE character_clusters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type  TEXT NOT NULL,  -- 'group' | 'post' | 'book'
  scope_id    TEXT NOT NULL,
  hue         INTEGER NOT NULL,  -- 0–359
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_character_clusters_scope
  ON character_clusters (scope_type, scope_id);
```

应用层约束：`hue` 为整数且 `0 <= hue <= 359`。

### `character_names`（替换现表）

```sql
CREATE TABLE character_names (
  scope_type  TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  cluster_id  INTEGER NOT NULL
              REFERENCES character_clusters(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id, name)
);
CREATE INDEX idx_character_names_cluster
  ON character_names (cluster_id);
```

- 同一作用域内 `name` 唯一 → 一个称呼只能属于一个 cluster。
- **不再**存 `color_index`。
- `scope_*` 冗余在 names 上，以便 PK 与按 scope 列举，不必总是 join。
- 空 cluster（0 个 name）必须立即删除（应用层：删最后一个 name 或 merge 迁走后 `DELETE`）。

### 自动配色 `pickHue(used: number[]): number`

仅用于**新建 cluster**（独立标记、split）。recolor / merge 使用请求里的 `hue`。

色相环距离：`d(a,b) = min(|a-b|, 360-|a-b|)`。

```
若 used 为空：返回 85（与 v1 槽 0 的 oklch 色相一致）
否则：对 h = 0..359，取 min_u d(h, u) 最大的 h；
      并列取最小的 h。
```

保证与已占用整数 hue 的最小环距最大；用户事后把两组改成同一 hue 是允许的，之后再 `pickHue` 会把该 hue 视为已占用。

split 时 `used` 含本 scope **所有仍存在的 cluster hue**（包括被拆的那一组），因此新组不会复用原组色相，除非 360 组已经占满（此时最小距离为 0，取并列最小 h——可接受的极限）。

### 迁移（不可逆，可先 export）

1. 建 `character_clusters` 与新 `character_names`（临时名），再替换。
2. 对旧表每一行：插入一个 cluster，`hue` 由旧 `color_index % 6` 映射：

| slot | hue |
| --- | --- |
| 0 | 85 |
| 1 | 160 |
| 2 | 220 |
| 3 | 300 |
| 4 | 30 |
| 5 | 350 |

   与当前 `globals.css` 里 `.character-mark--N` 的 oklch hue 一致。

3. name 行带上该 `cluster_id`，去掉 `color_index`。
4. 每人名各自一组（平等、尚未关联）。启动时打一条迁移日志即可。

### 级联

`deleteGroupCascade`：删除该 `scope_type='group' AND scope_id=String(id)` 的 **clusters**（names 靠 `ON DELETE CASCADE`）。清空阅读历史仍不删人物数据。

### 导出

`exportBackup()` 在保留 `character_names` 的同时增加 `character_clusters`。`character_names` 快照含 `cluster_id`、**不含** `color_index`。`version` 仍为 `1`。不做导入。

## API

全部 `/api/me/characters*`，`NO_STORE_HEADERS`。`kind` / `id` / `name` 校验与 v1 相同（`assertSafeId`、`normalizeCharacterName` 1–32、禁换行/Tab）。

### GET `?kind=&id=`

```
{ scope: { type, id }, clusters: [{ id, hue, names: string[] }] }
```

- `names` 按 `created_at` 升序。
- 无名单：`clusters: []`。
- 前端高亮前压平为 `{ name, hue }[]`（每 name 复制所属 hue）。

### PUT body `{ kind, id, name, clusterId? }`

- 无 `clusterId`：`pickHue` 新建 cluster，放入该 name。
- 有 `clusterId`：组必须属于**当前解析后的 scope**，否则 404；name 挂入该组，继承 hue。
- 同 scope 已有该 name：
  - 已在目标组（或无 clusterId 且已存在）→ **200 幂等**，不改 hue / 隶属。无 `clusterId` 且 name 已存在：返回已有 cluster，**不**新建。
  - 已在**另一组**且请求带了不同 `clusterId` → **409**（提示去面板 merge）。
- 返回 `{ ok, cluster, clusters }`。`cluster` 为本次 name 所在组。

### DELETE `?kind=&id=&name=`

删除该称呼。若该组无剩余 names，删除 cluster。`{ ok, removed: 0|1 }`。

### PATCH body `{ kind, id, op, ... }`

| op | 额外字段 | 行为 |
| --- | --- | --- |
| `merge` | `clusterIds: number[]`（去重后 ≥2）、`hue` | 校验均属当前 scope，否则 404。把所有 names 迁到 **id 最小**的 cluster，该 cluster 的 `hue` 写成请求值，删除其余空 cluster。 |
| `split` | `clusterId`、`name` | 组须属当前 scope 且含该 name，否则 404。组内 names **必须 ≥2**，否则 400。将该 name 改挂到新 cluster（`pickHue`）。 |
| `recolor` | `clusterId`、`hue` | 只更新该组 `hue`。组须属当前 scope，否则 404。 |

`hue` 必须是 0–359 的整数，否则 400。成功返回 `{ ok, clusters }`（与 GET 同形的当前 scope 全量）。

未知 `op` → 400。

### 错误

| 情况 | HTTP |
| --- | --- |
| 非法 kind/id/name/op/hue | 400 |
| cluster 不存在或不在当前 scope | 404 |
| name 已在另一组，PUT 却指定不同 clusterId | 409 |
| split 时组内不足 2 个 name | 400 |
| merge 去重后不足 2 个 id | 400 |
| 未知错误 | 500 |

### 现有 API

- `GET /api/me/export`：增加 `character_clusters`；`character_names` 行形变。
- 不改内容抓取接口。

## 前端

### 高亮

渲染顺序不变：DOMPurify → `characterHighlight(html, { name, hue }[])`。

输出**仅**额外插入：

```html
<mark class="character-mark" style="--character-mark-h: 137">
```

- `hue` 在纯函数内再 clamp 为 0–359 整数后再写入，禁止把任意字符串拼进 style。
- 删除 `.character-mark--0` … `--5`。
- CSS：

```css
.reading-body mark.character-mark {
  background: oklch(0.92 0.06 var(--character-mark-h));
}
.dark .reading-body mark.character-mark {
  background: oklch(0.35 0.06 var(--character-mark-h));
}
```

匹配规则与 v1 相同：人名长度降序；已覆盖区间不再匹配；不把 name 写入属性。

总开关仍 localStorage（默认开）；关闭时不生成 `<mark>`。

### 选区浮条

1. `.reading-body` 内选区规则同 v1。
2. 规范化后的 name **尚未**在名单中：
   - 主按钮「标记为人物」→ PUT 无 `clusterId`。
   - 下列出已有 cluster：色点 + `names.join(" / ")`；点击 → PUT 带 `clusterId`。
3. name **已在**某组：只显示「取消标记」→ DELETE。
4. Esc / 点空白 / 滚动关闭。不在浮条 merge。

### 人物面板

按 cluster 分组（不是平铺人名）：

- 一行一组：色点 + 该组全部称呼（同一 `--character-mark-h`）。
- 点色点：色相条（0–359）→ `PATCH recolor`。
- 称呼操作：删除；组内多于一个时另有「拆出」→ `PATCH split`。
- 组操作「与其他人合并」：选择另一组 → 选色（两组现有 hue 做成可点色块，另提供色相条）→ `PATCH merge`（`clusterIds` 为这两组，`hue` 为所选）。
- 空态仍引导选中正文标记。

### 点 mark 浮层

`preventDefault` + `stopPropagation` 后显示：该称呼、**同组其它称呼**、色点、「取消标记」。不提供改色/合并。

### 数据刷新

PUT/PATCH/DELETE 成功后用返回的 `clusters` 更新本地；高亮 `useMemo` 依赖正文 HTML + 压平后的 name/hue 序列。

## 错误与降级

| 情况 | 行为 |
| --- | --- |
| GET 失败 | 正文可读；面板可重试；不高亮 |
| 写失败 | 提示错误；本地名单不变 |
| 选区非法 | 不显示浮条 |
| PUT 409 | 提示该称呼已属于其他人，请到面板合并 |
| 离组后出现曾隐藏的 post 名单 | 期望行为（与 v1 相同） |

## 测试与验收

### 自动化

- 迁移：旧每人名 → 独立 cluster；hue 按 `% 6` 映射表；无残留 `color_index`。
- `pickHue([]) === 85`；同 scope 连续新建，hue 两两不同；跨 scope 的 used 集合独立。
- PUT 无 clusterId 新建；带 clusterId 继承 hue；同组重复 200 幂等；跨组 PUT 409。
- 非法 clusterId / 他 scope 的 id → 404。
- merge：names 进入 min(id)；hue 为请求值；被并入的 cluster 行消失。
- split：新 cluster、新 hue ≠ 原组；原组 names 少一个；单 name 组 split → 400。
- recolor 只改该组；删光 names 后无空 cluster。
- `deleteGroupCascade` 清掉该组 clusters + names。
- 高亮：长名优先；style 仅为 `--character-mark-h: <整数>`；name 含 `"` / `</mark>` 不注入。
- export 含 `character_clusters` 与带 `cluster_id` 的 `character_names`。

### 手动

1. 标记「林远」，再把「少爷」挂到同一组 → 两称呼同色，第三人不同色。
2. 面板改色 → 该组所有称呼一起变。
3. 合并两组并另选 hue → 相关称呼同色。
4. 拆出「少爷」→ 新色；「林远」保持。
5. 关总开关无 mark；点链接内 mark 取消且不跳转。
6. 同组两帖共享 clusters；将该帖离组后恢复其旧 post 名单（若有）。
7. export JSON 含新表结构。

## 改动面

| 区域 | 文件（预期） |
| --- | --- |
| DDL / 迁移 | `packages/core/src/storage/db.ts` |
| Store | `packages/core/src/storage/store.ts` + `characters.test.ts` |
| 类型 | `packages/core/src/storage/types.ts`（Cluster 替代扁平 CharacterName 的 API 形） |
| 高亮纯函数 | `packages/core/src/character-highlight.ts` + 测试 |
| API | `apps/api/src/index.ts`；`AGENTS.md` |
| 样式 | `packages/ui/src/styles/globals.css` |
| UI | `character-panel.tsx`、`character-selection-toolbar.tsx`、`character-mark-popover.tsx`、`use-characters.ts`、`article-view.tsx` |
| 导出 | `exportBackup` |

## 推进顺序（供计划拆分）

1. DDL 迁移 + `pickHue` + store CRUD/merge/split/recolor/cascade + 测
2. API GET/PUT/PATCH/DELETE + export 形变
3. `characterHighlight` 改 hue + CSS 变量
4. 选区挂靠、面板分组/合并/拆出/改色、mark 浮层显示同组
5. Read/Book 接线与手动验收
