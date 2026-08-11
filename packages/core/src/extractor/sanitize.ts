import * as cheerio from "cheerio"
import type { Element } from "domhandler"
import { escapeHtml } from "./utils"

/** 站内链接映射：返回站内路径（href）与可选兜底文字；null = 外链，只留文字 */
export type LinkMapper = (
  href: string,
  label: string
) => { href: string; label?: string } | null

export interface SanitizeOptions {
  /** <p> 换行策略：empty = 仅空 <p> 换行（cool18）；closing = 每个 </p> 后换行（xbookcn） */
  pBreak?: "empty" | "closing"
}

const NOISE_FONT_COLOR = "E6E6DD"

function isNoiseFont($el: cheerio.Cheerio<Element>): boolean {
  const color = ($el.attr("color") ?? "").replace(/^#/, "").toUpperCase()
  if (color === NOISE_FONT_COLOR) return true
  const style = ($el.attr("style") ?? "").replace(/\s+/g, "").toUpperCase()
  return style.includes(`COLOR:${NOISE_FONT_COLOR}`)
}

/**
 * 正文清洗（DOM 遍历，替代正则标签解析，消除标签解析的脆弱点）：
 * - 输入若为单个 <pre> 包裹，剥掉外层
 * - <font color=#E6E6DD>（水印噪音）整块删除
 * - <br> 与 <p> → 换行（策略见 SanitizeOptions.pBreak）
 * - 每个 <a> 经 mapLink 判定：站内 → 保留为 <a href=...>；外链 → 只留文字
 * - 其余标签剥离；文本节点逐个转义后按 DOM 序拼接（script/style 内容直接丢弃）
 */
export function sanitizeContentHtml(
  html: string,
  mapLink: LinkMapper,
  opts: SanitizeOptions = {}
): string {
  const $ = cheerio.load(html)
  const body = $("body")
  // 输入若为单个 <pre> 包裹（直接传了标签本身），剥掉外层
  if (body.children().length === 1 && body.children().first().is("pre")) {
    body.children().first().unwrap()
  }
  // 水印字体噪音整块删
  $("font").each((_i, el) => {
    if (isNoiseFont($(el))) $(el).remove()
  })
  $("br").each((_i, el) => {
    $(el).replaceWith("\n")
  })
  if (opts.pBreak === "closing") {
    // xbookcn：每个 </p> 后换行（等价旧实现 replace(/<\/p>/g, "\n")）
    $("p").each((_i, el) => {
      $(el).after("\n")
    })
  } else {
    // cool18：仅空 <p> 换行
    $("p").each((_i, el) => {
      if (!$(el).text().trim()) $(el).replaceWith("\n")
    })
  }

  // 锚点处理：站内保留链接、外链只留文字；序列化时按元素插入，
  // 避免占位符文本经 HTML 解析丢失（U+0000 等会被规范剔除）
  const anchorOutput = new Map<Element, string>()
  for (const el of $("a").toArray()) {
    const $el = $(el)
    const href = $el.attr("href") ?? ""
    const label = $el.text().trim()
    const mapped = mapLink(href, label)
    if (mapped) {
      anchorOutput.set(
        el,
        `<a href="${escapeHtml(mapped.href)}">${escapeHtml(mapped.label ?? label ?? "链接")}</a>`
      )
    } else {
      anchorOutput.set(el, label)
    }
  }

  const parts: string[] = []
  const walk = (el: Element): void => {
    for (const child of el.children) {
      if (child.type === "text") {
        parts.push(escapeHtml(child.data ?? ""))
      } else if (child.type === "tag") {
        const anchor = anchorOutput.get(child)
        if (anchor !== undefined) {
          parts.push(anchor)
        } else {
          walk(child)
        }
      }
      // script/style/comment：直接丢弃（其内容不是正文文本）
    }
  }
  walk(body.get(0)!)
  return parts.join("").trim()
}
