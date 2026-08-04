import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
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
  kind: ItemKind,
  id: string
): string {
  assertSafeId(id)
  return join(dataDir, "cache", `${kind}-${id}.html`)
}

export function repliesCachePath(dataDir: string, id: string): string {
  assertSafeId(id)
  return join(dataDir, "cache", `replies-${id}.json`)
}

/** 读正文/书库 HTML 缓存；无缓存返回 null */
export async function readContentCache(
  dataDir: string,
  kind: ItemKind,
  id: string
): Promise<CacheEntry<string> | null> {
  const path = contentCachePath(dataDir, kind, id)
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
  kind: ItemKind,
  id: string,
  html: string
): Promise<void> {
  await mkdir(join(dataDir, "cache"), { recursive: true })
  await writeFile(contentCachePath(dataDir, kind, id), html, "utf8")
}

/** 读回复 JSON 缓存；无缓存返回 null（data 类型由调用方校验，损坏 JSON 抛错） */
export async function readRepliesCache(
  dataDir: string,
  id: string
): Promise<CacheEntry<unknown> | null> {
  const path = repliesCachePath(dataDir, id)
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
  id: string,
  replies: unknown
): Promise<void> {
  await mkdir(join(dataDir, "cache"), { recursive: true })
  await writeFile(
    repliesCachePath(dataDir, id),
    JSON.stringify(replies),
    "utf8"
  )
}

/** 清空 cache/ 目录下全部文件；返回删除数量；目录不存在返回 0 */
export async function clearCache(dataDir: string): Promise<number> {
  const dir = join(dataDir, "cache")
  let cleared = 0
  try {
    for (const name of await readdir(dir)) {
      await unlink(join(dir, name))
      cleared++
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  return cleared
}
