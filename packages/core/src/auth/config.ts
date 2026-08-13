import { AuthError, type AuthConfig } from "./types"

export const DEFAULT_BUTTON_TEXT = "使用 Pocket ID 登录"
export const AUTH_SECRET_MIN = 32

export function parseAuthConfig(
  env: Record<string, string | undefined>
): AuthConfig {
  const read = (key: string): string | undefined => {
    const value = env[key]
    return value === undefined ? undefined : value.trim() || undefined
  }

  const issuer = read("OIDC_ISSUER")
  const clientId = read("OIDC_CLIENT_ID")
  const clientSecret = read("OIDC_CLIENT_SECRET")
  const redirectUri = read("OIDC_REDIRECT_URI")
  const secret = read("AUTH_SECRET")
  const buttonText = read("OIDC_BUTTON_TEXT") ?? DEFAULT_BUTTON_TEXT

  const present = [issuer, clientId, clientSecret, redirectUri, secret].filter(
    (v): v is string => v !== undefined
  )
  if (present.length === 0) {
    return { enabled: false, partial: false, buttonText }
  }
  if (present.length < 5) {
    return { enabled: false, partial: true, buttonText }
  }

  const [oIssuer, oClientId, oClientSecret, oRedirectUri, oSecret] = present
  if (oSecret.length < AUTH_SECRET_MIN) {
    throw new AuthError("AUTH_SECRET too short", 500)
  }

  return {
    enabled: true,
    issuer: normalizeIssuer(oIssuer),
    clientId: oClientId,
    clientSecret: oClientSecret,
    redirectUri: oRedirectUri,
    secret: oSecret,
    buttonText,
    partial: false,
  }
}

export function normalizeIssuer(raw: string): string {
  const url = new URL(raw)
  const trimmed = url.pathname.replace(/\/+$/, "")
  const pathname = trimmed.endsWith("/.well-known/openid-configuration")
    ? trimmed.slice(0, -"/.well-known/openid-configuration".length)
    : trimmed
  return pathname === "" ? url.origin : url.origin + pathname
}
