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

  const presentCount = [issuer, clientId, clientSecret, redirectUri, secret].filter(
    (v) => v !== undefined
  ).length

  if (
    issuer !== undefined &&
    clientId !== undefined &&
    clientSecret !== undefined &&
    redirectUri !== undefined &&
    secret !== undefined
  ) {
    if (secret.length < AUTH_SECRET_MIN) {
      throw new AuthError("AUTH_SECRET too short", 500)
    }
    return {
      enabled: true,
      issuer: normalizeIssuer(issuer),
      clientId,
      clientSecret,
      redirectUri,
      secret,
      buttonText,
      partial: false,
    }
  }

  return {
    enabled: false,
    partial: presentCount > 0,
    buttonText,
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
