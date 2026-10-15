/** 与 packages/core PAGE_SIZE 对齐的我的列表页大小 */
export const ME_PAGE_SIZE = 20
/** 归档目录默认页大小（API limit 默认 50） */
export const ARCHIVE_PAGE_SIZE = 50

/**
 * 统一分页摘要文案。
 * - 有 total：共 N 条 · 第 p/P 页 · 本页 M 条
 * - 无 total（上游列表）：第 p 页 · 本页 M 条[ · 还有更多]
 */
export function formatListPagination(opts: {
  page: number
  pageCount: number
  pageSize: number
  total?: number | null
  hasNext?: boolean
}): string {
  const page = Math.max(1, opts.page)
  const pageCount = Math.max(0, opts.pageCount)
  const pageSize = Math.max(1, opts.pageSize)

  if (opts.total != null && Number.isFinite(opts.total)) {
    const total = Math.max(0, Math.floor(opts.total))
    if (total === 0) return "共 0 条"
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return `共 ${total} 条 · 第 ${page}/${totalPages} 页 · 本页 ${pageCount} 条`
  }

  const more = opts.hasNext ? " · 还有更多" : ""
  return `第 ${page} 页 · 本页 ${pageCount} 条${more}`
}

export function totalPages(total: number, pageSize: number): number {
  if (total <= 0) return 1
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
