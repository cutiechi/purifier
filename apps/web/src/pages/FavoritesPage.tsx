import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useConfirm } from "@/components/confirm-dialog"
import { FavoritedGroupCard } from "@/components/favorited-group-card"
import { MeListPage } from "@/components/me-list-page"
import { type MeListItem } from "@/components/me-item-card"
import { PostList } from "@/components/post-card"
import { type Group } from "@/lib/groups"
import { api, meListQuery, parsePage, parseQuery } from "@/lib/routes"

function UnfavoriteButton({
  item,
  reload,
}: {
  item: MeListItem
  reload: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const ok = await confirm({
          title: "取消收藏？",
          description: `将从收藏中移除「${item.title}」。`,
          confirmLabel: "取消收藏",
          destructive: true,
        })
        if (!ok) return
        setBusy(true)
        try {
          const res = await fetch(
            `${api.meFavorites}?kind=${item.kind}&id=${encodeURIComponent(item.id)}`,
            { method: "DELETE" }
          )
          if (res.ok) reload()
        } finally {
          setBusy(false)
        }
      }}
      className="min-h-9 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 sm:min-h-0"
    >
      取消收藏
    </button>
  )
}

export default function FavoritesPage() {
  const [searchParams] = useSearchParams()
  const q = parseQuery(searchParams)
  const kind = searchParams.get("kind") ?? ""
  const page = parsePage(searchParams)
  const showGroups = !q && !kind && page === 1

  const [groups, setGroups] = useState<Group[]>([])
  const [groupsError, setGroupsError] = useState("")

  const reloadGroups = useCallback(async () => {
    try {
      const res = await fetch(api.meGroups)
      if (!res.ok) {
        setGroupsError("分组加载失败")
        return
      }
      const json = (await res.json()) as { groups: Group[] }
      setGroups((json.groups ?? []).filter((g) => g.favorited))
      setGroupsError("")
    } catch {
      setGroupsError("分组加载失败")
    }
  }, [])

  useEffect(() => {
    if (showGroups) void reloadGroups()
    else {
      setGroups([])
      setGroupsError("")
    }
  }, [showGroups, reloadGroups])

  const renderTrailing = useCallback(
    (item: MeListItem, reload: () => void) => (
      <UnfavoriteButton item={item} reload={reload} />
    ),
    []
  )

  const toolbar = useCallback(() => {
    if (!showGroups) return null
    // 无内容且无错误时连标题都不渲染，避免空区块
    if (!groupsError && groups.length === 0) return null
    return (
      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          已收藏的分组
        </h2>
        {groupsError && (
          <p className="mb-2 text-xs text-destructive">{groupsError}</p>
        )}
        {groups.length > 0 && (
          <PostList>
            {groups.map((g) => (
              <FavoritedGroupCard
                key={g.id}
                group={g}
                onChanged={reloadGroups}
              />
            ))}
          </PostList>
        )}
      </section>
    )
  }, [showGroups, groups, groupsError, reloadGroups])

  return (
    <MeListPage
      title="收藏"
      description="收藏的贴子、书库与分组"
      bookGroupScope="favorites"
      buildUrl={(q2, kind2, page2) =>
        `${api.meFavorites}?${meListQuery({ q: q2, kind: kind2, page: page2 })}`
      }
      pick={(json) =>
        json as { items: MeListItem[]; nextPage?: number; total?: number }
      }
      renderTrailing={renderTrailing}
      toolbar={toolbar}
      emptyText="还没有收藏，阅读时点星标即可加入"
    />
  )
}
