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
