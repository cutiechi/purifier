import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { XbookcnExtractor } from "./xbookcn"

const fx = (f: string) =>
  readFileSync(join(__dirname, "fixtures/xbookcn", f), "utf8")
const e = new XbookcnExtractor()

describe("XbookcnExtractor basics", () => {
  test("urls", () => {
    expect(e.homeUrl).toBe("https://www.xbookcn.org")
    expect(e.buildBookUrl("MjI4NzE")).toBe(
      "https://www.xbookcn.org/novel/MjI4NzE"
    )
    expect(e.buildChapterUrl("MjI4NzE", 2)).toBe(
      "https://www.xbookcn.org/novel/MjI4NzE/2"
    )
  })
  test("unsupported methods throw 404", () => {
    expect(() => e.extractContent("")).toThrow(/does not support posts/)
    expect(() => e.extractGoldLinks("")).toThrow(/gold/)
    expect(() => e.fetchReplies("")).toThrow(/replies/)
  })
})

describe("extractBookContent toc", () => {
  test("multi-chapter toc has chapters + related", () => {
    const r = e.extractBookContent(fx("toc.html"))
    expect(r.title).toBe("欲望夜")
    expect(r.meta.author).toBe("幻想")
    expect(r.intro).toContain("小艾")
    expect(r.chapters!.length).toBe(2)
    // 章标题 strip 前缀（review C4）：“第 1 章 序：不是开始的开始” → “序：不是开始的开始”
    expect(r.chapters![0]).toEqual({
      index: 1,
      title: "序：不是开始的开始",
      tid: "MjI4NzE",
    })
    expect(r.chapters![1]).toEqual({
      index: 2,
      title: "第一章 芸芸众生",
      tid: "MjI4NzE",
    })
    expect(r.singleShot).toBeFalsy()
    expect(r.related!.length).toBe(1)
    expect(r.related![0]).toEqual({
      index: 1,
      title: "妈，您人设崩了！",
      tid: "Nzc4Nw",
    })
  })
  test("single-shot has no chapter list, singleShot=true", () => {
    const r = e.extractBookContent(fx("single.html"))
    expect(r.singleShot).toBe(true)
    expect(r.meta.author).toBe("佚名")
    expect(r.chapters).toEqual([
      { index: 1, title: "超级美女业务员", tid: "MjI4NzI" },
    ])
  })
})

describe("extractBookContent chapter", () => {
  test("chapter body + bookTitle + prev/next + sanitized links", () => {
    const r = e.extractBookContent(fx("chapter.html"), { chapter: "1" })
    expect(r.title).toBe("序：不是开始的开始")
    expect(r.bookTitle).toBe("欲望夜")
    expect(r.chapterIndex).toBe(1)
    expect(r.nextChapter).toBe(2)
    expect(r.prevChapter).toBeUndefined()
    // 站内章链改写为 /book/...?site=2&chapter=（sanitized HTML 中 & 已转义为 &amp;）
    expect(r.content).toContain("/book/MjI4NzE?site=2&amp;chapter=2")
    // 外链剥离（不留 href）
    expect(r.content).not.toContain("xchina.click")
    expect(r.content).toContain("广告") // 但保留文字
  })
})

describe("lists", () => {
  test("extractCategoryLinks url carries site=2", () => {
    const links = e.extractCategoryLinks(fx("home.html"))
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]!.url).toContain("site=2")
    // 有声分区入口：/tag/999 归一为 audio
    const audio = links.find((l) => l.url.includes("type=audio"))
    expect(audio).toBeTruthy()
    expect(audio!.label).toBe("有声")
    expect(links.some((l) => l.url.includes("999"))).toBe(false)
  })
  test("extractHotPosts from sidebar, reads=0", () => {
    const posts = e.extractHotPosts(fx("home.html"))
    expect(posts.length).toBeGreaterThan(0)
    expect(posts[0]!).toEqual({
      rank: 1,
      title: "少妇白洁",
      tid: "OQ",
      reads: 0,
    })
    expect(posts[1]!.tid).toBe("NTM4NA")
    expect(posts.every((p) => p.reads === 0)).toBe(true)
    expect(posts[0]!.tid).toMatch(/^[A-Za-z0-9]+$/)
  })
  test("parseNovelCards reads list-feed-item cards (tag page)", () => {
    const links = e.parseNovelCards(fx("tag.html"))
    expect(links.length).toBe(2)
    expect(links[0]!).toEqual({
      index: 1,
      title: "超级美女业务员",
      tid: "MjI4NzI",
    })
    expect(links[1]!.tid).toBe("MjI4NzE")
  })
  test("parseNovelCards reads home-feed-item cards", () => {
    const links = e.parseNovelCards(fx("home.html"))
    expect(links.length).toBeGreaterThanOrEqual(2)
    expect(links[0]!.title).toBe("超级美女业务员")
  })
  test("hasNextPage: list pagination with 下一页 → true, without → false", () => {
    expect(e.hasNextPage(fx("tag.html"))).toBe(true)
    expect(e.hasNextPage(fx("toc.html"))).toBe(false)
  })
})
