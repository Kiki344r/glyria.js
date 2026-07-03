import { describe, it, expect } from "vitest"
import { parseDuration, formatDuration } from "../src/utils/duration.js"

describe("parseDuration", () => {
  it("passes raw numbers through as milliseconds", () => {
    expect(parseDuration(1500)).toBe(1500)
    expect(parseDuration(0)).toBe(0)
  })

  it("parses unit strings", () => {
    expect(parseDuration("500ms")).toBe(500)
    expect(parseDuration("5s")).toBe(5_000)
    expect(parseDuration("2m")).toBe(120_000)
    expect(parseDuration("1h")).toBe(3_600_000)
    expect(parseDuration("1d")).toBe(86_400_000)
  })

  it("supports decimals, whitespace and uppercase units", () => {
    expect(parseDuration("1.5s")).toBe(1_500)
    expect(parseDuration(" 5 S ")).toBe(5_000)
  })

  it("defaults bare numbers in strings to milliseconds", () => {
    expect(parseDuration("250")).toBe(250)
  })

  it("throws on invalid input", () => {
    expect(() => parseDuration("abc")).toThrow()
    expect(() => parseDuration("5w")).toThrow()
    expect(() => parseDuration(-1)).toThrow()
    expect(() => parseDuration(NaN)).toThrow()
  })
})

describe("formatDuration", () => {
  it("rounds up to seconds", () => {
    expect(formatDuration(1)).toBe("1s")
    expect(formatDuration(1_001)).toBe("2s")
    expect(formatDuration(5_000)).toBe("5s")
  })

  it("formats minutes and hours", () => {
    expect(formatDuration(60_000)).toBe("1m")
    expect(formatDuration(90_000)).toBe("1m 30s")
    expect(formatDuration(3_600_000)).toBe("1h")
    expect(formatDuration(3_900_000)).toBe("1h 5m")
  })
})
