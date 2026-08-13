# OIDC / Pocket ID 实例门锁

日期：2026-08-13
状态：brainstorming 已通过；已按 `review.md` 修订（C1–C4、I5–I13）；待写实施计划

## 背景

Purifier 是单用户自托管阅读端：一份 SQLite（历史、收藏、标签、归档、导出等），`/api/me/*` 与内容抓取接口均无鉴权。部署到公网或局域网后，能打到端口的人就能当 Cool18 代理用，也能读写个人数据。

需要可选的登录门：配了 OIDC 就必须登录才能用整站；不配则行为与现在完全相同。Pocket ID 是首选 IdP（Passkey、标准 OIDC），实现按通用 OIDC 客户端来，不绑 Pocket ID 专有 API。

## 目标

1. **实例门锁**：OIDC 开启后，未登录不能用 SPA 业务页，也不能调除公开名单外的 `/api/*`。
2. **仍是单库**：登录成功后共用现有 SQLite；不按 `sub` 隔离数据、不建用户表。
3. **Immich 同款浏览器流**：Authorization Code + PKCE；IdP 回调 SPA `/login`；服务端换码后发本站 HttpOnly 会话 Cookie。
4. **未配置即关闭**：缺任何一项必填环境变量则不门锁，开发体验不变。

## 非目标（YAGNI）

- 多用户 / 按 `sub` 分库、邮箱或 `sub` 白名单、role / group claim
- 联邦登出（`end_session`）、Auto Launch、滑动续期、Remember me
- 本站密码、多 IdP、管理 UI 改配置
- 手机 App、`app.immich://` 自定义 scheme、Immich 的 `/user-settings` 链接账号
- CSRF 双 Cookie（同源 + `SameSite=Lax` + OIDC `state`）
- 把 IdP access token 存进浏览器或转发给业务 API

放行谁：与 Immich 默认 Auto Register 同一层思路——**谁能用这个 OIDC Client 由 Pocket ID 决定**；Purifier 只验本次登录是否由配置的 Issuer 签发。

**运维警示（写入 README / AGENTS.md 部署段）**：OIDC 门锁只控制谁能进这台实例；实例内所有登录者**共享同一份 SQLite**（历史、收藏、标签、归档等）。不要当成多用户系统。

## 方案选择

**API 做 OIDC 客户端 + 本站会话 Cookie**（对齐 Immich Web）：

- 库：优先 `openid-client` v6（`discovery` / `buildAuthorizationUrl` 等，与 Immich 同代）。
- 会话：HMAC 签名的 `purifier_session` Cookie，不落库、不存 IdP token。
- 配置：环境变量（无管理后台）。

否决：

1. oauth2-proxy / Traefik Forward Auth——本地 `bun run dev` 与单容器部署都变重，应用内无「OIDC 支持」。
2. SPA 持有 IdP JWT、`Authorization: Bearer`——XSS 面大，且与现有同源 `fetch` 习惯不合。

**Bun 兼容（实施第一项）**：`openid-client` 官方只声明 Node。目标运行时是仓库 `packageManager` 的 Bun 1.3.14。实施开始时用最小脚本验证：`discovery` + 换码 + ID Token 验签。失败则改 **`jose` + 手写 discovery / token POST**，其余门锁与 Cookie 不变。`packages/core` 已是 `"type": "module"` + `module: ESNext`，可直接 ESM 导入。

## 架构

```
浏览器
  │  GET /api/auth/config     → { enabled, buttonText }
  │  未登录且 enabled         → 路由到 /login
  │  POST /api/auth/authorize → { url } + Cookie(state, code_verifier)
  │  跳转 Pocket ID
  │  回到 /login?code=&state=
  │  POST /api/auth/callback  { url } → Cookie(purifier_session)
  │  之后 fetch /api/* 自动带 Cookie
  ▼
Bun.serve（apps/api）
  公开名单放行 / 其余验会话
  packages/core auth：OIDC 客户端（缓存 Issuer）+ HMAC 会话
```

生产：API 托管 SPA，同源 Cookie。开发：Vite `:3000` 代理 `/api` → `:3001`，浏览器仍视作同源 `:3000`，Cookie `Path=/` 即可。

生产 `serveSpa`：磁盘上没有对应文件时回退 `index.html`（现有 `apps/api/src/index.ts`）。`/login` 无独立 HTML，走这条 fallback，实施时只确认不要把 `/login` 误判成需鉴权的 API。

## 配置

判定 **OIDC 开启**：以下全部非空。缺任一项视为关闭。若部分有值、部分空，启动时打 warning，仍按关闭处理，避免半配把站点锁死。

| 变量 | 必填（开启时） | 说明 |
| --- | --- | --- |
| `OIDC_ISSUER` | 是 | 发现 URL。可带或不带 `/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` | 是 | Pocket ID Client ID |
| `OIDC_CLIENT_SECRET` | 是 | Confidential client，token 端点用 `client_secret_post` |
| `OIDC_REDIRECT_URI` | 是 | 必须与 IdP 登记一致，指向 SPA 登录页。生产例：`https://purifier.example/login`；开发：`http://localhost:3000/login` |
| `AUTH_SECRET` | 是 | HMAC 会话密钥；开启时长度 **≥ 32**，否则**拒绝启动**（与「半配当关闭」不同：五件套齐了但密钥太弱不能跑） |
| `OIDC_BUTTON_TEXT` | 否 | 登录按钮文案，默认「使用 Pocket ID 登录」 |

Pocket ID：新建 OIDC Client，回调 URL **只填** `OIDC_REDIRECT_URI` 一条。用户/组授权在 Pocket ID 里绑到该 Client。

反向代理 HTTPS：Cookie `Secure` 依据请求是否 HTTPS（含 `X-Forwarded-Proto: https`）。文档注明需让反代传该头。

**轮换 `AUTH_SECRET`**：所有已签发的 `purifier_session` 立刻 HMAC 失败 → 401，用户必须重新登录。无服务端会话可迁移。写入配置说明，避免当成故障。

## Discovery 缓存

`authorize` 与 `callback` 都要 IdP 元数据（authorization / token / jwks）。**禁止每次请求都 `discovery()`。**

- 进程内缓存 `Configuration`（或等价 Issuer 客户端）：启动后首次需要时 discover，之后复用。
- 验 ID Token 时若 JWKS 缺 key（轮换），惰性再 discover 一次后重试验签；仍失败则 502/401（见错误映射）。
- 落点：`packages/core/src/auth/` 内独立模块（如 `issuer.ts`），不要把缓存散在 `index.ts`。

## 会话与 Cookie

| Cookie | HttpOnly | 寿命 | 用途 |
| --- | --- | --- | --- |
| `purifier_oauth_state` | 是 | Max-Age=600 | OIDC `state` |
| `purifier_oauth_code_verifier` | 是 | Max-Age=600 | PKCE verifier |
| `purifier_session` | 是 | Max-Age=604800（7 天、不滑动） | HMAC 签名 `{ sub, email?, name?, iat, exp }` |

共同属性：`Path=/`、`SameSite=Lax`；HTTPS 时 `Secure`。

- 载荷含 IdP `sub`（及可选 `email` / `name`），仅供顶栏展示与排障，**不建用户行、不隔离数据**。
- 退出：`POST /api/auth/logout` 只清本站 Cookie，不调 IdP `end_session`。IdP 侧会话可能仍在，再次点登录会很快（Passkey / 已登录 SSO）。
- 不提供服务端吊销列表；丢 Cookie、等 7 天过期，或轮换 `AUTH_SECRET`。

PKCE：始终带 `S256`（Pocket ID 支持；不依赖 discovery 的 `supportsPKCE` 开关）。

### Callback `url` 校验

用 `URL` 解析，**不要**字符串前缀匹配。下列字段必须与配置的 `OIDC_REDIRECT_URI` **逐项相等**：`protocol`、`hostname`、`port`（含默认端口规范化）、`pathname`。

- `search`：允许存在；实现时不白名单拦截未知 query（IdP 可能带 `session_state` 等），换码只使用标准 OIDC 参数。
- `hash`：忽略（不参与比对，也不送给 token 端点）。
- 不符 → 400 `url mismatch`。

### `iss`（mix-up）

OIDC Core 1.0 §3.1.2.5：Authorization Response 若带 `iss`，客户端**必须**验证其等于请求的 issuer。

- query/`url` 中若有 `iss`：规范化后与 `OIDC_ISSUER`（去 `/.well-known/...` 后的 issuer 标识）比较，不等则 400。
- 无论 query 有无 `iss`，换码后的 **ID Token `iss` / `aud` 仍须校验**（库默认应做；若手写 `jose` 路径必须自己验）。
- 实施时确认 `openid-client` v6 的 callback 是否已校验 query `iss`；库未做则在换码前手验。文档与代码注释写明这一条，避免只验 ID Token。

## API

错误体仍为 `{ "error": "..." }`。Auth 相关响应一律 `NO_STORE_HEADERS`。

`user` / `me` 的用户字段统一为：

```ts
type AuthMe = {
  enabled: boolean
  sub: string | null
  email: string | null
  name: string | null
}
```

缺的 claim 填 `null`，不省略字段。

### 公开（OIDC 开启时也不要会话）

| 路径 | 行为 |
| --- | --- |
| `GET /api/health` | 现有 `{ status: "ok", runtime: "bun" }` |
| `GET /api/auth/config` | `{ enabled: boolean, buttonText: string }`。未开启时 `enabled: false`，`buttonText` 仍为默认或配置值 |
| `POST /api/auth/authorize` | 开启：用缓存的 Issuer 生成 state/PKCE、Set-Cookie、`{ url }`。未开启：400 `oidc disabled` |
| `POST /api/auth/callback` | body `{ url: string }`（浏览器回到登录页后的完整 URL）。成功：清 PKCE Cookie，设 `purifier_session`，`{ ok: true, user: AuthMe }`（`enabled: true`）。未开启：400 |
| `POST /api/auth/logout` | 清会话 Cookie；未登录也 `{ ok: true }` |
| 非 `/api` 的 SPA 静态资源与 `index.html` | 匿名；`/login` 走现有 SPA fallback |

### 需登录（开启且无有效会话 → 401 `unauthorized`）

| 路径 | 行为 |
| --- | --- |
| `GET /api/auth/me` | 开启且已登录：200 `AuthMe`（`enabled: true`）。开启且未登录：**401** `{ error: "unauthorized" }`（与其它门锁 API 一致，不用 200 空用户）。未开启：200 `{ enabled: false, sub: null, email: null, name: null }` |
| 其余 `/api/*` | 现有逻辑，入口处先验 Cookie |

未开启时：不验 Cookie；`authorize` / `callback` 仍 400。

### 错误映射

实施时写入 `AGENTS.md` 错误处理段（与 `ExtractorError` / 504 / 502 / 500 并列）。当前不预留 403（无白名单）。

| 情况 | 状态 | `error`（稳定字符串，供前端分支） |
| --- | --- | --- |
| 未开启却 authorize/callback | 400 | `oidc disabled` |
| `url` 与 redirect 不符 | 400 | `url mismatch` |
| 缺/错 `state`、缺 PKCE Cookie、query `iss` 不符 | 400 | `invalid state` / `invalid iss` |
| 授权码二次使用、过期（IdP `invalid_grant`） | 400 | `invalid_grant` |
| 会话缺失、过期、HMAC 失败 | 401 | `unauthorized` |
| ID Token 验签失败、token 内 `iss`/`aud` 不符 | 401 | `unauthorized` |
| 发现文档或 token 端点失败、超时、JWKS 刷新后仍失败 | 502 | `oidc upstream` |

门锁集中在 `apps/api` 的 `route()` 入口：开启且 path 不在公开名单 → 验 Cookie。不在各 `/api/me` 分支重复判断。

## 前端

- 路由 `/login` → `LoginPage`。不进顶栏 `NAV_ITEMS`。
- 启动拉一次 `GET /api/auth/config`，缓存 `enabled`。
- `enabled &&` 未登录：除 `/login` 外 `Navigate` 到 `/login`，query 记 `from`（仅站内相对路径，防开放重定向）；登完回 `from` 或 `/`。
- `LoginPage`：若 URL 已有 `code`（及 `state`），自动 `POST callback` 一次。成功则 `history.replace` 去掉 query 再跳转，避免刷新重复用码。`error === "invalid_grant"`（或 400 且已带 `code`）→ 展示「登录链接已过期，请重新登录」，**不自动再 POST**，提供按钮重新 `authorize`。无 `code` 则展示 `buttonText` → `POST authorize` → `window.location = url`。已登录访问 `/login` 则去首页。
- 业务 `fetch` 与 401：
  - 仅在 `credentials` 同源、**非** `keepalive` 的请求上，把 401 当掉会话并导航 `/login`。
  - `sendBeacon` 无响应体，不导航（现有阅读会话本就静默丢段）。
  - `visibilityState === "hidden"` / `pagehide` 期间不 `navigate`。
  - 本地缓存认为 **未开启** 却收到业务 `/api/*` 的 401：先再拉 `GET /api/auth/config` 更新缓存；若此时 `enabled`，再去 `/login`。避免后端已开锁、旧标签页仍当公开站。
- 顶栏仅 `enabled` 时显示名称（`name` 或 `email` 或截断 `sub`）和退出。未开启无登录 UI。
- 登录页用现有 Tailwind / 居中卡片即可，不另做设计系统。

## 代码落点

| 位置 | 职责 |
| --- | --- |
| `packages/core/src/auth/` | OIDC 客户端（缓存 Issuer、PKCE、换码、`iss`）；会话签发/校验；`parseAuthConfig` |
| `packages/core` `package.json` | `openid-client`（或 fallback `jose`） |
| `apps/api/src/index.ts` | Cookie、公开名单、门锁、auth 路由；启动时 `parseAuthConfig` |
| `apps/web/src/pages/LoginPage.tsx` | 登录页、`invalid_grant` 提示 |
| `apps/web` 路由 / 守卫 / header / `routes.ts` | `/login`、`api.auth*`、401 拦截规则 |
| `AGENTS.md`、`README.md` | 环境变量、API 表、Pocket ID 回调、共享数据警示、`AUTH_SECRET` 轮换、auth 错误码 |

测试仍走根目录 `bun run test`（`packages/core` 的 `bun test`）。API 门锁若不便在 core 测，用对 `route` 辅助函数的单测或最小 fetch 测；不引入 HTTP 框架。

## 测试

- 会话：签发成功；改 payload / 过期 / 错 `AUTH_SECRET` 失败。
- 配置：五件套齐 → enabled；缺一项 → disabled；`AUTH_SECRET` 过短且其余齐 → `parseAuthConfig` 抛错，API 启动时捕获并 `exit(1)`。
- OIDC（mock 发现与 token）：state 错、缺 verifier、redirect 不符（含 port/pathname/hash 用例）、query `iss` 不符 → 失败；成功得到 `sub`；第二次用同一 `code` → `invalid_grant`。
- 门锁：disabled 时内容 API 不因缺 Cookie 401；enabled 无 Cookie → 401；`/api/health` 与 `/api/auth/config` 始终 200；`GET /api/auth/me` 三种形态（关 / 开未登录 401 / 开已登录）。
- 不测真实 Pocket ID。兼容性脚本（Bun + 真发现）是实施首日手工/一次性脚本，不进默认 `bun test`（无 IdP）。

## 成功标准

1. 不配 OIDC：现有测试与手工浏览与现在一致。
2. 配上 Pocket ID：未登录进登录页；Passkey 后能读帖、写收藏。
3. 退出后须再点登录按钮（IdP 可能仍登录，第二次会很快）。
4. 无 Cookie 时 `GET /api/health` 仍 200。
5. 刷新已用过的 `/login?code=` 看到过期提示，不循环请求。
