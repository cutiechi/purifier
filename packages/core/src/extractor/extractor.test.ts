import { describe, expect, test } from "bun:test"
import { Cool18Extractor, MAX_REPLY_DEPTH } from "./extractor"
import { ExtractorError } from "./types"

const ex = new Cool18Extractor()

describe("extractContent", () => {
  test("returns links outside the pre alongside content", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>测试标题 - 论坛</title></head>
<body>
<div id="content-section">
  <pre>这里是第一段足够长的正文内容，用于测试链接抽取
第二段正文也写得比较长，避免触发软 404 的最小长度检查</pre>
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
  <pre>这里是正文的开头部分，包含一个 <a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=777">内链</a> 的测试内容，结尾处还有不少文字</pre>
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

  test("深度超过 MAX_REPLY_DEPTH → 截断，不递归爆栈", () => {
    const n = 600
    const items = []
    for (let i = 1; i <= n; i++) {
      items.push({ tid: String(i + 1), uptid: String(i), username: `u${i}` })
    }
    const tree = ex.parseReplies(JSON.stringify(items), "1")
    expect(tree).toHaveLength(1)
    let depth = 1
    let node = tree[0]
    while (node !== undefined && node.children.length > 0) {
      node = node.children[0]
      depth++
    }
    expect(depth).toBe(MAX_REPLY_DEPTH)
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

  test("extracts links from reply subject html", () => {
    const items = [
      {
        tid: "100",
        subject: 'Next: <a href="index.php?app=forum&act=threadview&tid=200">Title 200</a>',
        dateline: "2024-01-01",
        size: 100,
      },
      {
        tid: "101",
        subject: "Plain text without links",
        dateline: "2024-01-01",
        size: 50,
      },
    ]
    const tree = ex.parseReplies(JSON.stringify(items), "1")
    expect(tree[0]?.links).toEqual([{ tid: "200", title: "Title 200" }])
    expect(tree[1]?.links).toBeUndefined()
  })
})

describe("extractPreHtml", () => {
  test("throws 404 when no content pre exists", () => {
    expect(() => ex.extractContent("<html><body>nothing</body></html>")).toThrow(
      ExtractorError
    )
  })
})

/** 构造带 #content-section pre 的正文页 */
function postHtml(preInner: string, title = "测试标题"): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title} - 论坛</title></head>
<body>
<div id="content-section">
  <pre>${preInner}</pre>
</div>
</body>
</html>`
}

describe("extractPreHtml 清洗加固", () => {
  test("javascript: 外链只留文字，不产出 <a>", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容，见 <a href="javascript:alert(1)">这里</a> 结尾`
      )
    )
    expect(res.content).toContain("这里")
    expect(res.content).not.toContain("javascript")
    expect(res.content).not.toContain("<a")
  })

  test("属性值内的 > 不把内容当正文吐出（stripTags 错位回归）", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容 ok <a href="https://evil.example/?a=1>2" title=">LEAK<">link</a> end`
      )
    )
    expect(res.content).not.toContain("LEAK")
    expect(res.content).toContain("link")
  })

  test("未闭合的 <a> 不产生残留链接", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容 text <a href="javascript:alert(1)">click 没闭合`
      )
    )
    expect(res.content).toContain("click 没闭合")
    expect(res.content).not.toContain("<a")
    expect(res.content).not.toContain("javascript")
  })

  test("嵌套 <a> 以最外层为准，内层不注入", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容，用来验证嵌套链接场景，<a href="https://www.cool18.com/bbs4/index.php?app=forum&act=threadview&tid=1">外层 <a href="javascript:alert(2)">内层</a></a>`
      )
    )
    expect(res.content).toContain("/read/1")
    expect(res.content).not.toContain("javascript")
  })

  test("E6E6DD 水印字体整块删除", () => {
    const res = ex.extractContent(
      postHtml(
        `这是正文的开头部分，包含一些实际内容，正文<font color=#E6E6DD>水印</font>结尾`
      )
    )
    expect(res.content).toContain("这是正文的开头部分")
    expect(res.content).not.toContain("水印")
  })

  test("br 与空 p 转换行", () => {
    const res = ex.extractContent(
      postHtml(`这是正文的第一行文字，我们来看换行效果：a<br>b<p></p>c`)
    )
    expect(res.content).toContain("a\nb\nc")
  })

  test("外站链接带 tid= 参数不当站内链接（同站校验）", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容，包含外站链接：外站 <a href="https://evil.example/?tid=999">点我</a> 结尾`
      )
    )
    expect(res.content).not.toContain("/read/999")
    expect(res.content).toContain("点我")
  })

  test("协议相对外链（//host/）带 tid= 不当站内链接", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容，含协议相对外链 <a href="//evil.example/foo?tid=999">点我</a> 结尾`
      )
    )
    expect(res.content).not.toContain("/read/999")
    expect(res.content).toContain("点我")
  })

  test("纯相对链接（index.php?...）视为站内链接（上游新格式）", () => {
    const res = ex.extractContent(
      postHtml(
        `这是一段足够长的正文内容，含站内相对链接 <a href="index.php?app=forum&act=threadview&tid=777">内链</a> 的测试内容，结尾处还有不少文字`
      )
    )
    expect(res.content).toContain("/read/777")
  })

  test("extractGoldLinks 接受纯相对 URL（上游首页新格式）", () => {
    const html = `<!DOCTYPE html>
<html>
<body>
<div id="d_gold_list" class="main_right_margin">
  <table width="998px" border="0">
    <tr>
      <td width=33% class='gold_td'><a href="index.php?app=forum&act=threadview&tid=14604341">精华帖一</a></td>
      <td width=33% class='gold_td'><a href="index.php?app=forum&act=threadview&tid=14604144">精华帖二</a></td>
    </tr>
  </table>
</div>
</body>
</html>`
    const links = ex.extractGoldLinks(html)
    expect(links.map((l) => l.tid)).toEqual(["14604341", "14604144"])
  })

  test("extractCmtRankPosts 接受纯相对 URL（上游评论榜新格式）", () => {
    const html = `<!DOCTYPE html>
<html>
<body>
<table class="rank-table" aria-label="《禁忌书屋》评论榜">
  <tbody>
    <tr>
      <td class="rank-col">1</td>
      <td class="title-col"><a href="index.php?action=search&act=threadsearch&app=forum&uid=1">蛋伤</a></td>
      <td><a href="index.php?app=forum&act=threadview&tid=14555162">【毫末生】第七卷</a></td>
      <td>2026-04-10</td>
      <td>377 评</td>
    </tr>
  </tbody>
</table>
</body>
</html>`
    const posts = ex.extractCmtRankPosts(html)
    expect(posts).toEqual([
      { rank: 1, title: "【毫末生】第七卷", tid: "14555162", comments: 377 },
    ])
  })
})

describe("软 404 检测", () => {
  test("含验证码墙文本的短 pre → 404", () => {
    expect(() =>
      ex.extractContent(
        postHtml("请稍候，正在验证您不是机器人，验证码加载中…")
      )
    ).toThrow(ExtractorError)
  })

  test("过短的 pre（疑似错误页）→ 404", () => {
    expect(() => ex.extractContent(postHtml("短"))).toThrow(ExtractorError)
  })
})
