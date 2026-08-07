import { parseListTitle } from "@/lib/title-parse"
import type { MeListItem } from "@/components/me-item-card"

export type GroupedItem<T> =
  | { type: "single"; item: T }
  | {
      type: "group"
      key: string
      title: string
      items: T[]
      author: string | null
      genre: string | null
    }

export function normalizeTitleKey(title: string): string {
  return title
    .replace(/^[《【［[]+|[》】］\]]+$/g, "")
    // parseListTitle 在「作者跟在章节号后」或单字书名（<2 字）时会把尾随的
    // 章节号留在 title 里（如「马屌少年（2）作者：小明」→「马屌少年（2）」、
    // 「马屌少年（完）作者：小明」→「马屌少年（完）」）。解析出的 title 里
    // 尾随（…）按构造都是章节/卷标记（作者已被拆出），这里一并剥掉，
    // 保证同名不同章落入同一桶。与 title-parse 自身识别范围一致（≤24 字）。
    .replace(/(?:[（(][^）)]{1,24}[）)]\s*)+$/, "")
    .trim()
    .toLowerCase()
}

/** 从一组项里取首个非空 author / genre（用于组头展示） */
function pickHeaderMeta<T>(
  items: T[],
  getTitle: (item: T) => string,
): { author: string | null; genre: string | null } {
  let author: string | null = null
  let genre: string | null = null
  for (const it of items) {
    const p = parseListTitle(getTitle(it))
    if (!author && p.author) author = p.author
    if (!genre && p.genre) genre = p.genre
    if (author && genre) break
  }
  return { author, genre }
}

/**
 * 按 parseListTitle 拆出的书名归一化分组。同名 ≥2 条合成一组，
 * 单条为 single；空标题一律 single。保留首次出现顺序，组内保持原序。
 * group 项附带 author/genre（组内首个非空值）。
 */
export function groupBooks<T>(
  items: T[],
  getTitle: (item: T) => string,
): GroupedItem<T>[] {
  const displayTitle = new Map<string, string>()
  const buckets = new Map<string, T[]>()
  const singles: Set<number> = new Set()

  items.forEach((item, idx) => {
    const parsed = parseListTitle(getTitle(item))
    const key = normalizeTitleKey(parsed.title)
    if (!key) {
      singles.add(idx)
      return
    }
    if (!buckets.has(key)) {
      displayTitle.set(key, parsed.title || getTitle(item))
      buckets.set(key, [])
    }
    buckets.get(key)!.push(item)
  })

  const result: GroupedItem<T>[] = []
  const emitted = new Set<string>()
  items.forEach((item, idx) => {
    if (singles.has(idx)) {
      result.push({ type: "single", item })
      return
    }
    const parsed = parseListTitle(getTitle(item))
    const key = normalizeTitleKey(parsed.title)
    if (!key) return // 防御：空 key 已在 singles 处理
    if (emitted.has(key)) return
    emitted.add(key)
    const group = buckets.get(key)!
    if (group.length >= 2) {
      const meta = pickHeaderMeta(group, getTitle)
      result.push({
        type: "group",
        key,
        title: displayTitle.get(key)!,
        items: group,
        author: meta.author,
        genre: meta.genre,
      })
    } else {
      result.push({ type: "single", item: group[0]! })
    }
  })
  return result
}

/**
 * Me 列表（历史/收藏/标签）专用分组：
 * 仅 kind === "post" && site === "1" 的项参与分组，其余直通 single。
 * 所有符合条件的 post 共享同一套书名桶（全局，非连续段），
 * 再按原始数组顺序 walk 去重发射，保持原序 interleave。
 */
export function groupMeListItems(
  items: MeListItem[],
): GroupedItem<MeListItem>[] {
  const eligible = (it: MeListItem) => it.kind === "post" && it.site === "1"

  // 第一遍：对 eligible 项建全局桶
  const buckets = new Map<string, MeListItem[]>()
  const displayTitle = new Map<string, string>()
  for (const it of items) {
    if (!eligible(it)) continue
    const parsed = parseListTitle(it.title)
    const key = normalizeTitleKey(parsed.title)
    if (!key) continue
    if (!buckets.has(key)) {
      displayTitle.set(key, parsed.title || it.title)
      buckets.set(key, [])
    }
    buckets.get(key)!.push(it)
  }

  // 第二遍：原序 walk 去重发射
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
      const meta = pickHeaderMeta(group, (it) => it.title)
      result.push({
        type: "group",
        key,
        title: displayTitle.get(key)!,
        items: group,
        author: meta.author,
        genre: meta.genre,
      })
    } else {
      result.push({ type: "single", item: group[0]! })
    }
  }
  return result
}
