import { describe, expect, test } from "bun:test"
import { Cool18Extractor } from "./extractor"
import { ExtractorError } from "./types"

const ex = new Cool18Extractor()

describe("extractContent", () => {
  test("returns links outside the pre alongside content", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>测试标题 - 论坛</title></head>
<body>
<div id="content-section">
  <pre>第一段
第二段</pre>
  <a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=999">下一章</a>
</div>
</body>
</html>`
    const res = ex.extractContent(html)
    expect(res.title).toBe("测试标题")
    expect(res.content).toContain("第一段")
    expect(res.links).toEqual([{ index: 1, title: "下一章", tid: "999" }])
  })

  test("skips links inside the pre", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>正文页</title></head>
<body>
<div id="content-section">
  <pre>正文 <a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=777">内链</a> 结尾</pre>
</div>
</body>
</html>`
    const res = ex.extractContent(html)
    expect(res.links).toEqual([])
    expect(res.content).toContain('/read/777')
  })
})

describe("parseReplies tree scale", () => {
  test("builds a deep chain (300 replies) without recursion issues", () => {
    const n = 300
    const items = []
    for (let i = 1; i <= n; i++) {
      items.push({ tid: String(i + 1), uptid: String(i), username: `u${i}` })
    }
    const tree = ex.parseReplies(JSON.stringify(items), "1")
    expect(tree).toHaveLength(1)
    let node = tree[0]
    let depth = 1
    while (node !== undefined && node.children.length > 0) {
      node = node.children[0]
      depth++
    }
    expect(depth).toBe(n)
  })

  test("keeps sibling order for a wide reply list (500 replies)", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      tid: String(i + 2),
      uptid: "1",
      username: `u${i}`,
    }))
    const tree = ex.parseReplies(JSON.stringify(items), "1")
    expect(tree).toHaveLength(500)
    expect(tree.map((r) => r.tid)).toEqual(
      Array.from({ length: 500 }, (_, i) => String(i + 2))
    )
  })
})

describe("extractPreHtml", () => {
  test("throws 404 when no content pre exists", () => {
    expect(() => ex.extractContent("<html><body>nothing</body></html>")).toThrow(
      ExtractorError
    )
  })
})
