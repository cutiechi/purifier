import { type ReactNode, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { IconExternal } from "@/components/icons"
import { PostMetaBar, type PostMetaFields } from "@/components/post-meta"
import { PostCard, PostList } from "@/components/post-card"
import { readPath } from "@/lib/routes"

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
    <pre
      className="content-body font-mono text-[14px] leading-[1.85] whitespace-pre-wrap text-foreground/85 sm:text-[15px] sm:leading-[1.9] [&_a]:text-sky-600 [&_a]:underline [&_a]:decoration-sky-600/35 [&_a]:underline-offset-2 hover:[&_a]:decoration-sky-600 dark:[&_a]:text-sky-400 dark:[&_a]:decoration-sky-400/40"
      dangerouslySetInnerHTML={{ __html: html }}
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
}: {
  title: string
  meta?: PostMetaFields
  contentHtml: string
  sourceUrl: string
  currentTid?: string
  actions?: ReactNode
  footer?: ReactNode
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
