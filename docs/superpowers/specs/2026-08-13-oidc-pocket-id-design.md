# OIDC / Pocket ID 实例门锁

日期：2026-08-13
状态：brainstorming 已通过；待写实施计划

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

## 方案选择

**API 做 OIDC 客户端 + 本站会话 Cookie**（对齐 Immich Web）：

- 库：`openid-client`（发现、PKCE、换码、验 ID Token）。
- 会话：HMAC 签名的 `purifier_session` Cookie，不落库、不存 IdP token。
- 配置：环境变量（无管理后台）。

否决：

1. oauth2-proxy / Traefik Forward Auth——本地 `bun run dev` 与单容器部署都变重，应用内无「OIDC 支持」。
2. SPA 持有 IdP JWT、`Authorization: Bearer`——XSS 面大，且与现有同源 `fetch` 习惯不合。

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
  packages/core auth：openid-client + HMAC 会话
```

生产：API 托管 SPA，同源 Cookie。开发：Vite `:3000` 代理 `/api` → `:3001`，浏览器仍视作同源 `:3000`，Cookie `Path=/` 即可。

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

## 会话与 Cookie

| Cookie | HttpOnly | 寿命 | 用途 |
| --- | --- | --- | --- |
| `purifier_oauth_state` | 是 | Max-Age=600 | OIDC `state` |
| `purifier_oauth_code_verifier` | 是 | Max-Age=600 | PKCE verifier |
| `purifier_session` | 是 | Max-Age=604800（7 天、不滑动） | HMAC 签名 `{ sub, email?, name?, iat, exp }` |

共同属性：`Path=/`、`SameSite=Lax`；HTTPS 时 `Secure`。

- 载荷含 IdP `sub`（及可选 `email` / `name`），仅供顶栏展示与排障，**不建用户行、不隔离数据**。
- 退出：`POST /api/auth/logout` 只清本站 Cookie，不调 IdP `end_session`。IdP 侧会话可能仍在，再次点登录会很快（Passkey / 已登录 SSO）。
- 不提供服务端吊销列表；丢 Cookie 或等 7 天过期。

PKCE：始终带 `S256`（Pocket ID 支持；不依赖 discovery 的 `supportsPKCE` 开关）。

Callback 的 `url` 必须与 `OIDC_REDIRECT_URI` 同 origin + path（query 可含 `code`/`state`/`iss`），否则 400，防止拿任意 URL 去换码。

## API

错误体仍为 `{ "error": "..." }`。Auth 相关响应一律 `NO_STORE_HEADERS`。

### 公开（OIDC 开启时也不要会话）

| 路径 | 行为 |
| --- | --- |
| `GET /api/health` | 现有 `{ status: "ok", runtime: "bun" }` |
| `GET /api/auth/config` | `{ enabled: boolean, buttonText: string }`。未开启时 `enabled: false`，`buttonText` 仍给默认值无妨 |
| `POST /api/auth/authorize` | 开启：发现 IdP、生成 state/PKCE、Set-Cookie、`{ url }`。未开启：400 `oidc disabled` |
| `POST /api/auth/callback` | body `{ url: string }`（浏览器地址栏回到登录页后的完整 URL）。成功：清 PKCE Cookie，设 `purifier_session`，`{ ok: true, user }`。未开启：400 |
| `POST /api/auth/logout` | 清会话 Cookie；未登录也 `{ ok: true }` |
| 非 `/api` 的 SPA 静态资源与 `index.html` | 必须匿名可拿，否则登录页无法加载 |

### 需登录（开启且无有效会话 → 401 `unauthorized`）

| 路径 | 行为 |
| --- | --- |
| `GET /api/auth/me` | `{ sub, email, name }`（缺的 claim 为 `null`） |
| 其余 `/api/*` | 现有逻辑，入口处先验 Cookie |

未开启时：不验 Cookie；`GET /api/auth/me` 返回 200 `{ enabled: false }`（避免前端误当 401 去登录页）。`authorize` / `callback` 仍 400。

### 错误映射

| 情况 | 状态 |
| --- | --- |
| 未开启却 authorize/callback | 400 |
| `url` 与 `OIDC_REDIRECT_URI` 不符、缺/错 `state`、缺 PKCE Cookie | 400 |
| 会话缺失、过期、HMAC 失败 | 401 |
| ID Token 验签失败、`iss`/`aud` 不符 | 401 |
| 发现文档或 token 端点失败、超时 | 502 |

门锁集中在 `apps/api` 的 `route()` 入口：开启且 path 不在公开名单 → 验 Cookie。不在各 `/api/me` 分支重复判断。

## 前端

- 路由 `/login` → `LoginPage`。不进顶栏 `NAV_ITEMS`。
- 启动拉一次 `GET /api/auth/config`，缓存 `enabled`。
- `enabled &&` 未登录：除 `/login` 外 `Navigate` 到 `/login`，query 记 `from`（仅站内相对路径，防开放重定向）；登完回 `from` 或 `/`。
- `LoginPage`：若 URL 已有 `code`（及 `state`），自动 `POST callback` 后跳转；否则展示 `buttonText` 按钮 → `POST authorize` → `window.location = url`。已登录访问 `/login` 则去首页。
- 业务 `fetch` 在 `enabled` 下收到 401：视为掉会话，去 `/login`。未开启时 401 不按登录处理（当前业务也不该产生 401）。
- 顶栏仅 `enabled` 时显示名称（`name` 或 `email` 或截断 `sub`）和退出。未开启无登录 UI。
- 登录页用现有 Tailwind / 居中卡片即可，不另做设计系统。

`sendBeacon` / `keepalive` 的 `POST /api/me/sessions` 同源会带 Cookie；未登录时服务端 401，前端本就静默丢弃该段。

## 代码落点

| 位置 | 职责 |
| --- | --- |
| `packages/core/src/auth/` | `openid-client` 封装；会话签发/校验；配置解析（读 env 的纯函数可测） |
| `packages/core` `package.json` | 依赖 `openid-client` |
| `apps/api/src/index.ts` | Cookie、公开名单、门锁、auth 路由 |
| `apps/web/src/pages/LoginPage.tsx` | 登录页 |
| `apps/web` 路由 / 守卫 / header / `routes.ts` | `/login`、`api.auth*` |
| `AGENTS.md`、`README.md` | 环境变量、API 表、Pocket ID 回调示例 |

测试仍走根目录 `bun run test`（`packages/core` 的 `bun test`）。API 门锁若不便在 core 测，用对 `route` 辅助函数的单测或最小 fetch 测；不引入 HTTP 框架。

## 测试

- 会话：签发成功；改 payload / 过期 / 错 `AUTH_SECRET` 失败。
- 配置：五件套齐 → enabled；缺一项 → disabled；`AUTH_SECRET` 过短且其余齐 → `parseAuthConfig` 抛错，API 启动时捕获并 `exit(1)`。
- OIDC（mock 发现与 token）：state 错、缺 verifier、redirect 不符 → 失败；成功得到 `sub`。
- 门锁：disabled 时内容 API 不因缺 Cookie 401；enabled 无 Cookie → 401；`/api/health` 与 `/api/auth/config` 始终 200。
- 不测真实 Pocket ID。

## 成功标准

1. 不配 OIDC：现有测试与手工浏览与现在一致。
2. 配上 Pocket ID：未登录进登录页；Passkey 后能读帖、写收藏。
3. 退出后须再点登录按钮（IdP 可能仍登录，第二次会很快）。
4. 无 Cookie 时 `GET /api/health` 仍 200。
