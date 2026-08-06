import { describe, expect, test } from "bun:test"
import { DEFAULT_SITE, isValidSite, resolveSite } from "./sites"

describe("resolveSite", () => {
  test("default site is cool18", () => {
    const e = resolveSite()
    expect(e.name).toBe("cool18")
    expect(resolveSite(DEFAULT_SITE).name).toBe("cool18")
  })
  test("site 2 resolves to xbookcn", () => {
    expect(resolveSite("2").name).toBe("xbookcn")
  })
  test("unknown id throws 400", () => {
    expect(() => resolveSite("99")).toThrow(/unknown site/)
  })
})

describe("isValidSite", () => {
  test("undefined / known id is valid", () => {
    expect(isValidSite(undefined)).toBe(true)
    expect(isValidSite("1")).toBe(true)
  })
  test("unknown id is invalid", () => {
    expect(isValidSite("99")).toBe(false)
  })
})
