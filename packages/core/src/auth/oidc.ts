import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  enableNonRepudiationChecks,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from "openid-client"
import { assertCallbackUrl, assertQueryIss } from "./redirect"
import { AuthError, type AuthConfig, type AuthMe } from "./types"

export const OIDC_SCOPE = "openid email profile"

const JWT_CLAIM_COMPARISON_ERROR = "OAUTH_JWT_CLAIM_COMPARISON_FAILED"
const JWT_TIMESTAMP_CHECK_ERROR = "OAUTH_JWT_TIMESTAMP_CHECK_FAILED"
const KEY_SELECTION_ERROR = "OAUTH_KEY_SELECTION_FAILED"

// In-process discovery cache: the same issuer + clientId pair discovers only
// once per process.
const discoveryCache = new Map<string, Promise<Configuration>>()

function cacheKey(cfg: EnabledAuthConfig): string {
  return `${cfg.issuer}\u0000${cfg.clientId}`
}

function errorText(err: unknown): string {
  const parts: string[] = []
  if (err instanceof Error) {
    parts.push(err.message)
  }
  const anyErr = err as { code?: unknown; cause?: unknown }
  if (typeof anyErr.code === "string") {
    parts.push(anyErr.code)
  }
  if (anyErr.cause instanceof Error) {
    parts.push(anyErr.cause.message)
  } else if (anyErr.cause !== undefined) {
    parts.push(JSON.stringify(anyErr.cause))
  }
  return parts.join(" ").toLowerCase()
}

function mapGrantError(err: unknown): AuthError {
  const text = errorText(err)
  if (text.includes("invalid_grant")) {
    return new AuthError("invalid_grant", 400)
  }
  const code = (err as { code?: unknown }).code
  // 稳定错误码覆盖 JWT claim 值比对 / 时间戳校验；验签失败与必需 claim 缺失
  // 共用 OAUTH_INVALID_RESPONSE 码，只能靠消息文本区分，保留这两条文本匹配
  if (
    code === JWT_CLAIM_COMPARISON_ERROR ||
    code === JWT_TIMESTAMP_CHECK_ERROR ||
    text.includes("signature verification failed") ||
    text.includes("claim missing")
  ) {
    return new AuthError("unauthorized", 401)
  }
  // 其余（含 JWKS 刷新后仍失败的 KEY_SELECTION_ERROR）按规格映射 502
  return new AuthError("oidc upstream", 502)
}

function isKeySelectionError(err: unknown): boolean {
  return (err as { code?: unknown }).code === KEY_SELECTION_ERROR
}

type EnabledAuthConfig = Extract<AuthConfig, { enabled: true }>

export class OidcService {
  readonly #cfg: EnabledAuthConfig

  constructor(cfg: EnabledAuthConfig) {
    this.#cfg = cfg
  }

  async authorizationUrl(): Promise<{
    url: string
    state: string
    codeVerifier: string
  }> {
    const config = await this.#discover().catch((err: unknown) => {
      throw mapGrantError(err)
    })
    const state = randomState()
    const codeVerifier = randomPKCECodeVerifier()
    const url = buildAuthorizationUrl(config, {
      scope: OIDC_SCOPE,
      state,
      redirect_uri: this.#cfg.redirectUri,
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    })
    return { url: url.href, state, codeVerifier }
  }

  async exchange(
    callbackUrl: string,
    expectedState: string,
    codeVerifier: string
  ): Promise<AuthMe> {
    const url = assertCallbackUrl(this.#cfg.redirectUri, callbackUrl)
    if (url.searchParams.get("code") === null) {
      throw new AuthError("invalid_grant", 400)
    }
    assertQueryIss(url, this.#cfg.issuer)
    if (url.searchParams.get("state") !== expectedState) {
      throw new AuthError("invalid state", 400)
    }

    const config = await this.#discover().catch((err: unknown) => {
      throw mapGrantError(err)
    })
    try {
      return await this.#grant(config, url, expectedState, codeVerifier)
    } catch (err) {
      if (isKeySelectionError(err)) {
        // The JWKS did not contain the signing key: clear the discovery
        // cache, discover once more, and retry the grant once.
        discoveryCache.delete(cacheKey(this.#cfg))
        const fresh = await this.#discover().catch((err: unknown) => {
          throw mapGrantError(err)
        })
        try {
          return await this.#grant(fresh, url, expectedState, codeVerifier)
        } catch (retryErr) {
          throw mapGrantError(retryErr)
        }
      }
      throw mapGrantError(err)
    }
  }

  #discover(): Promise<Configuration> {
    const key = cacheKey(this.#cfg)
    let promise = discoveryCache.get(key)
    if (promise === undefined) {
      promise = this.#performDiscovery()
      discoveryCache.set(key, promise)
      promise.catch(() => {
        if (discoveryCache.get(key) === promise) {
          discoveryCache.delete(key)
        }
      })
    }
    return promise
  }

  #performDiscovery(): Promise<Configuration> {
    const execute: Array<(config: Configuration) => void> = [
      enableNonRepudiationChecks,
    ]
    if (new URL(this.#cfg.issuer).protocol === "http:") {
      execute.push(allowInsecureRequests)
    }
    return discovery(
      new URL(this.#cfg.issuer),
      this.#cfg.clientId,
      undefined,
      ClientSecretPost(this.#cfg.clientSecret),
      { execute }
    )
  }

  async #grant(
    config: Configuration,
    url: URL,
    expectedState: string,
    codeVerifier: string
  ): Promise<AuthMe> {
    const tokens = await authorizationCodeGrant(
      config,
      url,
      { expectedState, pkceCodeVerifier: codeVerifier, idTokenExpected: true },
      undefined,
      undefined
    )
    const claims = tokens.claims()
    if (claims === undefined || typeof claims.sub !== "string") {
      throw new AuthError("unauthorized", 401)
    }
    const email = typeof claims.email === "string" ? claims.email : null
    const name = typeof claims.name === "string" ? claims.name : null
    return { enabled: true, sub: claims.sub, email, name }
  }
}
