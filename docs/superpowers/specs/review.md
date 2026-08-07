# 设计评审：同书章节折叠（Book Folding）

- 文档：`2026-08-07-book-folding-design.md`
- 日期：2026-08-07
- 结论：**有条件通过**——方向正确、范围克制，但接入点与展开态持久化有实现级缺口；修完 Important 后再写实施计划。

对照现状代码（`HomePage` / `BrowsePage` / `MeListPage` / `picks-sections` / `title-parse` / `icons` / `package.json`）做了核对。

---

## 总体评价

- **问题定义准**：cool18 同书多主帖、无硬书 id、唯一弱信号是 `parseListTitle().title`——与 `title-parse.ts` 行为一致。
- **边界清晰**：纯前端、不改 API/DB/extractor、不做模糊合并/手动拆分、xbookcn 排除——YAGNI 得当。
- **数据流合理**：渲染层 `useMemo` 分组、无限滚动在累积 `links` 上聚合，符合首页现状。
- **主要风险不在启发式本身**（误并已明确接受），而在 **接入文件写错**、**展开状态多实例写 localStorage**、以及 **分页页与无限滚动被当成同一种模式**。

---

## Important（实现前应修进 spec）

### 1. 展开态持久化：组件内多次挂 hook 会互相覆盖

§5 把 `bookKey` / `scope` 交给 `<CollapsibleBookGroup>`，§6 又定义 `useCollapsedBooks(scope)`。若每个 group 实例各自：

```ts
const { isExpanded, toggle } = useCollapsedBooks(scope)
```

则同一页有 N 个组就有 N 份 React state，各自持有「展开 key 数组」的拷贝。典型竞态：

1. 组 A 展开 `book1` → 写 `["book1"]`
2. 组 B 仍持有挂载时的 `[]`，展开 `book2` → 写 `["book2"]`，**抹掉 book1**

刷新后只有最后写入的 key 幸存，与「刷新记住展开」验收项冲突。

**请在 §5–§6 写死所有权（推荐 A）**：

| 方案 | 做法 |
| --- | --- |
| **A. 页面/列表层单例 hook** | 每个页面（或 `MeListPage` / `PicksSections`）调用一次 `useCollapsedBooks(scope)`，把 `isExpanded` / `toggle`（或 `expanded`/`onToggle`）经 props 传给 group |
| **B. Context** | `CollapsedBooksProvider scope=...` 包列表，子组件 `useCollapsedBooks()` 无参读 context |

组件本身只负责 UI + 回调，不直接读写 localStorage。

同时建议对齐命名：storage key 是 `expanded-books`，hook 却叫 `useCollapsedBooks`——二选一，避免实现时默认折叠/展开语义搞反。

---

### 2. 我的列表接入点写错：应改 `MeListPage`，不是三个 Page 壳

§7 表与 §10 改动清单写：

- `HistoryPage.tsx` / `FavoritesPage.tsx` / `MeItemsPage.tsx`

现状：

- 三页列表渲染都在 **`apps/web/src/components/me-list-page.tsx`**（`items.map` → `<MeItemCard>`）。
- `HistoryPage` / `FavoritesPage` 只负责 `buildUrl` / toolbar / trailing，**不渲染列表**。
- **没有** `MeItemsPage.tsx`；标签筛选是 **`TagsPage.tsx`** 的 `TagItemsView`，同样走 `MeListPage`。

若按清单改三个 page 文件，要么改不到列表，要么复制三份分组逻辑。

**建议 §7 / §10 改为**：

| 实际改动 | scope 来源 |
| --- | --- |
| `components/me-list-page.tsx` | prop：`bookGroupScope?: string`（`history` / `favorites` / `me-items`） |
| `HistoryPage` / `FavoritesPage` / `TagsPage` | 只传 scope，不各自实现分组 |

`kind === "post" && site === "1"` 过滤与「其余项按原序 interleave 为 single」的逻辑应落在 **一处** 共享函数（可放 `book-groups.ts`，例如 `groupMeListItems(items)`），避免三页各写一遍。

---

### 3. `getId` 出现在 API 与测试里，算法未使用

§4：

```ts
groupBooks<T>(items, getTitle, getId): GroupedItem<T>[]
```

算法两遍遍历只描述了 title key / 首次顺序 / 长度 ≥2，**从未使用 `getId`**。§9 却写「`getId` 去重作用」。

首页 `loadMore` 已按 `tid` 去重；其它列表一般也无同 tid 双份。

**实现前二选一写清**：

- **A.** 去掉 `getId`，算法与测试只谈 title 分组；或  
- **B.** 明确组内按 `getId` 去重（同 tid 只留首次），并补测试。

否则实现者会「加了参数不知道干啥」或测一个不存在的行为。

---

### 4. 「同首页模式」误导：多数列表是分页，不是无限滚动累积

§7 对 Browse 写「同首页模式」。§8 只强调首页跨批次合并。

现状差异：

| 页面 | 列表形态 | 分组作用域 |
| --- | --- | --- |
| 首页 | 无限滚动，`links` 累积 | 跨批次合并（设计已覆盖） |
| Browse / Search | **分页**，每页替换 `links` | **仅当前页** |
| Featured / Trending / Comments / Picks 组 | 单次拉取 | 当前结果集 |
| History / Favorites / Tags | **分页** `MeListPage` | **仅当前页** |

同书两章若分属历史第 1 页与第 2 页，**不会**折成一组——这与「首页跨批次」体验不同。

**请在 §4 / §8 明示**：除首页累积数组外，分组仅在**当前渲染数组**内进行；分页跨页不合并是接受的限制，不要写成「同首页模式」。

---

### 5. `site === "1"` 门控未进入接入示例

§3 边界写只对 cool18 分组；§4 示例：

```ts
const grouped = useMemo(
  () => groupBooks(links, (l) => l.title, (l) => l.tid),
  [links],
)
```

`HomePage` / `BrowsePage` / 榜单在 `site === "2"` 时仍渲染同一套列表（`bookPath` vs `readPath`）。若无条件调用 `groupBooks`，xbookcn 也可能被标题启发式误折（非目标 §2）。

**建议示例改为**：

```ts
const grouped = useMemo(() => {
  if (site !== "1") {
    return links.map((item) => ({ type: "single" as const, item }))
  }
  return groupBooks(links, (l) => l.title /* , getId? */)
}, [links, site])
```

Picks 当前 `readPath(link.tid)` 无 site、偏 cool18，可单独注明「Picks 默认按 cool18 处理」。

---

### 6. Picks：chip 区块与 `RecommendSection` 命名

§7：`picks-sections.tsx`，每个 `RecommendSection` 内部分组。

代码是 `PicksSections` + `PickSection`，且有两条渲染路径：

- `sectionUsesChips(section)` → 短标签 chip 网格  
- 否则 → `PostCard` 列表（**未**走 `ListPostCard` / `parseListTitle` 展示）

Chip 区多是年份/序号/极短标签，按书名折叠无意义且会破坏布局。

**请写清**：仅非 chip 的 `PostList` 路径做 `groupBooks`；chip 路径保持原样。组件名与文件与代码对齐（`PicksSections` / `PickSection`）。

---

## Suggestion（不阻塞）

### 7. 范围遗漏：`SearchPage`

`SearchPage` 与 Browse 同为 `ChapterLink[]` + `ListPostCard`，cool18 关键词结果同样会出现同书多章。目标列表未包含搜索。

若 YAGNI 刻意排除，在非目标加一句；否则 §7 表加一行 `SearchPage` / scope `search`。

---

### 8. `IconChevronDown` 不存在

§5 写「`IconChevronDown`，已有」。`icons.tsx` 仅有 `IconChevronLeft` / `IconChevronRight`，**无 Down**。

改动清单应增加：在 `icons.tsx` 补 `IconChevronDown`（或实现时用 lucide，但项目列表图标多走本地 `icons.tsx`）。

---

### 9. 历史/收藏展开子项标题冗余

§5 写展开后「各章原卡片，带各自章节副标题」——对 `ListPostCard` 成立（解析后主标题为书名、副标为章节/作者）。

`MeItemCard` 则 **整段 `item.title` 原样展示**，不用 `parseListTitle`。组头已是书名时，子卡仍显示完整「【书名】（第 N 章）作者…」，信息重复。

可选（非必须）：组内 `MeItemCard` 用解析后的 `chapters`/`formatTitleMeta` 作主/副标题；或接受冗余，在 §5 注明 Me 路径展示与列表帖不同。

---

### 10. `parseListTitle` 中段并入 title 导致同书拆组

`title-parse.ts` 在章节与作者之间有短副标时会做 `title = \`${title} · ${midText}\``。同书不同章若中段备注不同，归一化 key 不同 → **不折叠**。

与「只认 title 字段、不模糊合并」一致，但容易被当成 bug。建议 §3 边界加一句，避免验收时扯皮。

---

### 11. localStorage 读写健壮性

同仓 `reading-settings.tsx` 对 `getItem`/`setItem` 有 `try/catch`（隐私模式/配额）。§6 应同样要求：读失败当默认全折叠，写失败静默，内存态仍可切换。

`useEffect` 读入前首屏全折叠再 hydrate——若已展开组较多，可能闪一下；纯 SPA 可接受，可在手动清单加「硬刷新后展开态恢复（允许首帧折叠）」。

---

### 12. 列表计数文案

首页「已载入 N 条」目前是 `links.length`（帖数）。折叠后视觉行数变少，数字仍用帖数更合理；若有人改成 group 数会对不齐无限滚动语义。实现时保持 **计数=原始 item 数** 即可（可在 §8 一句带过）。

---

### 13. a11y 小补

头部 `<button aria-expanded>` 已写。建议补：

- 展开区域 `id` + 按钮 `aria-controls`
- 可折叠组在列表中的 `key` 用 `group:${bookKey}`，避免与 tid key 冲突

---

### 14. 单测与 turbo

§9 给 `apps/web` 加 `"test": "bun test"` 与 turbo `dependsOn: ["^test"]` 级联——与根 `turbo.json` 一致，可行。

建议单测再覆盖：

- `normalizeTitleKey`：`《X》` / `【X】` / `X` 同 key  
- 空 key → single  
- 顺序：首次出现位置 + 组内原始相对序  
- （若保留 getId）组内 id 去重  

组件/localStorage 仍可手测；若 hook 抽成「纯函数 `readExpanded`/`writeExpanded` + thin hook」，可顺带单测序列化，减少 §1 类回归。

---

## 已对齐、不列为问题

- 无硬书 id、仅 title 弱信号、误并接受、不设阈值——产品选择清楚。  
- xbookcn / `kind === "book"` 不参与——与双站模型一致。  
- 空 title key → single——必要。  
- 首页跨 `loadMore` 批次合并——与累积 `links` 一致。  
- 榜单折叠头不显单个 rank——合理。  
- 不改 API / extractor / DB——与范围一致。  
- `normalizeTitleKey` 在 `parseListTitle` 已去书名号后仍去包裹——对兜底 raw 有用，多余但无害。

---

## 建议动作（修进 spec 后再开工）

1. **§5–§6**：展开态所有权改为页面单例 hook（或 Context）；统一 expanded/collapsed 命名；localStorage try/catch。  
2. **§7 / §10**：我的列表改 `me-list-page.tsx` + scope prop；删除不存在的 `MeItemsPage`；对齐 `TagsPage`。  
3. **§4 / §9**：`getId` 要么实装去重，要么删除。  
4. **§4 / §8**：区分无限滚动 vs 分页「仅当前数组」；Browse 勿写「同首页模式」。  
5. **§4 示例**：`site !== "1"` 短路为全 single。  
6. **§7 Picks**：仅非 chip 路径分组；命名对齐 `PicksSections`。  
7. （可选）Search 范围、ChevronDown 图标、Me 子卡标题、parse 中段拆组说明。

1–6 补上后即可按改动清单写 implementation plan；启发式与 UI 骨架不必再大改。
