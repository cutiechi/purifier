import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "./db"
import { Store, normalizeTag } from "./store"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "purifier-db-"))
}

describe("openDatabase", () => {
  test("creates items/favorites/tags/groups tables", () => {
    const dir = tempDir()
    const db = openDatabase(dir)
    const rows = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]
    expect(rows.map((r) => r.name)).toEqual([
      "archive_posts",
      "favorites",
      "group_items",
      "groups",
      "items",
      "job_logs",
      "jobs",
      "tags",
    ])
    // 新库直接是 site 主键
    const meta = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
      )
      .get() as { sql: string }
    expect(meta.sql).toMatch(/PRIMARY\s+KEY\s*\(\s*site,\s*kind,\s*id/i)
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='archive_posts' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]
    expect(idx.map((r) => r.name)).toEqual([
      "archive_posts_site_archived_idx",
      "archive_posts_site_title_idx",
    ])
    const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }
    expect(fk.foreign_keys).toBe(1)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("is idempotent on second open", () => {
    const dir = tempDir()
    openDatabase(dir).close()
    const db = openDatabase(dir) // 不抛错即通过
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "purifier-store-"))
  let t = 1_000
  const store = new Store(openDatabase(dir), () => t++)
  return { store, dir }
}

describe("recordVisit / getState", () => {
  test("new visit counts 1 and upsert increments + overwrites title", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "10", "标题A", "urlA")
    expect(store.getState("1", "post", "10")?.visit_count).toBe(1)
    store.recordVisit("1", "post", "10", "标题A2", "urlA")
    const state = store.getState("1", "post", "10")
    expect(state?.visit_count).toBe(2)
    expect(state?.title).toBe("标题A2")
    expect(state?.first_seen_at).toBe(1000)
    expect(state?.last_visited_at).toBe(1001)
  })

  test("missing item returns null", () => {
    const { store } = makeStore()
    expect(store.getState("1", "post", "nope")).toBeNull()
  })

  test("recordVisit with undefined title keeps existing title", () => {
    const { store, dir } = makeStore()
    try {
      store.recordVisit("1", "book", "X", "书名", "/url")
      store.recordVisit("1", "book", "X", undefined, "/url")
      const state = store.getState("1", "book", "X")
      expect(state?.title).toBe("书名") // 不被覆盖成 url
      expect(state?.visit_count).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("recordVisit with undefined title falls back to url for new row", () => {
    const { store, dir } = makeStore()
    try {
      store.recordVisit("1", "book", "Y", undefined, "/url")
      expect(store.getState("1", "book", "Y")?.title).toBe("/url")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("deleteItem / clearHistory", () => {
  test("deleteItem removes item favorites and tags", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "T", "u")
    store.addFavorite("1", "post", "1")
    store.setTags("1", "post", "1", ["科幻"])
    expect(store.deleteItem("1", "post", "1")).toBe(true)
    expect(store.getState("1", "post", "1")).toBeNull()
    expect(store.listFavorites({}).items).toEqual([])
    expect(store.listTags()).toEqual([])
    expect(store.deleteItem("1", "post", "1")).toBe(false)
  })

  test("deleteItems batch and clearHistory", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "A", "u")
    store.recordVisit("1", "book", "2", "B", "u")
    store.recordVisit("1", "post", "3", "C", "u")
    store.setTags("1", "post", "1", ["x"])
    expect(
      store.deleteItems([
        { site: "1", kind: "post", id: "1" },
        { site: "1", kind: "book", id: "2" },
        { site: "1", kind: "post", id: "missing" },
      ])
    ).toBe(2)
    expect(store.listHistory({}).items.map((i) => i.id)).toEqual(["3"])
    expect(store.clearHistory()).toBe(1)
    expect(store.listHistory({}).items).toEqual([])
    expect(store.clearHistory()).toBe(0)
  })
})

describe("favorites", () => {
  test("addFavorite fails for missing item", () => {
    const { store } = makeStore()
    expect(store.addFavorite("1", "post", "1")).toBe(false)
  })

  test("add/remove favorite toggles state", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "T", "u")
    expect(store.addFavorite("1", "post", "1")).toBe(true)
    expect(store.getState("1", "post", "1")?.favorited).toBe(true)
    store.removeFavorite("1", "post", "1")
    expect(store.getState("1", "post", "1")?.favorited).toBe(false)
  })
})

describe("setTags / normalize", () => {
  test("setTags replaces the whole set", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "T", "u")
    expect(store.setTags("1", "post", "1", ["科幻", "长篇"])).toEqual([
      "科幻",
      "长篇",
    ])
    store.setTags("1", "post", "1", ["连载中"])
    expect(store.getState("1", "post", "1")?.tags).toEqual(["连载中"])
  })

  test("setTags normalizes and dedupes", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "T", "u")
    store.setTags("1", "post", "1", ["  科幻  ", "科 幻", "科幻", "", "  "])
    expect(store.getState("1", "post", "1")?.tags).toEqual(["科幻", "科 幻"])
  })

  test("truncates tags to 24 code points", () => {
    expect(normalizeTag("超长标签".repeat(10))?.length).toBe(24)
    expect(normalizeTag("   ")).toBeNull()
  })

  test("setTags returns null for missing item", () => {
    const { store } = makeStore()
    expect(store.setTags("1", "book", "9", ["x"])).toBeNull()
  })

  test("deleteTag removes the tag from all items", () => {
    const { store } = makeStore()
    store.recordVisit("1", "post", "1", "T1", "u1")
    store.recordVisit("1", "post", "2", "T2", "u2")
    store.setTags("1", "post", "1", ["科幻", "长篇"])
    store.setTags("1", "post", "2", ["科幻"])
    expect(store.deleteTag(undefined, "科幻")).toBe(2)
    expect(store.getState("1", "post", "1")?.tags).toEqual(["长篇"])
    expect(store.getState("1", "post", "2")?.tags).toEqual([])
    expect(store.listTags()).toEqual([{ tag: "长篇", count: 1 }])
    expect(store.deleteTag(undefined, "不存在")).toBe(0)
    expect(store.deleteTag(undefined, "  ")).toBe(0)
  })
})

function seed(store: Store) {
  store.recordVisit("1", "post", "1", "Alpha 星", "u1")
  store.recordVisit("1", "book", "2", "Beta 书", "u2")
  store.recordVisit("1", "post", "3", "gamma 贴", "u3")
  store.setTags("1", "post", "1", ["科幻"])
  store.setTags("1", "post", "3", ["随笔"])
  store.addFavorite("1", "book", "2")
}

describe("listHistory", () => {
  test("orders by last_visited_at desc", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({})
    expect(res.items.map((i) => i.id)).toEqual(["3", "2", "1"])
    expect(res.nextPage).toBeUndefined()
  })

  test("matches title substring case-insensitively and tag exactly", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listHistory({ q: "ALPHA" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
    expect(store.listHistory({ q: "科幻" }).items.map((i) => i.id)).toEqual([
      "1",
    ])
  })

  test("filters by kind and aggregates tags/favorited", () => {
    const { store } = makeStore()
    seed(store)
    const res = store.listHistory({ kind: "book" })
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.tags).toEqual([])
    expect(res.items[0]?.favorited).toBe(true)
    const posts = store.listHistory({ kind: "post" })
    expect(posts.items.map((i) => i.id)).toEqual(["3", "1"])
    expect(posts.items.find((i) => i.id === "1")?.tags).toEqual(["科幻"])
  })

  test("paginates 20 per page and returns total", () => {
    const { store } = makeStore()
    for (let i = 0; i < 25; i++) {
      store.recordVisit("1", "post", String(i), `T${i}`, "u")
    }
    const p1 = store.listHistory({ page: 1 })
    expect(p1.items).toHaveLength(20)
    expect(p1.nextPage).toBe(2)
    expect(p1.total).toBe(25)
    const p2 = store.listHistory({ page: 2 })
    expect(p2.items).toHaveLength(5)
    expect(p2.nextPage).toBeUndefined()
    expect(p2.total).toBe(25)
  })
})

describe("listFavorites", () => {
  test("orders by favorited_at desc and returns favorited_at", () => {
    const { store } = makeStore()
    seed(store)
    store.recordVisit("1", "post", "10", "Ten", "u")
    store.addFavorite("1", "post", "10")
    const res = store.listFavorites({})
    expect(res.items.map((i) => i.id)).toEqual(["10", "2"])
    expect(res.items[0]?.favorited_at).toBeDefined()
    expect(res.items.every((i) => i.favorited)).toBe(true)
  })

  test("searches within favorites", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listFavorites({ q: "beta" }).items.map((i) => i.id)).toEqual([
      "2",
    ])
  })
})

describe("listTags", () => {
  test("counts desc, tie by tag asc", () => {
    const { store } = makeStore()
    seed(store)
    store.setTags("1", "book", "2", ["科幻", "历史"])
    const res = store.listTags()
    expect(res).toEqual([
      { tag: "科幻", count: 2 },
      { tag: "历史", count: 1 },
      { tag: "随笔", count: 1 },
    ])
  })
})

describe("listByTag", () => {
  test("filters exactly by tag, then q and kind", () => {
    const { store } = makeStore()
    seed(store)
    expect(store.listByTag("科幻", {}).items.map((i) => i.id)).toEqual(["1"])
    expect(store.listByTag("科", {}).items).toHaveLength(0) // 精确匹配
    expect(store.listByTag("科幻", { kind: "book" }).items).toHaveLength(0)
  })
})

describe("multi-site", () => {
  test("sites are isolated: same kind/id on different sites are distinct rows", () => {
    const { store, dir } = makeStore()
    try {
      store.recordVisit("1", "book", "X", "站一", "/cool18/x")
      store.recordVisit("2", "book", "X", "站二", "/xbookcn/x")
      expect(store.getState("1", "book", "X")?.title).toBe("站一")
      expect(store.getState("2", "book", "X")?.title).toBe("站二")
      expect(store.getState("1", "book", "X")?.visit_count).toBe(1)
      expect(store.getState("2", "book", "X")?.visit_count).toBe(1)
      // 再访问站一不影响站二
      store.recordVisit("1", "book", "X", "站一2", "/cool18/x")
      expect(store.getState("1", "book", "X")?.visit_count).toBe(2)
      expect(store.getState("2", "book", "X")?.visit_count).toBe(1)
      // 删除只删本站
      store.addFavorite("1", "book", "X")
      store.addFavorite("2", "book", "X")
      store.deleteItem("1", "book", "X")
      expect(store.getState("1", "book", "X")).toBeNull()
      expect(store.getState("2", "book", "X")?.favorited).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("setProgress writes last_chapter and leaves it unchanged without chapter", () => {
    const { store, dir } = makeStore()
    try {
      store.recordVisit("2", "book", "X", "书名", "/xbookcn/x")
      expect(store.getState("2", "book", "X")?.lastChapter).toBeNull()
      store.setProgress("2", "book", "X", 0.5, 3)
      expect(store.getState("2", "book", "X")?.lastChapter).toBe(3)
      expect(store.getState("2", "book", "X")?.read_progress).toBeCloseTo(0.5)
      // 不传 chapter：last_chapter 保持
      store.setProgress("2", "book", "X", 0.8)
      expect(store.getState("2", "book", "X")?.lastChapter).toBe(3)
      expect(store.getState("2", "book", "X")?.read_progress).toBeCloseTo(0.8)
      // 列表返回也带 lastChapter
      store.recordVisit("1", "book", "Y", "另一本", "/cool18/y")
      store.setProgress("1", "book", "Y", 0.1, 7)
      const item = store
        .listHistory({ site: "1" })
        .items.find((i) => i.id === "Y")
      expect(item?.lastChapter).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("list queries filter by site; clearHistory(site) and deleteTag(site) are scoped", () => {
    const { store, dir } = makeStore()
    try {
      store.recordVisit("1", "post", "a", "A站", "u")
      store.recordVisit("2", "post", "b", "B站", "u")
      store.setTags("1", "post", "a", ["科幻"])
      store.setTags("2", "post", "b", ["科幻"])
      store.addFavorite("1", "post", "a")
      store.addFavorite("2", "post", "b")
      expect(store.listHistory({ site: "1" }).items.map((i) => i.id)).toEqual([
        "a",
      ])
      expect(store.listHistory({ site: "2" }).items.map((i) => i.id)).toEqual([
        "b",
      ])
      expect(store.listFavorites({ site: "1" }).items.map((i) => i.id)).toEqual(
        ["a"]
      )
      expect(
        store.listByTag("科幻", { site: "2" }).items.map((i) => i.id)
      ).toEqual(["b"])
      expect(store.listTags("1")).toEqual([{ tag: "科幻", count: 1 }])
      // deleteTag 按站删
      store.deleteTag("1", "科幻")
      expect(store.getState("1", "post", "a")?.tags).toEqual([])
      expect(store.getState("2", "post", "b")?.tags).toEqual(["科幻"])
      // deleteItems 混站逐条删
      expect(
        store.deleteItems([
          { site: "1", kind: "post", id: "a" },
          { site: "2", kind: "post", id: "b" },
        ])
      ).toBe(2)
      expect(store.listHistory({}).items).toEqual([])
      // clearHistory(site) 只清该站
      store.recordVisit("1", "post", "a", "A站", "u")
      store.recordVisit("2", "post", "b", "B站", "u")
      expect(store.clearHistory("1")).toBe(1)
      expect(store.listHistory({}).items.map((i) => i.id)).toEqual(["b"])
      expect(store.clearHistory()).toBe(1)
      expect(store.listHistory({}).items).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// 模拟旧库：用不含 read_progress / site / last_chapter 的 DDL 建库并写入一行
function makeOldDatabase(dir: string): void {
  const db = new Database(join(dir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_visited_at INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS favorites (kind TEXT NOT NULL, id TEXT NOT NULL, favorited_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
    CREATE TABLE IF NOT EXISTS tags (kind TEXT NOT NULL, id TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id, tag));
  `)
  db.query(
    "INSERT INTO items (kind, id, title, url, first_seen_at, last_visited_at, visit_count) VALUES ('post', 't1', 'old', '/read/t1', 1, 1, 3)"
  ).run()
  db.close()
}

test("openDatabase migrates old DB: adds read_progress, preserves data", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-migrate-old-"))
  try {
    makeOldDatabase(dir)
    // 确认旧库确实没有 read_progress
    const before = new Database(join(dir, "purifier.db"))
    const colsBefore = before.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(colsBefore.map((c) => c.name)).not.toContain("read_progress")
    before.close()

    // 重新打开会触发迁移
    const db = openDatabase(dir)
    const cols = db.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(cols.map((c) => c.name)).toContain("read_progress")
    expect(cols.map((c) => c.name)).toContain("last_chapter")
    expect(cols.map((c) => c.name)).toContain("site")
    // 旧行数据保留，site='1'，last_chapter 默认 NULL
    const row = db
      .query(
        "SELECT title, visit_count, read_progress, site, last_chapter FROM items WHERE id = 't1'"
      )
      .get() as {
      title: string
      visit_count: number
      read_progress: number | null
      site: string
      last_chapter: number | null
    }
    expect(row.title).toBe("old")
    expect(row.visit_count).toBe(3)
    expect(row.read_progress).toBeNull() // 新列默认 NULL
    expect(row.site).toBe("1")
    expect(row.last_chapter).toBeNull()
    // 新 PK 生效：ON CONFLICT(site,kind,id) 不炸，同键 upsert
    const store = new Store(db)
    store.recordVisit("1", "post", "t1", "新标题", "/read/t1")
    const state = store.getState("1", "post", "t1")
    expect(state?.visit_count).toBe(4)
    expect(state?.title).toBe("新标题")
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 半迁移库：items 已有 site 列但 PK 仍是 (kind,id)
function makeHalfMigratedDatabase(dir: string): void {
  const db = new Database(join(dir, "purifier.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      kind TEXT NOT NULL CHECK (kind IN ('post', 'book')),
      site TEXT NOT NULL DEFAULT '1',
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_visited_at INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 1,
      read_progress REAL,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS favorites (kind TEXT NOT NULL, id TEXT NOT NULL, favorited_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
    CREATE TABLE IF NOT EXISTS tags (kind TEXT NOT NULL, id TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id, tag));
  `)
  db.query(
    "INSERT INTO items (kind, site, id, title, url, first_seen_at, last_visited_at, visit_count) VALUES ('post', '1', 'h1', 'half', '/read/h1', 1, 1, 1)"
  ).run()
  db.close()
}

test("openDatabase rebuilds half-migrated DB (site column but PK (kind,id))", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-migrate-half-"))
  try {
    makeHalfMigratedDatabase(dir)
    const db = openDatabase(dir)
    // PK 被重建为 (site, kind, id)
    const meta = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
      )
      .get() as { sql: string }
    expect(meta.sql).toMatch(/PRIMARY\s+KEY\s*\(\s*site,\s*kind,\s*id/i)
    // 数据保留
    const row = db
      .query("SELECT title, site FROM items WHERE id = 'h1'")
      .get() as { title: string; site: string }
    expect(row.title).toBe("half")
    expect(row.site).toBe("1")
    // 新 PK 生效：ON CONFLICT(site,kind,id) 不炸
    const store = new Store(db)
    store.recordVisit("1", "post", "h1", "新标题", "/read/h1")
    expect(store.getState("1", "post", "h1")?.visit_count).toBe(2)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("openDatabase is idempotent when read_progress already exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "purifier-migrate-idem-"))
  try {
    const db1 = openDatabase(dir)
    db1.close()
    // 第二次打开同一库：PRAGMA 检测到列已存在，不再 ALTER，不报错
    const db2 = openDatabase(dir)
    const cols = db2.query("PRAGMA table_info(items)").all() as {
      name: string
    }[]
    expect(cols.filter((c) => c.name === "read_progress")).toHaveLength(1)
    db2.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setProgress / getState round-trip read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    expect(store.getState("1", "post", "t1")?.read_progress).toBeNull()

    store.setProgress("1", "post", "t1", 0.42)
    expect(store.getState("1", "post", "t1")?.read_progress).toBeCloseTo(0.42)

    // clamp 上界
    store.setProgress("1", "post", "t1", 5)
    expect(store.getState("1", "post", "t1")?.read_progress).toBe(1)

    // clamp 下界
    store.setProgress("1", "post", "t1", -3)
    expect(store.getState("1", "post", "t1")?.read_progress).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("setProgress returns false for missing item", () => {
  const { store, dir } = makeStore()
  try {
    expect(store.setProgress("1", "post", "nope", 0.5)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("listHistory includes read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    store.setProgress("1", "post", "t1", 0.3)
    const items = store.listHistory({ page: 1 }).items
    expect(items[0]?.read_progress).toBeCloseTo(0.3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("recordVisit does not reset read_progress", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    store.setProgress("1", "post", "t1", 0.5)
    store.recordVisit("1", "post", "t1", "title2", "/read/t1") // 再访问
    expect(store.getState("1", "post", "t1")?.read_progress).toBeCloseTo(0.5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("deleteItem clears read_progress with the row", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    store.setProgress("1", "post", "t1", 0.5)
    store.deleteItem("1", "post", "t1")
    // 重新创建同 id：read_progress 必须是新行的 NULL，不是旧值
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    expect(store.getState("1", "post", "t1")?.read_progress).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("clearHistory clears read_progress for all rows", () => {
  const { store, dir } = makeStore()
  try {
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    store.setProgress("1", "post", "t1", 0.9)
    store.clearHistory()
    store.recordVisit("1", "post", "t1", "title", "/read/t1")
    expect(store.getState("1", "post", "t1")?.read_progress).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
