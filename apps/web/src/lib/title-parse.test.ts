import { describe, expect, test } from "bun:test"
import { parseListTitle } from "@/lib/title-parse"

describe("parseListTitle 兼容上游多样化格式", () => {
  test("〖〗 书名号", () => {
    expect(parseListTitle("〖警花少妇白艳妮〗１－５８")).toMatchObject({
      title: "警花少妇白艳妮",
      chapters: "1-58",
    })
  })

  test("作者下划线分隔：作者_xxx / 作_者：", () => {
    expect(parseListTitle("【白雪仙尘录】０１-３４_作者_asd223152")).toMatchObject({
      title: "白雪仙尘录",
      author: "asd223152",
      chapters: "01-34",
    })
    expect(parseListTitle("【情动】_（０１－４２完结）_作_者：梓妃渔")).toMatchObject({
      title: "情动",
      author: "梓妃渔",
    })
  })

  test("by / ｂｙ 作者格式", () => {
    expect(parseListTitle("〖朱颜血〗（全）ｂｙ恶魔岛诸位")).toMatchObject({
      title: "朱颜血",
      author: "恶魔岛诸位",
    })
    expect(parseListTitle("〖短篇合集〗by黑暗")).toMatchObject({
      title: "短篇合集",
      author: "黑暗",
    })
  })

  test("前导 _ / ★ / [标签] 装饰", () => {
    expect(parseListTitle("_【勾引】（００１－０６８完结）作_者：微微")).toMatchObject({
      title: "勾引",
      author: "微微",
    })
    expect(parseListTitle("_★《大航海时代加强版》１～４部４章")).toMatchObject({
      title: "大航海时代加强版",
      chapters: "1~4部4章",
    })
    expect(parseListTitle("[贺岁]【万圣惊魂】_(完)_顽童本色[原创]")).toMatchObject({
      title: "万圣惊魂",
      author: "顽童本色",
    })
  })

  test("完 + 作者 / [xxx_原创] 作者提取", () => {
    expect(parseListTitle("【搜神记顿丘魅物】完沉木[原创]")).toMatchObject({
      title: "搜神记顿丘魅物",
      author: "沉木",
      chapters: "完",
    })
    expect(parseListTitle("【暗黑破坏神之少年德鲁伊】1-3[小小书童_原创]")).toMatchObject({
      title: "暗黑破坏神之少年德鲁伊",
      author: "小小书童",
      chapters: "1-3",
    })
  })
})
