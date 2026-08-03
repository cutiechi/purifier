"use client"

import { PostCard, PostList } from "@/components/post-card"
import { readPath } from "@/lib/routes"

export interface ReplyNode {
  tid: string
  uptid: string
  rootid: string
  uid: string
  username: string
  subject: string
  dateline: string
  size: number
  children: ReplyNode[]
}

function countNodes(nodes: ReplyNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0)
}

function ReplyTree({
  nodes,
  depth,
}: {
  nodes: ReplyNode[]
  depth: number
}) {
  return (
    <PostList className={depth > 0 ? "mt-1.5" : undefined}>
      {nodes.map((node) => (
        <div key={node.tid} style={{ marginLeft: Math.min(depth, 5) * 10 }}>
          <PostCard
            href={readPath(node.tid)}
            title={node.subject || "（无标题）"}
            subtitle={
              <>
                {node.username || "匿名"}
                {node.dateline ? ` · ${node.dateline}` : ""}
                {node.size > 0
                  ? ` · ${node.size.toLocaleString()} bytes`
                  : ""}
              </>
            }
          />
          {node.children.length > 0 && (
            <ReplyTree nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </PostList>
  )
}

export function ReplyList({ replies }: { replies: ReplyNode[] }) {
  if (!replies?.length) return null
  const total = countNodes(replies)

  return (
    <section className="border-border mt-10 border-t pt-8 sm:mt-12">
      <h3 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
        评论 · {total}
      </h3>
      <ReplyTree nodes={replies} depth={0} />
    </section>
  )
}
