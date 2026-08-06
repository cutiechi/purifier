import { describe, expect, test } from "bun:test"
import { decodeHtmlEntities, escapeHtml, stripTags } from "./utils"

describe("stripTags", () => {
  test("removes tags, keeps text", () => {
    expect(stripTags("<a href=x>hello</a>")).toBe("hello")
    expect(stripTags("a<b>c</b>d")).toBe("acd")
    expect(stripTags("no tags")).toBe("no tags")
  })
})

describe("escapeHtml", () => {
  test("escapes & < > \"", () => {
    expect(escapeHtml(`a & <b> "q"`)).toBe(`a &amp; &lt;b&gt; &quot;q&quot;`)
  })
})

describe("decodeHtmlEntities", () => {
  test("named entities", () => {
    expect(decodeHtmlEntities("&lt;&gt;&amp;&quot;")).toBe(`<>&"`)
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b")
  })
  test("numeric entities", () => {
    expect(decodeHtmlEntities("&#65;")).toBe("A")
    expect(decodeHtmlEntities("&#x41;")).toBe("A")
  })
  test("leaves unknown entities", () => {
    expect(decodeHtmlEntities("&copy;")).toBe("&copy;")
  })
})
