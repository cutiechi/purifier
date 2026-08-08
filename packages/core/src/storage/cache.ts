import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { ExtractorError } from "../extractor/types"
import { ItemKind } from "./types"

/** 只允许数字与字母，防路径穿越 */
const SAFE_ID = /^[A-Za-z0-9]+$/

export function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new ExtractorError("invalid id", 400)
  }
}

export interface CacheEntry<T> {
  data: T
  mtimeMs: number
  sizeBytes: number
}

export function contentCachePath(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string,
  chapter?: number | string
): string {
  assertSafeId(site)
  assertSafeId(id)
  if (chapter !== undefined) assertSafeId(String(chapter))
  const ch = chapter !== undefined ? `-ch${chapter}` : ""
  return join(dataDir, "cache", site, `${kind}-${id}${ch}.html`)
}

export function repliesCachePath(
  dataDir: string,
  site: string,
  id: string
): string {
  assertSafeId(site)
  assertSafeId(id)
  return join(dataDir, "cache", site, `replies-${id}.json`)
}

/** 读正文/书库 HTML 缓存；无缓存返回 null */
export async function readContentCache(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string,
  chapter?: number | string
): Promise<CacheEntry<string> | null> {
  const path = contentCachePath(dataDir, site, kind, id, chapter)
  try {
    const [data, info] = await Promise.all([readFile(path, "utf8"), stat(path)])
    return { data, mtimeMs: info.mtimeMs, sizeBytes: info.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function writeContentCache(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string,
  html: string,
  chapter?: number | string
): Promise<void> {
  const path = contentCachePath(dataDir, site, kind, id, chapter)
  await mkdir(join(dataDir, "cache", site), { recursive: true })
  // 原子写：先 tmp 再 rename，避免崩溃留下截断文件被当成命中
  const tmp = `${path}.tmp`
  await writeFile(tmp, html, "utf8")
  await rename(tmp, path)
}

/** 读回复 JSON 缓存；无缓存返回 null（data 类型由调用方校验，损坏 JSON 抛错） */
export async function readRepliesCache(
  dataDir: string,
  site: string,
  id: string
): Promise<CacheEntry<unknown> | null> {
  const path = repliesCachePath(dataDir, site, id)
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)])
    return {
      data: JSON.parse(raw),
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export async function writeRepliesCache(
  dataDir: string,
  site: string,
  id: string,
  replies: unknown
): Promise<void> {
  await mkdir(join(dataDir, "cache", site), { recursive: true })
  const path = repliesCachePath(dataDir, site, id)
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(replies), "utf8")
  await rename(tmp, path)
}

/**
 * 删除某条目相关磁盘缓存（正文/章节/回复）。
 * 删历史/收藏时调用，避免 DB 无记录但缓存仍命中旧正文。
 */
export async function deleteItemCaches(
  dataDir: string,
  site: string,
  kind: ItemKind,
  id: string
): Promise<number> {
  assertSafeId(site)
  assertSafeId(id)
  const dir = join(dataDir, "cache", site)
  let n = 0
  try {
    const files = await readdir(dir)
    for (const name of files) {
      const hit =
        kind === "post"
          ? name === `post-${id}.html` ||
            name === `replies-${id}.json` ||
            name.startsWith(`post-${id}.`)
          : name === `book-${id}.html` ||
            name.startsWith(`book-${id}-ch`) ||
            name.startsWith(`book-${id}.`)
      if (!hit) continue
      // 跳过进行中的 .tmp（rename 目标会覆盖）
      try {
        await rm(join(dir, name), { force: true })
        n++
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  return n
}

/** 清空 cache/ 目录下全部文件（含 site 子目录）；返回删除数量；目录不存在返回 0 */
export async function clearCache(dataDir: string): Promise<number> {
  const dir = join(dataDir, "cache")
  try {
    const cleared = await countFiles(dir)
    await rm(dir, { recursive: true, force: true })
    return cleared
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    return 0
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1
  }
  return n
}
