import { describe, expect, test } from "bun:test"
import { isOidcPublicApi } from "./paths"

describe("isOidcPublicApi", () => {
  test("allows health config authorize callback logout", () => {
    expect(isOidcPublicApi("GET", "/api/health")).toBe(true)
    expect(isOidcPublicApi("GET", "/api/auth/config")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/authorize")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/callback")).toBe(true)
    expect(isOidcPublicApi("POST", "/api/auth/logout")).toBe(true)
  })

  test("rejects me posts and wrong methods", () => {
    expect(isOidcPublicApi("GET", "/api/auth/me")).toBe(false)
    expect(isOidcPublicApi("GET", "/api/posts")).toBe(false)
    expect(isOidcPublicApi("GET", "/api/auth/authorize")).toBe(false)
    expect(isOidcPublicApi("POST", "/api/health")).toBe(false)
  })
})
