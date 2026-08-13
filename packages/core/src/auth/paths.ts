const OIDC_PUBLIC_ROUTES = [
  ["GET", "/api/health"],
  ["GET", "/api/auth/config"],
  ["POST", "/api/auth/authorize"],
  ["POST", "/api/auth/callback"],
  ["POST", "/api/auth/logout"],
] as const

export function isOidcPublicApi(method: string, pathname: string): boolean {
  return OIDC_PUBLIC_ROUTES.some(([m, p]) => m === method && p === pathname)
}
