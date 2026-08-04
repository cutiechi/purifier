import { Link } from "react-router-dom"
import { formatCount } from "@/lib/format"
import { readPath } from "@/lib/routes"

export interface PostParentFields {
  tid: string
  title: string
  author?: string | null
  publishedAt?: string | null
}

export interface PostMetaFields {
  author?: string | null
  badge?: string | null
  publishedAt?: string | null
  reads?: number | null
  likes?: number | null
  comments?: number | null
  parent?: PostParentFields | null
  rootTid?: string | null
}

export function PostMetaBar({
  meta,
  currentTid,
}: {
  meta: PostMetaFields
  currentTid?: string
}) {
  const chips: string[] = []
  if (meta.author) chips.push(meta.author)
  if (meta.publishedAt) chips.push(meta.publishedAt)
  if (meta.reads != null) chips.push(`${formatCount(meta.reads)} 阅读`)
  if (meta.likes != null) chips.push(`${formatCount(meta.likes)} 赞`)
  if (meta.comments != null) chips.push(`${formatCount(meta.comments)} 评论`)

  const parent = meta.parent
  const rootTid = meta.rootTid
  const showRoot =
    !!rootTid && rootTid !== currentTid && rootTid !== parent?.tid

  if (chips.length === 0 && !meta.badge && !parent && !showRoot) return null

  return (
    <div className="text-muted-foreground mb-6 flex flex-col gap-2.5 text-sm sm:mb-7">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {chips.map((item, i) => (
            <span key={`${item}-${i}`} className="inline-flex items-center gap-2">
              {i > 0 && (
                <span className="text-muted-foreground/35" aria-hidden>
                  ·
                </span>
              )}
              <span
                className={
                  i === 0 && meta.author
                    ? "text-foreground/85 font-medium"
                    : undefined
                }
              >
                {item}
              </span>
            </span>
          ))}
        </div>
      )}

      {meta.badge && (
        <div className="text-muted-foreground/65 text-xs">{meta.badge}</div>
      )}

      {parent && (
        <div className="border-border bg-muted/35 rounded-2xl border px-3.5 py-3">
          <div className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">
            回复
          </div>
          <Link
            to={readPath(parent.tid)}
            className="text-foreground hover:text-sky-600 dark:hover:text-sky-400 text-[14px] leading-snug font-medium transition-colors"
          >
            {parent.title}
          </Link>
          {(parent.author || parent.publishedAt) && (
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
              {parent.author && <span>由 {parent.author}</span>}
              {parent.author && parent.publishedAt && (
                <span className="text-muted-foreground/35">·</span>
              )}
              {parent.publishedAt && <span>{parent.publishedAt}</span>}
            </div>
          )}
          {showRoot && rootTid && (
            <div className="mt-2">
              <Link
                to={readPath(rootTid)}
                className="text-sky-600 hover:underline dark:text-sky-400 text-xs"
              >
                返回主题帖
              </Link>
            </div>
          )}
        </div>
      )}

      {!parent && showRoot && rootTid && (
        <div>
          <Link
            to={readPath(rootTid)}
            className="text-sky-600 hover:underline dark:text-sky-400 text-xs"
          >
            返回主题帖
          </Link>
        </div>
      )}
    </div>
  )
}
