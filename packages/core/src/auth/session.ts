import { createHmac, timingSafeEqual } from "node:crypto"
import { SESSION_MAX_AGE_S, type AuthMe } from "./types"

export type SessionPayload = {
  sub: string
  email: string | null
  name: string | null
  iat: number
  exp: number
}

function hmacDigest(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest()
}

export function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: string,
  nowMs?: number
): string {
  const now = nowMs ?? Date.now()
  const iat = Math.floor(now / 1000)
  const exp = iat + SESSION_MAX_AGE_S
  const full: SessionPayload = { ...payload, iat, exp }
  const body = Buffer.from(JSON.stringify(full)).toString("base64url")
  const sig = hmacDigest(body, secret).toString("base64url")
  return `${body}.${sig}`
}

export function verifySession(
  token: string,
  secret: string,
  nowMs?: number
): SessionPayload | null {
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (body === undefined || sig === undefined) return null
  const expected = hmacDigest(body, secret)
  const actual = Buffer.from(sig, "base64url")
  if (actual.length !== expected.length) return null
  if (!timingSafeEqual(actual, expected)) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SessionPayload
  } catch {
    return null
  }

  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000)
  if (nowSec >= payload.exp) return null
  return payload
}

export function sessionToAuthMe(p: SessionPayload): AuthMe {
  return { enabled: true, sub: p.sub, email: p.email, name: p.name }
}

export function parseCookieHeader(header: string | null): Record<string, string> {
  if (header === null) return {}
  const out: Record<string, string> = {}
  for (const pair of header.split(";")) {
    const trimmed = pair.trim()
    if (trimmed === "") continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const name = decodeURIComponent(trimmed.slice(0, eq).trim())
    const value = decodeURIComponent(trimmed.slice(eq + 1).trim())
    out[name] = value
  }
  return out
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; httpOnly?: boolean }
): string {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ]
  if (opts.httpOnly !== false) parts.push("HttpOnly")
  if (opts.secure) parts.push("Secure")
  return parts.join("; ")
}

export function clearCookie(
  name: string,
  opts: { secure: boolean; httpOnly?: boolean }
): string {
  return serializeCookie(name, "", {
    maxAge: 0,
    secure: opts.secure,
    httpOnly: opts.httpOnly !== false,
  })
}

export function isSecureRequest(req: {
  url: string
  headers: Headers
}): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim()
    if (first === "https") return true
  }
  return new URL(req.url).protocol === "https:"
}
