import { describe, expect, test } from "bun:test"
import {
  AUTH_SECRET_MIN,
  DEFAULT_BUTTON_TEXT,
  parseAuthConfig,
  normalizeIssuer,
} from "./config"

const full = {
  OIDC_ISSUER: "https://id.example.com",
  OIDC_CLIENT_ID: "cid",
  OIDC_CLIENT_SECRET: "csecret",
  OIDC_REDIRECT_URI: "https://app.example/login",
  AUTH_SECRET: "s".repeat(AUTH_SECRET_MIN),
}

describe("parseAuthConfig", () => {
  test("all empty → disabled", () => {
    const c = parseAuthConfig({})
    expect(c.enabled).toBe(false)
    if (!c.enabled) {
      expect(c.partial).toBe(false)
      expect(c.buttonText).toBe(DEFAULT_BUTTON_TEXT)
    }
  })

  test("partial env → disabled partial", () => {
    const c = parseAuthConfig({ OIDC_ISSUER: "https://id.example.com" })
    expect(c.enabled).toBe(false)
    if (!c.enabled) expect(c.partial).toBe(true)
  })

  test("full set → enabled", () => {
    const c = parseAuthConfig(full)
    expect(c.enabled).toBe(true)
    if (c.enabled) {
      expect(c.issuer).toBe("https://id.example.com")
      expect(c.redirectUri).toBe("https://app.example/login")
    }
  })

  test("custom button text", () => {
    const c = parseAuthConfig({ ...full, OIDC_BUTTON_TEXT: "登录" })
    expect(c.buttonText).toBe("登录")
  })

  test("short AUTH_SECRET throws", () => {
    expect(() =>
      parseAuthConfig({ ...full, AUTH_SECRET: "short" })
    ).toThrow(/AUTH_SECRET/)
  })
})

describe("normalizeIssuer", () => {
  test("strips well-known and trailing slash", () => {
    expect(
      normalizeIssuer(
        "https://id.example.com/.well-known/openid-configuration/"
      )
    ).toBe("https://id.example.com")
  })
})
