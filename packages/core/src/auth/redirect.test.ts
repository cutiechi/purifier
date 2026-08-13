import { describe, expect, test } from "bun:test"
import { AuthError } from "./types"
import { assertCallbackUrl, assertQueryIss } from "./redirect"

const cfg = "https://purifier.example/login"

describe("assertCallbackUrl", () => {
  test("allows query", () => {
    const u = assertCallbackUrl(
      cfg,
      "https://purifier.example/login?code=a&state=b"
    )
    expect(u.searchParams.get("code")).toBe("a")
  })

  test("ignores hash", () => {
    assertCallbackUrl(cfg, "https://purifier.example/login?code=a#evil")
  })

  test("rejects host port path", () => {
    for (const bad of [
      "https://evil.example/login?code=a",
      "https://purifier.example:8443/login?code=a",
      "https://purifier.example/login/extra?code=a",
      "http://purifier.example/login?code=a",
    ]) {
      expect(() => assertCallbackUrl(cfg, bad)).toThrow(AuthError)
    }
  })
})

describe("assertQueryIss", () => {
  test("missing iss ok", () => {
    assertQueryIss(new URL("https://purifier.example/login?code=a"), "https://id.example.com")
  })

  test("matching iss ok", () => {
    assertQueryIss(
      new URL(
        "https://purifier.example/login?code=a&iss=" +
          encodeURIComponent("https://id.example.com")
      ),
      "https://id.example.com"
    )
  })

  test("mismatch throws", () => {
    expect(() =>
      assertQueryIss(
        new URL("https://purifier.example/login?iss=https://evil.example"),
        "https://id.example.com"
      )
    ).toThrow(AuthError)
  })
})
