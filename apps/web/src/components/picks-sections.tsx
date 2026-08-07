import { Link } from "react-router-dom"
import { SectionLabel } from "@/components/page-header"
import { CollapsibleBookGroup } from "@/components/collapsible-book-group"
import { GenrePill } from "@/components/list-post-card"
import { PostCard, PostList } from "@/components/post-card"
import { groupBooks } from "@/lib/book-groups"
import { useExpandedBooks } from "@/hooks/use-expanded-books"
import { readPath } from "@/lib/routes"
import { cn } from "@workspace/ui/lib/utils"

export interface PickLink {
  index: number
  title: string
  tid: string
}

export interface PickSection {
  title: string
  links: PickLink[]
}

/** 清理分组名装饰括号 */
export function cleanSectionTitle(title: string): string {
  return (
    title
      .replace(/^[【\[]\s*/, "")
      .replace(/\s*[】\]]$/, "")
      .replace(/^[★\s]+/, "")
      .trim() || title
  )
}

/** 短标签：年份、序号、极短文案 → 用芯片而不是整行卡片 */
export function isShortLabel(title: string): boolean {
  const t = title.trim()
  if (!t) return true
  if (/^\d{4}$/.test(t)) return true
  if (/^[（(]?[一二三四五六七八九十\d]+[)）]?$/.test(t)) return true
  if (/^[一二三四五六七八九十]+[（(].+[)）]$/.test(t) && t.length <= 12)
    return true
  // 无长中文句子的短标签
  if (t.length <= 8 && !/[，。！？、]/.test(t)) return true
  return false
}

export function sectionUsesChips(section: PickSection): boolean {
  if (section.links.length === 0) return false
  const shortCount = section.links.filter((l) => isShortLabel(l.title)).length
  return shortCount >= Math.ceil(section.links.length * 0.55)
}

function ChipLink({
  href,
  label,
  hint,
}: {
  href: string
  label: string
  hint?: string
}) {
  return (
    <Link
      to={href}
      title={hint}
      className={cn(
        "border-border/80 bg-card hover:border-border hover:bg-accent/50",
        "inline-flex min-h-10 items-center justify-center rounded-xl border px-3.5 py-2",
        "text-sm font-medium text-foreground transition-all active:scale-[0.98]",
        "shadow-sm"
      )}
    >
      {label}
    </Link>
  )
}

export function PicksSections({ sections }: { sections: PickSection[] }) {
  const { isExpanded, toggle } = useExpandedBooks("picks")
  return (
    <div className="flex flex-col gap-8 sm:gap-9">
      {sections.map((section) => {
        const title = cleanSectionTitle(section.title)
        const chips = sectionUsesChips(section)

        return (
          <section key={section.title}>
            <SectionLabel
              action={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {section.links.length}
                </span>
              }
            >
              {title}
            </SectionLabel>

            {chips ? (
              <div className="flex flex-wrap gap-2 sm:gap-2.5">
                {section.links.map((link) => {
                  // 短标签补全上下文，方便悬停/无障碍
                  const full =
                    isShortLabel(link.title) && title
                      ? `${title} · ${link.title}`
                      : link.title
                  return (
                    <ChipLink
                      key={link.tid}
                      href={readPath(link.tid)}
                      label={link.title}
                      hint={full}
                    />
                  )
                })}
              </div>
            ) : (
              <PostList>
                {(() => {
                  const grouped = groupBooks(section.links, (l) => l.title)
                  return grouped.map((g) =>
                    g.type === "single" ? (
                      <PostCard
                        key={g.item.tid}
                        href={readPath(g.item.tid)}
                        title={g.item.title}
                      />
                    ) : (
                      <CollapsibleBookGroup
                        key={`group:${g.key}`}
                        title={g.title}
                        summary={g.author ?? undefined}
                        count={g.items.length}
                        bookKey={g.key}
                        isExpanded={isExpanded(g.key)}
                        onToggle={() => toggle(g.key)}
                        trailing={
                          g.genre ? <GenrePill genre={g.genre} /> : undefined
                        }
                      >
                        {g.items.map((link) => (
                          <PostCard
                            key={link.tid}
                            href={readPath(link.tid)}
                            title={link.title}
                          />
                        ))}
                      </CollapsibleBookGroup>
                    )
                  )
                })()}
              </PostList>
            )}
          </section>
        )
      })}
    </div>
  )
}
