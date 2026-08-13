import { afterEach, describe, expect, test } from "bun:test"
import type { Server } from "bun"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { OidcService } from "./oidc"
import { AuthError, type AuthConfig } from "./types"

const CLIENT_ID = "test-client"
const CLIENT_SECRET = "test-secret"
const REDIRECT_URI = "https://purifier.example/login"

type EnabledAuthConfig = Extract<AuthConfig, { enabled: true }>

type Idp = {
  server: Server<undefined>
  issuer: string
  config: EnabledAuthConfig
  discoveryCount(): number
}

const servers: Server<undefined>[] = []
const usedPorts = new Set<number>()
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
})

async function startIdp(options: {
  missingKeyOnce?: boolean
  missingKey?: boolean
  allowCodeReuse?: boolean
  wrongKey?: boolean
} = {}): Promise<Idp> {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const publicJwk = await exportJWK(publicKey)
  const signingKey =
    options.wrongKey === true
      ? (await generateKeyPair("RS256")).privateKey
      : privateKey
  const usedCodes = new Set<string>()
  let discoveryCount = 0
  let jwksFetches = 0
  let server: Server<undefined>
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/.well-known/openid-configuration") {
        discoveryCount++
        return Response.json({
          issuer: `http://127.0.0.1:${server.port}`,
          authorization_endpoint: `http://127.0.0.1:${server.port}/auth`,
          token_endpoint: `http://127.0.0.1:${server.port}/token`,
          jwks_uri: `http://127.0.0.1:${server.port}/jwks`,
          id_token_signing_alg_values_supported: ["RS256"],
        })
      }
      if (url.pathname === "/jwks") {
        jwksFetches++
        const key =
          options.missingKey === true ||
          (options.missingKeyOnce === true && jwksFetches === 1)
            ? undefined
            : { ...publicJwk, kid: "k1", alg: "RS256", use: "sig" }
        return Response.json({ keys: key === undefined ? [] : [key] })
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const body = new URLSearchParams(await req.text())
        const code = body.get("code")
        const clientId = body.get("client_id")
        const clientSecret = body.get("client_secret")
        const codeVerifier = body.get("code_verifier")
        // 忠实模拟机密客户端 IdP：client_secret_post 鉴权 + PKCE code_verifier
        if (
          code !== "good" ||
          clientId !== CLIENT_ID ||
          clientSecret !== CLIENT_SECRET ||
          !codeVerifier
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 })
        }
        if (usedCodes.has(code) && options.allowCodeReuse !== true) {
          return Response.json({ error: "invalid_grant" }, { status: 400 })
        }
        usedCodes.add(code)
        const idToken = await new SignJWT({
          iss: `http://127.0.0.1:${server.port}`,
          aud: CLIENT_ID,
          sub: "user-123",
          email: "alice@example.com",
          name: "Alice Example",
        })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(signingKey)
        return Response.json({
          access_token: "access-token",
          token_type: "Bearer",
          id_token: idToken,
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  if (server.port !== undefined && usedPorts.has(server.port)) {
    // A previously stopped server already used this ephemeral port; the
    // in-process discovery cache is keyed by issuer (host:port), so a reused
    // port would return a stale cached issuer. Rebind on a fresh port.
    servers.pop()
    server.stop(true)
    return startIdp(options)
  }
  if (server.port !== undefined) {
    usedPorts.add(server.port)
  }
  const issuer = `http://127.0.0.1:${server.port}`
  const config: EnabledAuthConfig = {
    enabled: true,
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    secret: "s".repeat(32),
    buttonText: "使用 Pocket ID 登录",
    partial: false,
  }
  return { server, issuer, config, discoveryCount: () => discoveryCount }
}

async function expectAuthError(
  promise: Promise<unknown>,
  error: string,
  statusCode: number
): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(AuthError)
  expect((caught as AuthError).error).toBe(error)
  expect((caught as AuthError).statusCode).toBe(statusCode)
}

async function s256Challenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  )
  return Buffer.from(digest).toString("base64url")
}

function callbackUrl(state: string, code = "good"): URL {
  const callback = new URL(REDIRECT_URI)
  callback.searchParams.set("state", state)
  callback.searchParams.set("code", code)
  return callback
}

describe("OidcService", () => {
  test("authorizationUrl builds an authorization request URL", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    const { url, state, codeVerifier } = await service.authorizationUrl()
    const authUrl = new URL(url)
    expect(authUrl.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(authUrl.searchParams.get("redirect_uri")).toBe(REDIRECT_URI)
    expect(authUrl.searchParams.get("state")).toBe(state)
    expect(authUrl.searchParams.get("scope")).toBe("openid email profile")
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authUrl.searchParams.get("code_challenge")).toBe(
      await s256Challenge(codeVerifier)
    )
  })

  test("exchange returns AuthMe from a valid callback", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    callback.searchParams.set("iss", idp.issuer)
    const me = await service.exchange(callback.href, state, codeVerifier)
    expect(me).toEqual({
      enabled: true,
      sub: "user-123",
      email: "alice@example.com",
      name: "Alice Example",
    })
  })

  test("exchange rejects a mismatched state", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    callback.searchParams.set("state", "attacker-state")
    await expectAuthError(
      service.exchange(callback.href, state, codeVerifier),
      "invalid state",
      400
    )
  })

  test("exchange rejects a callback without a code", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    callback.searchParams.delete("code")
    await expectAuthError(
      service.exchange(callback.href, state, codeVerifier),
      "invalid_grant",
      400
    )
  })

  test("exchange maps an invalid_grant token error to 400", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    const me = await service.exchange(callback.href, state, codeVerifier)
    expect(me.sub).toBe("user-123")
    await expectAuthError(
      service.exchange(callback.href, state, codeVerifier),
      "invalid_grant",
      400
    )
  })

  test("caches issuer discovery across authorizationUrl calls", async () => {
    const idp = await startIdp()
    const service = new OidcService(idp.config)
    await service.authorizationUrl()
    await service.authorizationUrl()
    expect(idp.discoveryCount()).toBe(1)
  })

  test("re-discovers once and retries when the JWKS lacks the signing key", async () => {
    const idp = await startIdp({ missingKeyOnce: true, allowCodeReuse: true })
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    const me = await service.exchange(callback.href, state, codeVerifier)
    expect(me.sub).toBe("user-123")
    expect(idp.discoveryCount()).toBe(2)
  })

  test("maps a JWKS that never contains the signing key to 502", async () => {
    const idp = await startIdp({ missingKey: true, allowCodeReuse: true })
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    callback.searchParams.set("iss", idp.issuer)
    await expectAuthError(
      service.exchange(callback.href, state, codeVerifier),
      "oidc upstream",
      502
    )
  })

  test("exchange maps an id_token signed by an unknown key to 401", async () => {
    const idp = await startIdp({ wrongKey: true, allowCodeReuse: true })
    const service = new OidcService(idp.config)
    const { state, codeVerifier } = await service.authorizationUrl()
    const callback = callbackUrl(state)
    await expectAuthError(
      service.exchange(callback.href, state, codeVerifier),
      "unauthorized",
      401
    )
  })
})
