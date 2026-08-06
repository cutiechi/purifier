import { type ReactNode, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { IconExternal } from "@/components/icons"
import { PostMetaBar, type PostMetaFields } from "@/components/post-meta"
import { PostCard, PostList } from "@/components/post-card"
import { ReadingProgress } from "@/components/reading-progress"
import { readPath } from "@/lib/routes"

function withParagraphs(html: string): string {
  // 内容已由 extractPreHtml 清洗：仅转义文本 + 站内 /read|/book 锚点。
  // 这里只处理字面 \n，不做二次 innerHTML 解析。
  return html
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("")
}

export function ContentBody({ html }: { html: string }) {
  const navigate = useNavigate()

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const a = target.closest("a")
      if (!a) return
      const href = a.getAttribute("href")
      if (!href?.startsWith("/read/") && !href?.startsWith("/book/")) return
      e.preventDefault()
      navigate(href)
    },
    [navigate]
  )

  return (
    <div
      className="reading-body text-foreground/85"
      dangerouslySetInnerHTML={{ __html: withParagraphs(html) }}
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
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
  progress?: number
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

      <ContentBody html={contentHtml} />

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
