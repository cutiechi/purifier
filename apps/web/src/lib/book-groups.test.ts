import { test, expect } from "bun:test"
import {
  groupBooks,
  groupMeListItems,
  normalizeTitleKey,
} from "@/lib/book-groups"
import type { MeListItem } from "@/components/me-item-card"

test("normalizeTitleKey 去书名号包裹并小写", () => {
  expect(normalizeTitleKey("《马屌少年》")).toBe("马屌少年")
  expect(normalizeTitleKey("【马屌少年】")).toBe("马屌少年")
  expect(normalizeTitleKey("［马屌少年］")).toBe("马屌少年")
  expect(normalizeTitleKey("[马屌少年]")).toBe("马屌少年")
  expect(normalizeTitleKey("马屌少年")).toBe("马屌少年")
  expect(normalizeTitleKey("  马屌少年  ")).toBe("马屌少年")
})

test("normalizeTitleKey 空串保持空", () => {
  expect(normalizeTitleKey("")).toBe("")
  expect(normalizeTitleKey("【】")).toBe("")
})

test("normalizeTitleKey 尾随章节号（含 完/区间/中文）不进 key", () => {
  expect(normalizeTitleKey("马屌少年（完）")).toBe("马屌少年")
  expect(normalizeTitleKey("马屌少年（30完）")).toBe("马屌少年")
  expect(normalizeTitleKey("马屌少年（第三部 1-2）")).toBe("马屌少年")
  expect(normalizeTitleKey("马屌少年（2）")).toBe("马屌少年")
  // （完）走「作者后缀」路径时 parseListTitle 会保留在 title 里，仍应并组
  const items = [
    { tid: "1", title: "马屌少年（1）作者：小明" },
    { tid: "2", title: "马屌少年（完）作者：小明" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(1)
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].items.map((i) => i.tid)).toEqual(["1", "2"])
  }
})

test("同名多章合并为一组，单条为 single", () => {
  const items = [
    { tid: "1", title: "【马屌少年】（1）作者：小明" },
    { tid: "2", title: "马屌少年（2）作者：小明" },
    { tid: "3", title: "【独立短篇】" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(2)
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].key).toBe("马屌少年")
    expect(result[0].title).toBe("马屌少年")
    expect(result[0].items).toHaveLength(2)
    // 组头 author 聚合自组内首条非空值（作者：小明）
    expect(result[0].author).toBe("小明")
  }
  expect(result[1].type).toBe("single")
})

test("空标题项一律 single，不并组", () => {
  const items = [
    { tid: "1", title: "" },
    { tid: "2", title: "【】" },
    { tid: "3", title: "正常书（1）" },
    { tid: "4", title: "正常书（2）" },
  ]
  const result = groupBooks(items, (it) => it.title)
  // 两个空标题各 single + 正常书一组 = 3 项
  expect(result).toHaveLength(3)
  expect(result.filter((g) => g.type === "single")).toHaveLength(2)
})

test("group 按首次出现位置排序，组内保持原始相对序", () => {
  const items = [
    { tid: "a", title: "B书（1）" },
    { tid: "b", title: "A书（1）" },
    { tid: "c", title: "B书（2）" },
    { tid: "d", title: "A书（2）" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(2)
  // B书先出现（tid=a 在 index 0），A书后出现（tid=b 在 index 1）
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].title).toBe("B书")
    expect(result[0].items.map((i) => i.tid)).toEqual(["a", "c"])
  }
  if (result[1].type === "group") {
    expect(result[1].title).toBe("A书")
    expect(result[1].items.map((i) => i.tid)).toEqual(["b", "d"])
  }
})

test("多个不同 group 混排互不串扰", () => {
  const items = [
    { tid: "1", title: "X（1）" },
    { tid: "2", title: "Y（1）" },
    { tid: "3", title: "X（2）" },
    { tid: "4", title: "孤狼" },
    { tid: "5", title: "Y（2）" },
  ]
  const result = groupBooks(items, (it) => it.title)
  expect(result).toHaveLength(3)
  expect(result.filter((g) => g.type === "group")).toHaveLength(2)
  expect(result.filter((g) => g.type === "single")).toHaveLength(1)
})

test("groupMeListItems: book 项直通 single，post 项按 title 分组并保持原序", () => {
  const post = (id: string, title: string, site = "1"): MeListItem => ({
    kind: "post",
    id,
    title,
    url: "",
    site,
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  const book = (id: string, title: string): MeListItem => ({
    kind: "book",
    id,
    title,
    url: "",
    site: "2",
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  // 同名 post 被 book 隔开，仍应合成一组（全局 post 桶，非连续段）
  const items = [
    post("p1", "故事（1）"),
    book("b1", "某本 xbookcn 书"),
    post("p2", "故事（2）"),
  ]
  const result = groupMeListItems(items)
  expect(result).toHaveLength(2)
  // post 两章合成一组，位置在 index 0（首次出现处）
  expect(result[0].type).toBe("group")
  if (result[0].type === "group") {
    expect(result[0].items.map((i) => i.id)).toEqual(["p1", "p2"])
  }
  // book 项保持原位（index 1）作为 single
  expect(result[1].type).toBe("single")
  if (result[1].type === "single") {
    expect(result[1].item.id).toBe("b1")
  }
})

test("groupMeListItems: site !== '1' 的 post 直通 single，不参与分组", () => {
  const post = (id: string, title: string, site: string): MeListItem => ({
    kind: "post",
    id,
    title,
    url: "",
    site,
    visit_count: 1,
    favorited: false,
    tags: [],
  })
  // 两章同名，但 site=2，应各自 single
  const items = [post("p1", "故事（1）", "2"), post("p2", "故事（2）", "2")]
  const result = groupMeListItems(items)
  expect(result).toHaveLength(2)
  expect(result.every((g) => g.type === "single")).toBe(true)
})
