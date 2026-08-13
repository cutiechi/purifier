import { normalizeIssuer } from "./config"
import { AuthError } from "./types"

function effectivePort(url: URL): string {
  const explicit = url.port
  if (explicit !== "") return explicit
  if (url.protocol === "https:") return "443"
  if (url.protocol === "http:") return "80"
  return ""
}

export function assertCallbackUrl(configured: string, incoming: string): URL {
  let configuredUrl: URL
  let incomingUrl: URL
  try {
    configuredUrl = new URL(configured)
    incomingUrl = new URL(incoming)
  } catch {
    throw new AuthError("url mismatch", 400)
  }

  const configuredPath = configuredUrl.pathname.replace(/\/+$/, "") || "/"
  const incomingPath = incomingUrl.pathname.replace(/\/+$/, "") || "/"

  const matches =
    configuredUrl.protocol === incomingUrl.protocol &&
    configuredUrl.hostname === incomingUrl.hostname &&
    effectivePort(configuredUrl) === effectivePort(incomingUrl) &&
    configuredPath === incomingPath

  if (!matches) {
    throw new AuthError("url mismatch", 400)
  }
  return incomingUrl
}

export function assertQueryIss(callbackUrl: URL, issuer: string): void {
  const iss = callbackUrl.searchParams.get("iss")
  if (iss === null) return
  let normalizedIss: string
  try {
    normalizedIss = normalizeIssuer(iss)
  } catch {
    throw new AuthError("invalid iss", 400)
  }
  if (normalizedIss !== normalizeIssuer(issuer)) {
    throw new AuthError("invalid iss", 400)
  }
}
