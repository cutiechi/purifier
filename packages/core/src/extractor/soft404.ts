/** 正文最小文本长度：低于此值视为软 404（错误页/验证页残留片段） */
export const MIN_PRE_TEXT_LEN = 20
/** 墙页判定：短文本（<此长度）含墙标记才判墙，避免长正文误伤 */
const WALL_PAGE_MAX_LEN = 200
const WALL_PAGE_RE =
  /验证码|cloudflare|captcha|安全检查|cf[-_ ]?challenge|blocked/i

/**
 * 软 404 / 验证码墙判定：文本过短，或短文本命中墙标记。
 * 用于正文解析入口，命中即抛 404，避免验证页/拦截页写入持久缓存。
 */
export function isSoft404Text(text: string): boolean {
  const t = text.trim()
  return (
    t.length < MIN_PRE_TEXT_LEN ||
    (t.length < WALL_PAGE_MAX_LEN && WALL_PAGE_RE.test(t))
  )
}
