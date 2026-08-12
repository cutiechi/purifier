import { type ReactNode, useCallback, useMemo } from "react"
import DOMPurify from "dompurify"
import { useNavigate } from "react-router-dom"
import { IconExternal } from "@/components/icons"
import { PostMetaBar, type PostMetaFields } from "@/components/post-meta"
import { PostCard, PostList } from "@/components/post-card"
import { ReadingProgress } from "@/components/reading-progress"
import { readPath } from "@/lib/routes"
import { characterHighlight } from "@workspace/core/character-highlight"

function withParagraphs(html: string): string {
  // 后端 extractPreHtml 已清洗；前端再 DOMPurify 兜底（纵深防御）。
  return html
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("")
}

function sanitizeBodyHtml(html: string): string {
  // 仅保留段落/换行/站内链接；剥 script/img/on* 等
  return DOMPurify.sanitize(withParagraphs(html), {
    ALLOWED_TAGS: ["p", "br", "a"],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    // 相对站内路径
    ALLOWED_URI_REGEXP: /^(?:\/(?:read|book)\/)/i,
  })
}

export function ContentBody({
  html,
  characters = [],
  highlightEnabled = true,
  onCharacterClick,
}: {
  html: string
  characters?: { name: string; colorIndex: number }[]
  highlightEnabled?: boolean
  onCharacterClick?: (name: string, rect: DOMRect) => void
}) {
  const navigate = useNavigate()
  const safeHtml = useMemo(() => {
    const purified = sanitizeBodyHtml(html)
    if (!highlightEnabled || characters.length === 0) return purified
    return characterHighlight(purified, characters)
  }, [html, characters, highlightEnabled])

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const mark = target.closest("mark.character-mark")
      if (mark) {
        e.preventDefault()
        e.stopPropagation()
        const name = mark.textContent ?? ""
        if (name && onCharacterClick) {
          onCharacterClick(name, mark.getBoundingClientRect())
        }
        return
      }
      const a = target.closest("a")
      if (!a) return
      const href = a.getAttribute("href")
      if (!href?.startsWith("/read/") && !href?.startsWith("/book/")) return
      e.preventDefault()
      navigate(href)
    },
    [navigate, onCharacterClick]
  )

  return (
    <div
      className="reading-body text-foreground/85"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
      onClick={onClick}
    />
  )
}

export function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <IconExternal size={12} />
      查看原帖
    </a>
  )
}

export function ArticleView({
  title,
  meta,
  contentHtml,
  sourceUrl,
  currentTid,
  actions,
  footer,
  progress,
  characters,
  highlightEnabled,
  onCharacterClick,
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
  progress?: number
  characters?: { name: string; colorIndex: number }[]
  highlightEnabled?: boolean
  onCharacterClick?: (name: string, rect: DOMRect) => void
}) {
  return (
    <article className="rounded-2xl border border-border/80 bg-card/90 p-4 shadow-sm sm:rounded-3xl sm:p-8 md:p-10">
      <div className="mb-5 flex items-center justify-between sm:mb-6">
        <SourceLink href={sourceUrl} />
      </div>

      <h1 className="mb-3 text-xl leading-snug font-bold tracking-tight text-foreground sm:mb-4 sm:text-2xl sm:leading-tight">
        {title}
      </h1>

      {actions && <div className="mb-4">{actions}</div>}

      {meta && <PostMetaBar meta={meta} currentTid={currentTid} />}

      <ContentBody
        html={contentHtml}
        characters={characters}
        highlightEnabled={highlightEnabled}
        onCharacterClick={onCharacterClick}
      />

      {footer}

      {progress !== undefined && <ReadingProgress progress={progress} />}
    </article>
  )
}

export function RelatedLinks({
  links,
}: {
  links: { tid: string; title: string; index: number }[]
}) {
  if (!links.length) return null
  return (
    <section className="mt-10 border-t border-border pt-8 sm:mt-12">
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        扩展链接
      </h3>
      <PostList>
        {links.map((link) => (
          <PostCard
            key={link.tid}
            href={readPath(link.tid)}
            title={link.title}
            leading={
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                {link.index}
              </span>
            }
          />
        ))}
      </PostList>
    </section>
  )
}
