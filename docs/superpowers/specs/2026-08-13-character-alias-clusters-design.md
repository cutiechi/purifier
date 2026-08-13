# 人物多称呼关联与同色高亮

日期：2026-08-13  
状态：brainstorming 已通过；已按 `review.md` 修订  
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

共享前端类型（`packages/core` 导出）：

```ts
interface CharacterCluster {
  id: number
  hue: number
  names: string[]  // created_at 升序
}
```

高亮压平：`clusters.flatMap(c => c.names.map(name => ({ name, hue: c.hue })))`。

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

`hue` 校验（三层，缺一不可）：

- API：`Number.isInteger(hue) && hue >= 0 && hue <= 359`，否则 400。
- Store：写入前同样校验，非法抛错（防止内部调用绕过 API）。
- `characterHighlight`：clamp 为 0–359 整数后再写入 style（纵深防御，不把任意字符串拼进 HTML）。

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
- `ON DELETE CASCADE` 只覆盖 **删 cluster → 删 names**。删 name **不会**自动删空 cluster，必须走应用层清理（见下）。

### 空 cluster：`pruneEmptyClusters`

空 cluster 必须立即删除。产生空组的路径分散（删最后一个 name、merge 迁走、级联删组），**禁止**在 API handler 里各自 `DELETE cluster`。

Store 提供 `pruneEmptyClusters(scope?: CharacterScope)`：

- 有 scope：`DELETE FROM character_clusters WHERE scope_type=? AND scope_id=? AND id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
- 无 scope：全表同样条件（给 cascade 用）。

`removeCharacter` / `mergeClusters` 在同一事务末尾调用（带当前 scope）。其它写 names 的路径若可能掏空某组，同样调用。测试断言：删光 names / merge 后无 0-name 的 cluster 行。

### 自动配色 `pickHue(used: number[]): number`

仅用于**新建 cluster**（独立标记、split）。recolor / merge 使用请求里的 `hue`。

实现时先 `used = [...new Set(used)]`（用户手动撞色时 `used` 会有重复，去重不影响结果、少做无用比较）。

色相环距离：`d(a,b) = min(|a-b|, 360-|a-b|)`。

```
若 used 为空：返回 85（与 v1 槽 0 的 oklch 色相一致）
否则：对 h = 0..359，取 min_u d(h, u) 最大的 h；
      并列取最小的 h。
```

保证与已占用整数 hue 的最小环距最大；用户事后把两组改成同一 hue 是允许的，之后再 `pickHue` 会把该 hue 视为已占用。

split 时 `used` 含本 scope **所有仍存在的 cluster hue**（包括被拆的那一组），因此新组不会复用原组色相，除非 360 组已经占满（此时最小距离为 0，取并列最小 h——可接受的极限）。

### 迁移（不可逆，可先 export）

放在 `openDatabase` 里、与现有 `PRAGMA table_info` 迁移同一风格。**必须在新 `deleteGroupCascade` 生效前跑完**（见级联）。

检测：

```ts
const cols = db.query("PRAGMA table_info(character_names)").all() as { name: string }[]
if (cols.some((c) => c.name === "color_index")) {
  // 迁移
}
```

无 `character_names` 表、或已无 `color_index`：跳过（新库走 DDL 直接建新结构）。

执行（单事务，与 items site 重建一样，避免半迁移）：

1. `CREATE TABLE character_clusters`（若尚未存在）+ `character_names_new`（新 DDL）。
2. 对旧 `character_names` 每一行：插入一个 cluster，`hue` 由旧 `color_index % 6` 映射：

| slot | hue |
| --- | --- |
| 0 | 85 |
| 1 | 160 |
| 2 | 220 |
| 3 | 300 |
| 4 | 30 |
| 5 | 350 |

   与当前 `globals.css` 里 `.character-mark--N` 的 oklch hue 一致。

3. 插入 `character_names_new`（带 `cluster_id`，无 `color_index`）。
4. `DROP TABLE character_names`；`ALTER TABLE character_names_new RENAME TO character_names`；建 `idx_character_names_cluster`。
5. 每人名各自一组（平等、尚未关联）。`console` 打一条：`migrated N character_names rows to clusters`。

DDL 常量改为新 schema（`CREATE TABLE IF NOT EXISTS` 对新库生效；旧库靠上面的检测迁移，不会被 `IF NOT EXISTS` 跳过）。

### 级联

`deleteGroupCascade`：

1. `DELETE FROM character_clusters WHERE scope_type='group' AND scope_id=String(id)`（新库 names 靠 FK CASCADE）。
2. **再显式** `DELETE FROM character_names WHERE scope_type='group' AND scope_id=String(id)`（旧库无 FK 时的兜底；新库 CASCADE 后这步 changes=0，仍安全）。
3. 删 `group_items` → 删 `groups`（现有顺序）。

清空阅读历史仍不删人物数据。

### 导出

`exportBackup()`：

- `version` 升为 **2**（`character_names` 行形变 + 新增 `character_clusters`；不做导入，但要能和旧版 JSON 区分）。
- 增加 `character_clusters` 数组（表行快照）。
- `character_names` 含 `cluster_id`、**不含** `color_index`。

### 统计库存

`StatsInventory.characters` **仍按 `character_names` 行数**（称呼数），不改成 cluster 数，避免统计页数字无说明地变小。

## API

全部 `/api/me/characters*`，`NO_STORE_HEADERS`。`kind` / `id` / `name` 校验与 v1 相同（`assertSafeId`、`normalizeCharacterName` 1–32、禁换行/Tab）。

`apps/api/src/index.ts` 的 `/api/me/characters` 分支当前只处理 GET/PUT/DELETE，其余 405。**必须增加** `req.method === "PATCH"` → `handleCharactersPatch`，否则 merge/split/recolor 全部 405。

### GET `?kind=&id=`

```
{ scope: { type, id }, clusters: CharacterCluster[] }
```

- 无名单：`clusters: []`。
- **不再**返回扁平 `characters`（破坏性，仅本机 me API）。

### PUT body `{ kind, id, name, clusterId? }`

- 无 `clusterId`：`pickHue` 新建 cluster，放入该 name。
- 有 `clusterId`：组必须属于**当前解析后的 scope**，否则 404；name 挂入该组，继承 hue。
- 同 scope 已有该 name：
  - 已在目标组（或无 clusterId 且已存在）→ **200 幂等**，不改 hue / 隶属。无 `clusterId` 且 name 已存在：返回已有 cluster，**不**新建。
  - 已在**另一组**且请求带了不同 `clusterId` → **409**（提示去面板 merge）。
- 返回 `{ ok, cluster, clusters }`。`cluster` 为本次 name 所在组。

### DELETE `?kind=&id=&name=`

删除该称呼；store 末尾 `pruneEmptyClusters`。`{ ok, removed: 0|1 }`。

### PATCH body `{ kind, id, op, ... }`

| op | 额外字段 | 行为 |
| --- | --- | --- |
| `merge` | `clusterIds: number[]`（去重后 ≥2）、`hue` | 校验均属当前 scope，否则 404。把所有 names 迁到 **id 最小**的 cluster，该 cluster 的 `hue` 写成请求值，`pruneEmptyClusters`。min(id) 只是稳定的内部锚点，不是「主称呼」。 |
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
| 方法非 GET/PUT/PATCH/DELETE | 405 |
| 未知错误 | 500 |

### 现有 API

- `GET /api/me/export`：`version: 2`；增加 `character_clusters`；`character_names` 行形变。
- `GET /api/me/stats` 的 `inventory.characters`：仍是称呼行数。
- 不改内容抓取接口。

## 前端

### `useCharacters`

返回改为以 cluster 为源：

```ts
{
  clusters: CharacterCluster[]
  marks: { name: string; hue: number }[]  // 由 clusters 压平，给高亮用
  scope, error, loading, reload, add, remove, merge, split, recolor
}
```

- `add(name, clusterId?)` → PUT
- `remove(name)` → DELETE
- `merge(clusterIds, hue)` / `split(clusterId, name)` / `recolor(clusterId, hue)` → PATCH

消费方（均需改 props / 查找逻辑）：

| 调用方 | 现用法 | 改为 |
| --- | --- | --- |
| `ReadPage.tsx` / `BookPage.tsx` | `characters` 传给 ArticleView / Panel / Toolbar；`characters.find(...).colorIndex` 给 popover | `marks` → ArticleView；`clusters` → Panel / Toolbar；按 name 在 clusters 里找 hue 与同组 names 给 popover |
| `article-view.tsx` `ContentBody` / `ArticleView` | `characters?: { name, colorIndex }[]` | `characters?: { name, hue }[]`（或改名 `marks`，类型必须换成 hue） |
| `character-panel.tsx` | 平铺 `CharacterName[]` | `clusters: CharacterCluster[]` |
| `character-selection-toolbar.tsx` | `characters: CharacterName[]` | `clusters: CharacterCluster[]`（列出挂靠目标） |
| `character-mark-popover.tsx` | `{ name, colorIndex? }` | `{ name, hue, clusterNames: string[] }`（`clusterNames` 为同组全部称呼，浮层展示「其它」时排除当前 name） |

### 高亮

渲染顺序不变：DOMPurify → `characterHighlight(html, { name, hue }[])`。

输出**仅**额外插入：

```html
<mark class="character-mark" style="--character-mark-h: 137">
```

- `hue` 在纯函数内再 clamp 为 0–359 整数后再写入。
- 删除 `.character-mark--0` … `--5` 以及 `colorSlot`。

正文 mark 与面板/浮条/浮层**色点**共用同一套色相变量（色点不能再依赖已删除的槽类，也不能只写 `background: var(--character-mark-bg)`——该变量将不存在）。

```css
.character-mark,
.character-swatch {
  --character-mark-bg: oklch(0.92 0.06 var(--character-mark-h));
}
.dark .character-mark,
.dark .character-swatch {
  --character-mark-bg: oklch(0.35 0.06 var(--character-mark-h));
}
.reading-body mark.character-mark {
  background: var(--character-mark-bg);
}
.character-swatch {
  background: var(--character-mark-bg);
}
```

组件色点：`className="character-swatch size-2.5 rounded-full"` + `style={{ ["--character-mark-h"]: String(hue) }}`。禁止在 JS 里分亮/暗拼两套 oklch（跟随 `.dark`）。

匹配规则与 v1 相同：人名长度降序；已覆盖区间不再匹配；不把 name 写入属性。

总开关仍 localStorage（默认开）；关闭时不生成 `<mark>`。

### 选区浮条

`CharacterSelectionToolbar` 接收 `clusters`，不再接收扁平 `characters`。

1. `.reading-body` 内选区规则同 v1。
2. 规范化后的 name **尚未**在任一 cluster 的 `names` 中：
   - 主按钮「标记为人物」→ PUT 无 `clusterId`。
   - 下列出已有 cluster：`.character-swatch` + `names.join(" / ")`；点击 → PUT 带 `clusterId`。
3. name **已在**某组：只显示「取消标记」→ DELETE。
4. Esc / 点空白 / 滚动关闭。不在浮条 merge。

### 人物面板

按 cluster 分组（不是平铺人名）：

- 一行一组：`.character-swatch` + 该组全部称呼。
- 点色点：色相条（0–359）→ `PATCH recolor`。
- 称呼操作：删除；组内多于一个时另有「拆出」→ `PATCH split`。
- 组操作「与其他人合并」：选择另一组 → 选色（两组现有 hue 做成可点色块，另提供色相条）→ `PATCH merge`（`clusterIds` 为这两组，`hue` 为所选）。
- merge / 任意写成功后：用返回的 `clusters` **整表替换**本地状态；若面板有「当前选中 cluster id」，**清除或改成 merge 目标（min id）**，禁止继续持有已删除的 cluster id。
- 空态仍引导选中正文标记。

### 点 mark 浮层

`preventDefault` + `stopPropagation` 后显示：该称呼、**同组其它称呼**（`clusterNames` 去掉当前 name）、`.character-swatch`、「取消标记」。不提供改色/合并。

### 数据刷新

PUT/PATCH/DELETE 成功后用返回的 `clusters` 更新本地；高亮 `useMemo` 依赖正文 HTML + `marks` 的 name/hue 序列。

## 错误与降级

| 情况 | 行为 |
| --- | --- |
| GET 失败 | 正文可读；面板可重试；不高亮 |
| 写失败 | 提示错误；本地名单不变 |
| 选区非法 | 不显示浮条 |
| PUT 409 | 提示该称呼已属于其他人，请到面板合并 |
| merge 后面板仍记着旧 cluster id | 不允许：成功后清选中或切到 min id |
| 离组后出现曾隐藏的 post 名单 | 期望行为（与 v1 相同） |

## 测试与验收

### 自动化

- 迁移检测：有 `color_index` 才迁；迁后无该列；每人名一 cluster；hue 按 `% 6` 映射表。无旧列的库再 `openDatabase` 幂等。
- `pickHue([]) === 85`；`pickHue` 对重复 used 与去重后结果相同；同 scope 连续新建 hue 两两不同；跨 scope 的 used 集合独立。
- PUT 无 clusterId 新建；带 clusterId 继承 hue；同组重复 200 幂等；跨组 PUT 409。
- 非法 clusterId / 他 scope 的 id → 404；非法 hue → 400。
- merge：names 进入 min(id)；hue 为请求值；被并入的 cluster 行消失；无空 cluster。
- split：新 cluster、新 hue ≠ 原组；原组 names 少一个；单 name 组 split → 400。
- recolor 只改该组；删光 names 后 `pruneEmptyClusters` 无空行。
- `deleteGroupCascade` 清掉该组 clusters + names（新旧路径：clusters 删除 + names 显式删除）。
- 高亮：长名优先；style 仅为 `--character-mark-h: <整数>`；name 含 `"` / `</mark>` 不注入。
- export `version === 2`，含 `character_clusters` 与带 `cluster_id` 的 `character_names`。
- `inventory.characters` 仍等于 names 行数（两个称呼同一 cluster 计 2）。

### 手动

1. 标记「林远」，再把「少爷」挂到同一组 → 两称呼同色，第三人不同色。
2. 面板改色 → 该组所有称呼一起变；色点与正文 mark 同色（含暗色模式）。
3. 合并两组并另选 hue → 相关称呼同色；面板无悬空选中。
4. 拆出「少爷」→ 新色；「林远」保持。
5. 关总开关无 mark；点链接内 mark 取消且不跳转。
6. **回归（v1 已有，非本功能新开发）**：同组两帖共享名单；将该帖离组后恢复其旧 post 名单（若有）。
7. export JSON 为 version 2 且含新表结构。

## 改动面

| 区域 | 文件（预期） |
| --- | --- |
| DDL / 迁移检测 | `packages/core/src/storage/db.ts`（`PRAGMA table_info` + 事务重建） |
| Store | `packages/core/src/storage/store.ts`：`pruneEmptyClusters`、`mergeClusters` / `splitCharacter` / `recolorCluster`、`deleteGroupCascade` 双删、`exportBackup` version 2、`characters.test.ts` |
| 类型 | `packages/core/src/storage/types.ts`：`CharacterCluster`；`CharacterName` 改为 `{ name, hue }` 或删除后由调用方用压平类型 |
| 高亮纯函数 | `packages/core/src/character-highlight.ts` + 测试；删除 `colorSlot` / `COLOR_COUNT` |
| API | `apps/api/src/index.ts`：characters 分支加 PATCH；GET 改 clusters；`AGENTS.md` |
| 样式 | `packages/ui/src/styles/globals.css`：`--character-mark-h` + `.character-swatch`；删槽类 |
| Hook | `apps/web/src/hooks/use-characters.ts`：返回 `clusters` + `marks` + merge/split/recolor |
| 正文类型 | `apps/web/src/components/article-view.tsx`：`characters`/`marks` 的 `{ name, hue }` |
| UI | `character-panel.tsx`、`character-selection-toolbar.tsx`、`character-mark-popover.tsx` |
| 页面接线 | `ReadPage.tsx`、`BookPage.tsx`（含 popover 查找改 hue + clusterNames） |
| 导出 / 统计 | `exportBackup`；inventory 计数保持 names 行数 |

## 推进顺序（供计划拆分）

1. DDL + `PRAGMA` 检测迁移 + `pickHue` + `pruneEmptyClusters` + store CRUD/merge/split/recolor/cascade 双删 + 测
2. API GET/PUT/PATCH/DELETE（路由加 PATCH）+ export version 2
3. `characterHighlight` 改 hue + CSS 变量与 `.character-swatch`
4. `useCharacters` 改返回形；选区挂靠、面板分组/合并/拆出/改色、mark 浮层同组；Read/Book 接线
5. 手动验收（含 v1 离组回归、色点暗色模式）
