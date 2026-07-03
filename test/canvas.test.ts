import { describe, it, expect } from "vitest"
import { canvas, xmlEscape, GlyriaCanvasImage } from "../src/core/canvas/index.js"

describe("xmlEscape", () => {
  it("escapes all five special characters", () => {
    expect(xmlEscape(`<a & "b" 'c'>`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;")
  })
})

describe("canvas.rankCard", () => {
  it("renders the username escaped and the stats", () => {
    const svg = canvas
      .rankCard({ username: "Zoé <script>", level: 12, xp: 50, xpNeeded: 100, rank: 3 })
      .svg()

    expect(svg).toContain("Zoé &lt;script&gt;")
    expect(svg).toContain("Rank #3")
    expect(svg).toContain("Level 12")
    expect(svg).toContain("50 / 100 XP")
  })

  it("sizes the progress bar by xp ratio", () => {
    const half = canvas
      .rankCard({ username: "u", level: 1, xp: 50, xpNeeded: 100, rank: 1 })
      .svg()
    // track is 620 wide → 50% = 310
    expect(half).toContain('width="310" height="36"')

    const over = canvas
      .rankCard({ username: "u", level: 1, xp: 200, xpNeeded: 100, rank: 1 })
      .svg()
    // clamped at 100%
    expect(over).toContain('width="620" height="36"')
  })

  it("truncates long usernames and falls back to an initial without avatar", () => {
    const svg = canvas
      .rankCard({ username: "a".repeat(40), level: 1, xp: 0, xpNeeded: 100, rank: 1 })
      .svg()

    expect(svg).toContain(`${"a".repeat(19)}…`)
    expect(svg).toContain(">A</text>") // initials circle
  })

  it("embeds the avatar image when provided", () => {
    const svg = canvas
      .rankCard({
        username: "u",
        level: 1,
        xp: 0,
        xpNeeded: 100,
        rank: 1,
        avatarUrl: "https://cdn.example/avatar.png",
      })
      .svg()

    expect(svg).toContain('href="https://cdn.example/avatar.png"')
    expect(svg).toContain("clipPath")
  })
})

describe("canvas.leaderboard", () => {
  it("renders medals for top 3 and plain ranks after", () => {
    const svg = canvas
      .leaderboard({
        title: "Top chatters",
        entries: [
          { rank: 1, username: "one", value: "100" },
          { rank: 2, username: "two", value: "90" },
          { rank: 3, username: "three", value: "80" },
          { rank: 4, username: "four", value: "70" },
        ],
      })
      .svg()

    expect(svg).toContain("Top chatters")
    expect(svg).toContain("🥇")
    expect(svg).toContain("🥈")
    expect(svg).toContain("🥉")
    expect(svg).toContain("#4")
    expect(svg).toContain("four")
  })

  it("caps rendering at 10 entries", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      rank: i + 1,
      username: `user-${i + 1}`,
      value: String(i),
    }))
    const svg = canvas.leaderboard({ title: "t", entries }).svg()

    expect(svg).toContain("user-10")
    expect(svg).not.toContain("user-11")
  })
})

describe("GlyriaCanvasImage", () => {
  it("roundtrips through toBuffer", () => {
    const image = new GlyriaCanvasImage("<svg/>", "x")
    expect(image.toBuffer().toString("utf8")).toBe("<svg/>")
  })

  it("png() rejects with an install hint when no rasterizer is present", async () => {
    // neither @resvg/resvg-js nor sharp is installed in this repo
    const image = canvas.rankCard({ username: "u", level: 1, xp: 0, xpNeeded: 1, rank: 1 })
    await expect(image.png()).rejects.toThrow(/@resvg\/resvg-js/)
  })

  it("attachment() falls back to an .svg attachment without a rasterizer", async () => {
    const attachment = await canvas
      .rankCard({ username: "u", level: 1, xp: 0, xpNeeded: 1, rank: 1 })
      .attachment()

    expect(attachment.name).toBe("rank-card.svg")
    expect(attachment.data.toString("utf8")).toContain("<svg")
  })
})
