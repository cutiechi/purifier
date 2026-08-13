# OIDC / Pocket ID 实例门锁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配齐 OIDC 环境变量后整站门锁；未配置时行为与现在完全相同；Pocket ID 走标准 Authorization Code + PKCE，本站 HttpOnly 会话 Cookie。

**Architecture:** `packages/core/src/auth/` 解析配置、HMAC 会话、redirect/`iss` 校验、缓存的 `openid-client` discovery。`apps/api` 在 `routeInner` 入口验 Cookie 并提供 `/api/auth/*`。SPA `/login` + `AuthProvider` 包一层；`window.fetch` 包装处理 401（排除 keepalive）。

**Tech Stack:** Bun 1.3.14、`openid-client` v6、`jose`（仅 core 测试签 mock ID Token）、Vite + React 19。失败则按 spec 改 `jose` 手写 discovery（本计划默认 v6 可用）。

**Spec:** `docs/superpowers/specs/2026-08-13-oidc-pocket-id-design.md`

**状态：** 已按 `docs/superpowers/plans/review.md` 修订（#1 bun add 无 --filter；#2 clearCookie 带 httpOnly；#3 jose fallback 改 dependencies；#4 门锁在 try 开始处；#5 fetch 只匹配同源 `/api/`）

## Global Constraints

- Prettier：无分号、双引号、`printWidth: 80`、`trailingComma: "es5"`。
- 验证：`bun run test` / `bun run typecheck` / `bun run build`。
- 错误体 `{ "error": "..." }`；auth 响应 `NO_STORE_HEADERS`。
- 不建用户表、不按 `sub` 隔离 SQLite。
- Cookie 名：`purifier_session` / `purifier_oauth_state` / `purifier_oauth_code_verifier`。
- `AUTH_SECRET` 开启时 ≥ 32 字符，否则 `parseAuthConfig` 抛错、API `exit(1)`。
- 半配（部分 OIDC 变量有值）→ disabled + 启动 warning。
- 默认按钮文案：`使用 Pocket ID 登录`。
- 会话 Max-Age=604800；OAuth 临时 Cookie Max-Age=600；`Path=/`；`SameSite=Lax`；HTTPS 或 `X-Forwarded-Proto: https` 时 `Secure`。
- 不引入 HTTP 框架；不联邦登出；不 Auto Launch。
- web 组件不做单测；纯函数与门锁逻辑在 `packages/core` 用 `bun test`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/auth/types.ts` | `AuthMe`、`AuthConfig`、`AuthError`、Cookie 名常量 |
| `packages/core/src/auth/config.ts` | `parseAuthConfig`、`DEFAULT_BUTTON_TEXT`、`normalizeIssuer` |
| `packages/core/src/auth/session.ts` | HMAC 签发/校验、Cookie 序列化 |
| `packages/core/src/auth/redirect.ts` | callback `url` 比对、query `iss` |
| `packages/core/src/auth/oidc.ts` | 缓存 discovery、authorize、exchange |
| `packages/core/src/auth/paths.ts` | `isOidcPublicApi` |
| `packages/core/src/auth/index.ts` | 再导出 |
| `packages/core/src/auth/*.test.ts` | 对应测试 |
| `packages/core/package.json` | `openid-client`；`jose` 默认 dev（mock ID Token）；fallback 手写路径则改为 runtime dependency；export `./auth` |
| `packages/core/src/index.ts` | `export * from "./auth"` |
| `apps/api/src/index.ts` | 启动解析、门锁、`/api/auth/*`、`AuthError` 映射 |
| `apps/web/src/lib/routes.ts` | `routes.login`、`api.auth*` |
| `apps/web/src/lib/auth.tsx` | `AuthProvider`、fetch 包装、守卫 |
| `apps/web/src/pages/LoginPage.tsx` | 登录页 |
| `apps/web/src/App.tsx` | `/login` 在 `*` 之前 |
| `apps/web/src/main.tsx` | 包 `AuthProvider` |
| `apps/web/src/components/site-header.tsx` | 退出 |
| `AGENTS.md` / `README.md` | API、env、警示 |

---

### Task 1: 配置解析与公开路径

**Files:**
- Create: `packages/core/src/auth/types.ts`
- Create: `packages/core/src/auth/config.ts`
- Create: `packages/core/src/auth/paths.ts`
- Create: `packages/core/src/auth/index.ts`
- Create: `packages/core/src/auth/config.test.ts`
- Create: `packages/core/src/auth/paths.test.ts`
- Modify: `packages/core/package.json`（export `"./auth": "./src/auth/index.ts"`）
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `DEFAULT_BUTTON_TEXT = "使用 Pocket ID 登录"`
  - `AUTH_SECRET_MIN = 32`
  - `class AuthError extends Error { readonly error: string; readonly statusCode: number }`
  - `type AuthMe = { enabled: boolean; sub: string \| null; email: string \| null; name: string \| null }`
  - `type AuthConfig = { enabled: false; buttonText: string; partial: boolean } \| { enabled: true; issuer: string; clientId: string; clientSecret: string; redirectUri: string; secret: string; buttonText: string; partial: false }`
  - `parseAuthConfig(env: Record<string, string \| undefined>): AuthConfig`
  - `normalizeIssuer(raw: string): string`
  - `emptyAuthMe(): AuthMe` → `{ enabled: false, sub: null, email: null, name: null }`
  - `isOidcPublicApi(method: string, pathname: string): boolean`

- [ ] **Step 1: 写失败测试**

`packages/core/src/auth/config.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import {
  AUTH_SECRET_MIN,
  DEFAULT_BUTTON_TEXT,
  parseAuthConfig,
  normalizeIssuer,
} from "./config"

const full = {
  OIDC_ISSUER: "https://id.example.com",
  OIDC_CLIENT_ID: "cid",
  OIDC_CLIENT_SECRET: "csecret",
  OIDC_REDIRECT_URI: "https://app.example/login",
  AUTH_SECRET: "s".repeat(AUTH_SECRET_MIN),
}

describe("parseAuthConfig", () => {
  test("all empty → disabled", () => {
    const c = parseAuthConfig({})
    expect(c.enabled).toBe(false)
    if (!c.enabled) {
      expect(c.partial).toBe(false)
      expect(c.buttonText).toBe(DEFAULT_BUTTON_TEXT)
    }
  })

  test("partial env → disabled partial", () => {
    const c = parseAuthConfig({ OIDC_ISSUER: "https://id.example.com" })
    expect(c.enabled).toBe(false)
    if (!c.enabled) expect(c.partial).toBe(true)
  })

  test("full set → enabled", () => {
    const c = parseAuthConfig(full)
    expect(c.enabled).toBe(true)
    if (c.enabled) {
      expect(c.issuer).toBe("https://id.example.com")
      expect(c.redirectUri).toBe("https://app.example/login")
    }
  })

  test("custom button text", () => {
    const c = parseAuthConfig({ ...full, OIDC_BUTTON_TEXT: "登录" })
    expect(c.buttonText).toBe("登录")
  })

  test("short AUTH_SECRET throws", () => {
    expect(() =>
      parseAuthConfig({ ...full, AUTH_SECRET: "short" })
    ).toThrow(/AUTH_SECRET/)
  })
})

describe("normalizeIssuer", () => {
  test("strips well-known and trailing slash", () => {
    expect(
      normalizeIssuer(
        "https://id.example.com/.well-known/openid-configuration/"
      )
    ).toBe("https://id.example.com")
  })
})
```

`packages/core/src/auth/paths.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { isOidcPublicApi } from "./paths"

describe("isOidcPublicApi", () => {
  test("allows health config authorize callback logout", () => {
    expect(isOidcPublicApi("GET", "/api/health")).toBe(true)
    expect(isOidcPublicApi("GET", "/api/auth/config")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/authorize")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/callback")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/logout")).toBe(true)
  })

  test("rejects me posts and wrong methods", () => {
    expect(isOidcPublicApi("GET", "/api/auth/me")).toBe(false)
    expect(isOidcPublicApi("GET", "/api/posts")).toBe(false)
    expect(isOidcPublicApi("GET", "/api/auth/authorize")).toBe(false)
    expect(isOidcPublicApi("POST", "/api/health")).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/auth/config.test.ts src/auth/paths.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`types.ts`：`AuthError`（`constructor(error: string, statusCode: number)`，`this.name = "AuthError"`）、`AuthMe`、`AuthConfig`、Cookie 名：

```ts
export const COOKIE_SESSION = "purifier_session"
export const COOKIE_OAUTH_STATE = "purifier_oauth_state"
export const COOKIE_OAUTH_VERIFIER = "purifier_oauth_code_verifier"
export const SESSION_MAX_AGE_S = 604_800
export const OAUTH_COOKIE_MAX_AGE_S = 600
```

`config.ts`：五键 `OIDC_ISSUER` `OIDC_CLIENT_ID` `OIDC_CLIENT_SECRET` `OIDC_REDIRECT_URI` `AUTH_SECRET`。trim 后空当缺。全缺 → `{ enabled: false, partial: false, buttonText }`。1–4 项有值 → `partial: true`。五项齐且 `AUTH_SECRET.length >= 32` → enabled；`< 32` 抛 `AuthError("AUTH_SECRET too short", 500)`（启动层 `exit(1)`，不是请求 500）。`issuer` 存 `normalizeIssuer(OIDC_ISSUER)`。`emptyAuthMe()` 放 `types.ts` 或 `config.ts` 并再导出。

`normalizeIssuer`：`new URL`，去掉 pathname 末尾 `/.well-known/openid-configuration` 与多余 `/`，返回 `origin + pathname`（pathname 为 `/` 则只用 origin）。

`paths.ts`：上表五条精确匹配。

`index.ts`：再导出 types/config/paths。

`packages/core/src/index.ts` 增加 `export * from "./auth"`。

`package.json` exports 增加 `"./auth": "./src/auth/index.ts"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/core && bun test src/auth/config.test.ts src/auth/paths.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth packages/core/src/index.ts packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(auth): parse OIDC env and public API allowlist

EOF
)"
```

---

### Task 2: HMAC 会话 Cookie

**Files:**
- Create: `packages/core/src/auth/session.ts`
- Create: `packages/core/src/auth/session.test.ts`
- Modify: `packages/core/src/auth/index.ts`

**Interfaces:**
- Consumes: `COOKIE_*`、`SESSION_MAX_AGE_S`、`OAUTH_COOKIE_MAX_AGE_S`、`AuthMe`
- Produces:
  - `type SessionPayload = { sub: string; email: string \| null; name: string \| null; iat: number; exp: number }`
  - `signSession(payload: Omit<SessionPayload, "iat" \| "exp">, secret: string, nowMs?: number): string`
  - `verifySession(token: string, secret: string, nowMs?: number): SessionPayload \| null`
  - `sessionToAuthMe(p: SessionPayload): AuthMe` → `enabled: true`
  - `parseCookieHeader(header: string \| null): Record<string, string>`
  - `serializeCookie(name: string, value: string, opts: { maxAge: number; secure: boolean; httpOnly?: boolean }): string`
  - `clearCookie(name: string, opts: { secure: boolean; httpOnly?: boolean }): string`（Max-Age=0；默认 `httpOnly: true`，与 `serializeCookie` 一致）
  - `isSecureRequest(req: { url: string; headers: Headers }): boolean`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import {
  signSession,
  verifySession,
  parseCookieHeader,
  serializeCookie,
  isSecureRequest,
} from "./session"

const secret = "k".repeat(32)

describe("session", () => {
  test("roundtrip", () => {
    const t = signSession(
      { sub: "u1", email: "a@b.c", name: "Ada" },
      secret,
      1_000_000
    )
    const p = verifySession(t, secret, 1_000_000)
    expect(p?.sub).toBe("u1")
    expect(p?.email).toBe("a@b.c")
  })

  test("tamper / wrong secret / expired fail", () => {
    const t = signSession(
      { sub: "u1", email: null, name: null },
      secret,
      1_000_000
    )
    expect(verifySession(t + "x", secret, 1_000_000)).toBeNull()
    expect(verifySession(t, "o".repeat(32), 1_000_000)).toBeNull()
    expect(verifySession(t, secret, 1_000_000 + 604_801_000)).toBeNull()
  })
})

describe("cookies", () => {
  test("parse and serialize", () => {
    const set = serializeCookie("purifier_session", "abc", {
      maxAge: 60,
      secure: true,
      httpOnly: true,
    })
    expect(set).toContain("HttpOnly")
    expect(set).toContain("Secure")
    expect(set).toContain("SameSite=Lax")
    expect(parseCookieHeader("a=1; purifier_session=abc")).toEqual({
      a: "1",
      purifier_session: "abc",
    })
  })

  test("isSecureRequest proto header", () => {
    expect(
      isSecureRequest({
        url: "http://inner/api",
        headers: new Headers({ "x-forwarded-proto": "https" }),
      })
    ).toBe(true)
    expect(
      isSecureRequest({
        url: "http://localhost/api",
        headers: new Headers(),
      })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/auth/session.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现**

`signSession`：`iat = floor(nowMs/1000)`，`exp = iat + SESSION_MAX_AGE_S`。payload JSON → base64url，`createHmac("sha256", secret).update(body).digest()` → base64url，token = `body + "." + sig`。`verifySession`：拆两段，`timingSafeEqual` 比对 HMAC（长度不同直接 null），JSON 解析失败 null，`nowSec >= exp` null。

`parseCookieHeader`：按 `;` 拆，`trim`，第一个 `=` 分割 decodeURIComponent。

`serializeCookie`：`Path=/; SameSite=Lax; Max-Age=`；`httpOnly !== false` 时 `HttpOnly`；`secure` 时 `Secure`。值用 `encodeURIComponent`。

`isSecureRequest`：`x-forwarded-proto` 逗号第一段 trim 为 `https`，或 `new URL(req.url).protocol === "https:"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/core && bun test src/auth/session.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth
git commit -m "$(cat <<'EOF'
feat(auth): HMAC session cookie helpers

EOF
)"
```

---

### Task 3: callback URL 与 query `iss`

**Files:**
- Create: `packages/core/src/auth/redirect.ts`
- Create: `packages/core/src/auth/redirect.test.ts`
- Modify: `packages/core/src/auth/index.ts`

**Interfaces:**
- Consumes: `AuthError`、`normalizeIssuer`
- Produces:
  - `assertCallbackUrl(configured: string, incoming: string): URL`（返回解析后的 incoming）
  - `assertQueryIss(callbackUrl: URL, issuer: string): void`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { AuthError } from "./types"
import { assertCallbackUrl, assertQueryIss } from "./redirect"

const cfg = "https://purifier.example/login"

describe("assertCallbackUrl", () => {
  test("allows query", () => {
    const u = assertCallbackUrl(
      cfg,
      "https://purifier.example/login?code=a&state=b"
    )
    expect(u.searchParams.get("code")).toBe("a")
  })

  test("ignores hash", () => {
    assertCallbackUrl(cfg, "https://purifier.example/login?code=a#evil")
  })

  test("rejects host port path", () => {
    for (const bad of [
      "https://evil.example/login?code=a",
      "https://purifier.example:8443/login?code=a",
      "https://purifier.example/login/extra?code=a",
      "http://purifier.example/login?code=a",
    ]) {
      expect(() => assertCallbackUrl(cfg, bad)).toThrow(AuthError)
    }
  })
})

describe("assertQueryIss", () => {
  test("missing iss ok", () => {
    assertQueryIss(new URL("https://purifier.example/login?code=a"), "https://id.example.com")
  })

  test("matching iss ok", () => {
    assertQueryIss(
      new URL(
        "https://purifier.example/login?code=a&iss=" +
          encodeURIComponent("https://id.example.com")
      ),
      "https://id.example.com"
    )
  })

  test("mismatch throws", () => {
    expect(() =>
      assertQueryIss(
        new URL("https://purifier.example/login?iss=https://evil.example"),
        "https://id.example.com"
      )
    ).toThrow(AuthError)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/auth/redirect.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现**

两边 `new URL`。比较 `protocol`、`hostname`（小写）、`port`（空则按协议默认 80/443 再比）、`pathname`（去掉多余尾 `/`，根仍为 `/`）。**不要** `incoming.startsWith(configured)`。不符抛 `new AuthError("url mismatch", 400)`。非法 URL 同样 400 `url mismatch`。

`assertQueryIss`：无 `iss` 则 return；有则 `normalizeIssuer(iss) === normalizeIssuer(issuer)`，否则 `new AuthError("invalid iss", 400)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/core && bun test src/auth/redirect.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth
git commit -m "$(cat <<'EOF'
feat(auth): validate OIDC callback URL and iss

EOF
)"
```

---

### Task 4: `openid-client` + 缓存 Issuer

**Files:**
- Modify: `packages/core/package.json`（dependency `openid-client`，devDependency `jose`）
- Create: `packages/core/src/auth/oidc.ts`
- Create: `packages/core/src/auth/oidc.test.ts`
- Modify: `packages/core/src/auth/index.ts`

**Interfaces:**
- Consumes: enabled `AuthConfig`、`assertCallbackUrl`、`assertQueryIss`、`AuthMe`、`AuthError`
- Produces:
  - `class OidcService { constructor(cfg: Extract<AuthConfig, { enabled: true }>); authorizationUrl(): Promise<{ url: string; state: string; codeVerifier: string }>; exchange(callbackUrl: string, expectedState: string, codeVerifier: string): Promise<AuthMe> }`
  - 进程内缓存 discovery（同 issuer+clientId 只 discover 一次；JWKS 缺 key 时清缓存再 discover 一次）

- [ ] **Step 1: 安装依赖并写失败测试**

Bun 的 `bun add` **没有** `--filter`（那是 pnpm）。在 core 包目录安装：

```bash
cd packages/core && bun add openid-client && bun add -d jose
```

然后回到仓库根，确认 `bun.lock` 已更新。`jose` 默认放 **devDependencies**（测试里签 mock ID Token）。若 Step 3 判定 `openid-client` 在 Bun 不可用、改 `jose` + `fetch` 手写，把 `jose` **挪到 `dependencies`**（运行时需要），并在该 task 的 commit message 写明。

`oidc.test.ts` 用 `Bun.serve` 起 mock IdP：

1. `GET /.well-known/openid-configuration` 返回 `issuer`、`authorization_endpoint`、`token_endpoint`、`jwks_uri`、`id_token_signing_alg_values_supported: ["RS256"]`。
2. `GET /jwks` 返回 jose 生成的 JWKS。
3. `POST /token`：读 body，若 `code !== "good"` 返回 400 `{ error: "invalid_grant" }`；否则用同一 RSA 钥签 ID Token（claims：`iss`、`aud`=clientId、`sub`、`email`、`name`、`exp`）。

测试：

- `authorizationUrl()` 的 `url` 含 `client_id`、`code_challenge`、`state`、redirect_uri。
- `exchange` 成功得到 `sub`。
- 错 `state` → `AuthError` 400 `invalid state`（在调库前比较 `expectedState` 与 callback URL 的 `state` query）。
- `code=used` → 捕获库错误映射 `AuthError("invalid_grant", 400)`。
- 第二次 `authorizationUrl` **不再**打 discovery（计数器 === 1）。

`expectedState` 与 URL `state` 不等：`new AuthError("invalid state", 400)`。缺 verifier 由 API 层在调 `exchange` 前检查（本 task 的 `exchange` 假定 caller 传入非空）。

HTTP issuer 必须给 `openid-client` 传 `allowInsecureRequests`（仅当 issuer 为 `http:`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/core && bun test src/auth/oidc.test.ts`

Expected: FAIL（无 `OidcService`）

- [ ] **Step 3: 实现**

使用 `openid-client` v6：`discovery`、`buildAuthorizationUrl`、`randomState`、`randomPKCECodeVerifier`、`calculatePKCECodeChallenge`、`authorizationCodeGrant`、`allowInsecureRequests`、`ClientSecretPost`（或 discovery 第三参 `client_secret`）。

`authorizationUrl`：PKCE S256 始终带上；`scope: "openid email profile"`；`redirect_uri` 为配置值。

`exchange`：`assertCallbackUrl` → URL 必须有 `code` 否则 400 `invalid_grant` → `assertQueryIss` → 比对 state → `authorizationCodeGrant`。从 tokens 取 `id_token` claims 的 `sub`（必有，否则 401 `unauthorized`）、`email`、`name`。

库抛错：message / error 含 `invalid_grant` → 400 `invalid_grant`；验签/`iss`/`aud` → 401 `unauthorized`；网络 → 502 `oidc upstream`。

JWKS 缺 key：清缓存、discover 一次、重试 grant；仍失败按上表。

**实施第一小时：** 若 `import "openid-client"` 或 `discovery` 在 Bun 下抛错，按 spec 改 `jose` + `fetch` 手写（同一 `OidcService` 接口，测试不改），并把 `jose` 从 `devDependencies` 移到 `dependencies`。把结论写进该 task 的 commit message。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/core && bun test src/auth`

Expected: PASS（含 mock IdP）

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json bun.lock packages/core/src/auth
git commit -m "$(cat <<'EOF'
feat(auth): OIDC authorize and code exchange with cached discovery

EOF
)"
```

---

### Task 5: API 门锁与 `/api/auth/*`

**Files:**
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: Task 1–4 全部导出、`jsonOk` / `jsonError` / `NO_STORE_HEADERS` / `ExtractorError`
- Produces: 运行时行为（无新导出）

- [ ] **Step 1: 写失败测试（core 辅助 + 对照 API 行为清单）**

本 task 不在 `apps/api` 新建测试跑器。在 `packages/core/src/auth/paths.test.ts` 已覆盖公开名单。API 接线后用手工/一次性：

```bash
# 未配 OIDC（当前 dev）
curl -sS http://127.0.0.1:3001/api/health
# {"status":"ok","runtime":"bun"}

curl -sS http://127.0.0.1:3001/api/auth/config
# {"enabled":false,"buttonText":"使用 Pocket ID 登录"}

curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/posts?mtid=1
# 不是 401
```

先实现再 `bun run typecheck`。OIDC 开锁的 curl 在 Task 8 成功标准里用 Pocket ID；此处保证 **disabled 路径不 401**。

- [ ] **Step 2: `toErrorResponse` 识别 `AuthError`**

在现有 `ExtractorError` 分支旁：

```ts
if (err instanceof AuthError) {
  return jsonError(err.error, err.statusCode)
}
```

从 `@workspace/core` 导入 `AuthError`、`parseAuthConfig`、`OidcService`、cookie/session/path 辅助、`emptyAuthMe`、`COOKIE_*` 等。

- [ ] **Step 3: 启动时解析配置**

在 `Bun.serve` 之前（`store` 初始化之后即可）：

```ts
let authConfig: AuthConfig
try {
  authConfig = parseAuthConfig(process.env)
} catch (err) {
  console.error("[auth]", err instanceof Error ? err.message : err)
  process.exit(1)
}
if (!authConfig.enabled && authConfig.partial) {
  console.warn("[auth] incomplete OIDC env; auth disabled")
}
const oidc = authConfig.enabled ? new OidcService(authConfig) : null
```

- [ ] **Step 4: Cookie 读写与门锁**

```ts
function cookieOpts(req: Request) {
  return { secure: isSecureRequest(req) }
}

function sessionFrom(req: Request): SessionPayload | null {
  if (!authConfig.enabled) return null
  const cookies = parseCookieHeader(req.headers.get("cookie"))
  const raw = cookies[COOKIE_SESSION]
  if (!raw) return null
  return verifySession(raw, authConfig.secret)
}

function appendCookies(res: Response, parts: string[]): Response {
  for (const p of parts) res.headers.append("Set-Cookie", p)
  return res
}
```

在 `routeInner` 的 `try` 块**开始处**、**所有** API 路由分支（jobs / groups / bookmarks / `switch (pathname)`）之前：

```ts
if (pathname.startsWith("/api")) {
  const publicApi = isOidcPublicApi(req.method, pathname)
  if (authConfig.enabled && !publicApi) {
    const sess = sessionFrom(req)
    if (!sess) throw new AuthError("unauthorized", 401)
  }
}
```

然后加 auth 路由（建议在 `switch (pathname)` 里加 case，或 switch 前独立 `if`，与 jobs 一样）：

| 路径 | 实现要点 |
| --- | --- |
| `GET /api/auth/config` | `jsonOk({ enabled: authConfig.enabled, buttonText: authConfig.buttonText }, NO_STORE_HEADERS)` |
| `GET /api/auth/me` | 未开启：`jsonOk(emptyAuthMe(), NO_STORE)`。开启：门锁已保证有会话；`jsonOk(sessionToAuthMe(sess!), NO_STORE)`。注意：开启时 me **不是** public，无 Cookie 走门锁 401，不要返回 200 空用户。 |
| `POST /api/auth/authorize` | 未开启 `AuthError("oidc disabled", 400)`。`const { url, state, codeVerifier } = await oidc!.authorizationUrl()`。`jsonOk({ url }, NO_STORE)` + Set-Cookie state/verifier，`maxAge: OAUTH_COOKIE_MAX_AGE_S`，`httpOnly: true`。 |
| `POST /api/auth/callback` | 未开启 400。`const body = await req.json()`，`typeof body.url === "string"` 否则 400 `url mismatch`。Cookie 取 state 与 verifier，缺则 400 `invalid state`。`exchange(body.url, state, verifier)`。成功：清两颗 OAuth Cookie + 设 `purifier_session`（`signSession({ sub, email, name }, secret)`），body `{ ok: true, user }`。 |
| `POST /api/auth/logout` | 清 `COOKIE_SESSION`（及 OAuth cookie 以防万一），`{ ok: true }`，未登录也 200。 |

`GET /login` 不是 `/api`，现有 `serveSpa` 无文件则 `index.html`。不要把 SPA 纳入门锁。

- [ ] **Step 5: typecheck**

Run: `bun run typecheck`

Expected: PASS

Run: `cd packages/core && bun test src/auth`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): OIDC session gate and auth routes

EOF
)"
```

---

### Task 6: 登录页与 AuthProvider

**Files:**
- Modify: `apps/web/src/lib/routes.ts`
- Create: `apps/web/src/lib/auth.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/config`、`me`、`authorize`、`callback`、`logout`
- Produces:
  - `routes.login = "/login"`
  - `api.authConfig` `/api/auth/config`；`api.authMe`；`api.authAuthorize`；`api.authCallback`；`api.authLogout`
  - `useAuth(): { ready: boolean; enabled: boolean; user: AuthMe \| null; login: () => Promise<void>; logout: () => Promise<void>; completeCallback: (url: string) => Promise<{ ok: true } \| { error: string }> }`
  - `AuthGate`：未 ready 显示 `Spinner`；`enabled && !user && pathname !== "/login"` → `<Navigate to={/login?from=} replace />`；`!enabled && pathname === "/login"` → `<Navigate to="/" replace />`

`AuthMe` 形状与 core 相同；前端可内联 type，不必从 core 包前端（web 未依赖 `@workspace/core` 的 auth 也可复制 4 字段）。

- [ ] **Step 1: `routes.ts`**

`routes` 增加 `login: "/login"`。`api` 增加四个 auth 路径。不要加入 `NAV_ITEMS`。

- [ ] **Step 2: `auth.tsx`**

`AuthProvider`：mount 时 `fetch(api.authConfig)`。`enabled` 则 `fetch(api.authMe)`：200 设 user；401 设 user=null。

`safeFrom(raw: string | null): string`：必须 `raw.startsWith("/")` 且非 `//` 且不含 `://`，否则 `"/"`。

`login`：`POST authorize` credentials include（默认同源即可），`window.location.assign(data.url)`。

`completeCallback(url)`：`POST callback` JSON `{ url }`；非 ok 则 `const { error } = await res.json()` 返回 `{ error }`（缺省 `"unauthorized"`）。ok 则再 GET me 或用 body.user。

`logout`：`POST logout`，`user=null`，`navigate("/login")`。

`installFetchGuard`：见 Task 7，本 task 可先空实现或一并做完。若拆开，本 task 的 Provider 先不包 fetch。

- [ ] **Step 3: `LoginPage.tsx`**

全屏居中（**不要** `PageShell`，避免未登录顶栏进业务导航）：logo、`buttonText` 按钮。

- `useSearchParams` 有 `code`：`useEffect` 调一次 `completeCallback(window.location.href)`（ref 防 StrictMode 双调用：第一次之后 `didCallback.current = true`）。成功：`navigate(safeFrom(from) || "/", { replace: true })` 且 replace 掉 `code` query。`error === "invalid_grant"`：文案「登录链接已过期，请重新登录」，按钮再 `login()`。其它 error 展示 `ErrorBox`。
- 无 `code`：主按钮 `login()`。
- `enabled && user`：`<Navigate to="/" replace />`。

- [ ] **Step 4: 挂路由**

`App.tsx`：`const LoginPage = lazy(...)`。`<Route path="/login" ...>` 放在 `path="*"` **之前**。

`main.tsx`：`BrowserRouter` 内、`App` 外层包 `AuthProvider`，`App` 外包 `AuthGate`（`AuthGate` 用 `useLocation`，必须在 Router 内）。

结构：

```tsx
<BrowserRouter>
  <AuthProvider>
    <ConfirmProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </ConfirmProvider>
  </AuthProvider>
</BrowserRouter>
```

`AuthGate` 在 `enabled && !user && path !== "/login"` 时不要渲染 `App` 的业务页。

- [ ] **Step 5: typecheck**

Run: `bun run typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): OIDC login page and auth gate

EOF
)"
```

---

### Task 7: fetch 401 与顶栏退出

**Files:**
- Modify: `apps/web/src/lib/auth.tsx`
- Modify: `apps/web/src/components/site-header.tsx`

**Interfaces:**
- Consumes: `useAuth`、`api.authConfig`
- Produces: 全局 fetch 包装（排除 `keepalive`）；顶栏用户名 + 退出

- [ ] **Step 1: fetch 包装**

在 `AuthProvider` 内 `useEffect`：

```ts
const orig = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const res = await orig(input, init)
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const isApi =
    url.startsWith("/api/") ||
    url.startsWith(`${window.location.origin}/api/`)
  if (
    res.status === 401 &&
    isApi &&
    !init?.keepalive &&
    document.visibilityState === "visible"
  ) {
    if (!enabledRef.current) {
      const cfg = await orig(api.authConfig)
      if (cfg.ok) {
        const data = (await cfg.json()) as { enabled: boolean }
        enabledRef.current = data.enabled
        setEnabled(data.enabled)
      }
    }
    if (enabledRef.current) {
      setUser(null)
      const path = window.location.pathname
      if (path !== routes.login) {
        window.location.assign(
          `${routes.login}?from=${encodeURIComponent(path + window.location.search)}`
        )
      }
    }
  }
  return res
}
return () => {
  window.fetch = orig
}
```

`sendBeacon` 不经过 `fetch`，无需排除。`pagehide` 时 `visibilityState` 已是 `hidden`，不会 `assign`。

不要用 `navigate` 在卸载中的 keepalive 回调里跳转。

- [ ] **Step 2: 顶栏**

`SiteHeader` 调 `useAuth()`。`enabled && user`：在 `ModeToggle` 前显示短名（`user.name || user.email || user.sub?.slice(0, 8)`）和「退出」按钮（`type="button"`，`logout()`）。未开启不渲染。移动菜单行也可只放桌面 `ml-auto` 一处，避免重复。

- [ ] **Step 3: typecheck + core 测试**

Run: `bun run typecheck && bun run test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth.tsx apps/web/src/components/site-header.tsx
git commit -m "$(cat <<'EOF'
feat(web): session 401 redirect and logout control

EOF
)"
```

---

### Task 8: 文档

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:** 无代码导出。

- [ ] **Step 1: `AGENTS.md` API 表**（插在 health 附近）

| 路径 | 行为 |
| --- | --- |
| `GET /api/auth/config` | `{ enabled, buttonText }` |
| `GET /api/auth/me` | `AuthMe`；OIDC 开且未登录 401；关则 `enabled: false` 且 claim 为 null |
| `POST /api/auth/authorize` | `{ url }` + PKCE Cookie；未开 400 `oidc disabled` |
| `POST /api/auth/callback` | body `{ url }`；成功设会话 |
| `POST /api/auth/logout` | 清 Cookie `{ ok }` |

错误处理段追加：

- `AuthError` 使用其 `statusCode` 与 `error` 字符串。
- 400：`oidc disabled`、`url mismatch`、`invalid state`、`invalid iss`、`invalid_grant`。
- 401：`unauthorized`（会话或 ID Token）。
- 502：`oidc upstream`。

环境变量表追加 spec 中六行（含 `AUTH_SECRET` 轮换会使全部会话失效）。

部署/概述加一句：**OIDC 只锁谁能进实例，登录者共享同一 SQLite。**

常见改动路径加一行：鉴权在 `packages/core/src/auth/` 与 `apps/api` 的 `/api/auth*`。

- [ ] **Step 2: `README.md`**

环境变量表同样六行 + 共享数据警示 + Pocket ID：Client 回调只填 `OIDC_REDIRECT_URI`（开发 `http://localhost:3000/login`）。反代需传 `X-Forwarded-Proto`。

- [ ] **Step 3: 全量验证**

Run: `bun run test && bun run typecheck && bun run build`

Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "$(cat <<'EOF'
docs: document optional OIDC instance lock

EOF
)"
```

---

## Spec coverage

| Spec | Task |
| --- | --- |
| 未配置关闭 / 半配 warning / 短密钥 exit | 1, 5 |
| HMAC Cookie 7 天、Secure、Lax | 2, 5 |
| redirect 逐项比对、hash 忽略 | 3 |
| query `iss` | 3, 4 |
| discovery 缓存、JWKS 刷新 | 4 |
| Bun + openid-client / jose fallback | 4 |
| 公开名单、门锁、SPA `/login` fallback | 5 |
| `AuthMe` 统一形状、me 401 | 5, 6 |
| `invalid_grant` 文案、replace query | 6 |
| fetch 401 / keepalive / 重拉 config | 7 |
| 顶栏退出、非联邦登出 | 5, 7 |
| README/AGENTS 警示与错误码 | 8 |
| 不建用户表 | 全程无表 |

## 手工验收（实现者，不进 bun test）

1. 不配 OIDC：`bun run dev` 与现在一样能刷首页。
2. 配 Pocket ID 五件套 + `AUTH_SECRET`：未登录进 `/login`；Passkey 后能读帖、收藏。
3. 退出后再进需点按钮；IdP 仍登录则很快。
4. 刷新已回调过的 `/login?code=` 看到过期提示。
5. `curl /api/health` 无 Cookie → 200。
