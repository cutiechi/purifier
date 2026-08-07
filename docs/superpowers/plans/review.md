# 实现计划评审：同书章节折叠（Book Folding）

- 计划：`2026-08-07-book-folding.md`
- 对照：`docs/superpowers/specs/2026-08-07-book-folding-design.md`（v2）
- 日期：2026-08-07
- 结论：**不可原样执行**——Task 1 的 `groupMeListItems` 与单测/spec 语义冲突（按片段实现会挂测）；另有 Trending href 回归与组头 meta 未接线。修完 Critical/Important 后再按 Task 开工。

计划整体结构清楚（TDD 纯函数 → hook/图标/组件 → 页面接入 → 全量验证），与 v2 spec 的接入点（`MeListPage`、Picks 非 chip、`useExpandedBooks` 单例、分页作用域）对齐。问题集中在**可贴代码块与测试/spec 不一致**。

---

## Critical

### 1. `groupMeListItems`：连续 post 段分组 ≠ 全局 interleave；单测必挂

Task 1 接口说明与测试期望：

```ts
// [post p1 故事1, book b1, post p2 故事2]
// → length 2：group([p1,p2]) + single(b1)
```

即：**所有** `post` 参与同一套 `groupBooks`，book 按原序 interleave；两章被 book 隔开仍应合成一组。

Task 1 Step 4 实现却是：

```ts
// 收集连续 post 段 → 仅对每段 groupBooks
while (kind === "post") seg.push(...)
for (const g of groupBooks(seg, ...)) result.push(g)
```

对上述输入：

| 段 | 结果 |
| --- | --- |
| `[p1]` | single p1 |
| book | single b1 |
| `[p2]` | single p2 |

→ **length 3、无 group**，与测试 `toHaveLength(2)` / `type === "group"` 直接冲突。Step 5「6 个 test 全部 PASS」不成立（且测试实际是 7 个，见 Suggestion）。

这与 design §7「book 直通 single、post 按 title 分组、保持原序 interleave」也不符。

**应改成（示意）原序 walk + 全局 post 桶：**

```ts
export function groupMeListItems(
  items: MeListItem[],
): GroupedItem<MeListItem>[] {
  const eligible = (it: MeListItem) => it.kind === "post" && it.site === "1"
  // 先对 eligible 子集算 key/桶（或复用 groupBooks 思想）
  const orderKeys: string[] = []
  const buckets = new Map<string, MeListItem[]>()
  const displayTitle = new Map<string, string>()
  for (const it of items) {
    if (!eligible(it)) continue
    const parsed = parseListTitle(it.title)
    const key = normalizeTitleKey(parsed.title)
    if (!key) continue
    if (!buckets.has(key)) {
      orderKeys.push(key) // 仅用于调试可不要
      displayTitle.set(key, parsed.title)
      buckets.set(key, [])
    }
    buckets.get(key)!.push(it)
  }

  const emitted = new Set<string>()
  const result: GroupedItem<MeListItem>[] = []
  for (const it of items) {
    if (!eligible(it)) {
      result.push({ type: "single", item: it })
      continue
    }
    const key = normalizeTitleKey(parseListTitle(it.title).title)
    if (!key) {
      result.push({ type: "single", item: it })
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    const group = buckets.get(key)!
    if (group.length >= 2) {
      result.push({
        type: "group",
        key,
        title: displayTitle.get(key)!,
        items: group,
      })
    } else {
      result.push({ type: "single", item: group[0]! })
    }
  }
  return result
}
```

更干净的写法：对 `items.filter(eligible)` 调 `groupBooks`，再按 id 建「item → GroupedItem」映射并 walk 原数组去重发射——任选一种，**禁止「连续 post 段」**。

同步修：

- Task 1 正文「收集连续 post 段」注释与伪代码。
- 建议补一条单测：同名 post 被 book **隔开**仍合成一组（现有用例已覆盖，修好实现即可绿）。

---

## Important

### 2. `groupMeListItems` 未过滤 `site === "1"`

spec §3 / Global Constraints：只对 `kind === "post" && site === "1"` 分组。

计划实现只判断 `kind !== "post"`。跨站历史里若出现 `kind:"post"` 且 `site !== "1"`（或未来扩展），会被标题启发式并入 cool18 组。

与 Critical 1 的 `eligible` 一并修；单测可加 `site:"2"` 的 post 直通 single。

---

### 3. TrendingPage：分组接入丢掉 `bookPath`（site=2 链接回归）

现状 `TrendingPage`：

```tsx
href={
  site === "2"
    ? bookPath(post.tid, { site })
    : readPath(post.tid, site)
}
```

Task 9 替换片段对 single / 组内一律：

```tsx
href={readPath(g.item.tid)}  // 无 site、无 bookPath
```

人气导航 `sites: ["1","2"]`，且 plan 已要求 `site !== "1"` 短路为全 single——**短路后 site=2 仍渲染列表**，链接会从书库路径退回帖子路径。

**应保留原 href 分支**（single 与 group 子卡相同）：

```tsx
href={
  site === "2"
    ? bookPath(post.tid, { site })
    : readPath(post.tid, site)
}
```

（Comments 现无 site、导航仅 `sites:["1"]`，用 `readPath` 可接受；Trending 必须修。）

---

### 4. 组头 `summary` / `trailing`（作者、题材）全程未接线

spec §5：

- 作者：组内第一个解析出 `author` 的项  
- 题材：组内第一个有 `genre` 的项 → `GenrePill` 放 `trailing`  
- 折叠态示例含作者行与题材胶囊  

Task 4 组件支持 `summary`/`trailing`，但 Task 6–11 全部不传（首页还写「暂不传」且后续页无补全）。

按 plan 做完会功能可用，但**与已通过 design 的组头信息架构不一致**。

**建议**（任选，写进某个共享 helper 或各页 group 分支）：

```ts
function groupHeaderMeta(items: { title: string }[]) {
  let author: string | undefined
  let genre: string | undefined
  for (const it of items) {
    const p = parseListTitle(it.title)
    if (!author && p.author) author = p.author
    if (!genre && p.genre) genre = p.genre
    if (author && genre) break
  }
  return { summary: author, trailing: genre ? <GenrePill genre={genre} /> : undefined }
}
```

在 `CollapsibleBookGroup` 上传 `summary`/`trailing`。可放 Task 4 之后抽 `group-header-meta.ts`，或在 Task 6 起统一。

若有意砍 scope，须回改 design §5；否则 plan 应补接线步骤。

---

## Suggestion（不阻塞）

### 5. 单测数量：写「6 个」实际 7 个

Task 1 Step 5：`Expected: 6 个 test 全部 PASS`。文件里 7 个 `test(...)`（含 `groupMeListItems`）。改成 7，避免执行者误以为少跑了一个。

### 6. `CollapsibleBookGroup` 的 `bookKey` 未使用

props 接收 `bookKey` 但组件体内未引用（key 在父级）。`noUnusedParameters: false` 不会炸，但可：

- 用于稳定 `contentId` 前缀，或  
- 从 props 去掉，仅父级 `key={\`group:${g.key}\`}`。

### 7. Featured 单条 `index={g.item.index || gi + 1}`

原逻辑是**原始列表**下标 `i + 1`。`gi` 是 **grouped 数组**下标，折叠后序号会跳变。优先 `g.item.index`，缺省再用原始 `items` 下标；不要用 `gi`。

### 8. Task 9 正文自相矛盾后已纠正

先写「榜单无需 site 短路」，紧接着「为稳妥加 site 短路」——以最终代码为准即可，建议删掉前半段免误导。

### 9. `animate-in fade-in`

plan 已注明可能无 tailwind-animate。建议默认用 `opacity`/`transition` 或空 class，避免执行时再纠结「有没有动画」。

### 10. Me 组内 `subtitleOverride` 时隐藏 `read_progress`

Task 5 在 override 分支只保留时间 + 访问次数。可接受；若要进度，override 分支拼上 `已读 X%`。

### 11. Picks 组内仍 `PostCard` 全标题

plan 已写明最小改动可接受；与 Me 路径的 titleOverride 不对称，YAGNI 可留。

---

## 已对齐、不列为问题

- `getId` 已去掉；`site !== "1"` 短路示例（首页/Browse/Search）正确。  
- 展开态页面单例 hook + props，无组件内多实例写 LS。  
- Me 接入点 `MeListPage` + 三页传 scope；无虚构 `MeItemsPage`。  
- Picks 仅非 chip；`IconChevronDown` 新增；`useExpandedBooks` 命名与 try/catch。  
- 分页仅当前页；首页累积数组；验证三件套与手动清单覆盖面够。  
- `groupBooks` 本体两遍 walk 处理空 key single 的顺序合理。  
- `bun test` 在 `apps/web` 下可解析 `@/`（tsconfig paths）；从仓库根瞎跑路径需 `cd apps/web`——plan 命令已 `cd apps/web`。

---

## 建议动作

1. **重写 Task 1 `groupMeListItems`**（全局 post 桶 + 原序 walk；`site==="1"`），确认现有 interleave 单测 PASS。  
2. **Task 9 Trending** 恢复 `bookPath` / `readPath` 的 site 分支。  
3. **组头 author/genre**：补 helper + 各页 `summary`/`trailing`，或修订 design 砍掉。  
4. （可选）单测计数 7、Featured index、`bookKey`、删 Task 9 矛盾段落。

1–3 修完后可按 Task 1→12 执行；其余为打磨项。
