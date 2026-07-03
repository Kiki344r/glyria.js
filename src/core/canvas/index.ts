// src/core/canvas/index.ts
// Built-in dynamic visuals: pure-TS SVG generation, optional PNG rasterization
// through @resvg/resvg-js or sharp when either is installed.

// ===== HELPERS =====

export const xmlEscape = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const FONT = "system-ui, 'Segoe UI', Roboto, sans-serif"

// ===== RASTERIZER (optional) =====

type Rasterizer = (svg: string) => Promise<Buffer>

let cachedRasterizer: Rasterizer | null | undefined

const findRasterizer = async (): Promise<Rasterizer | null> => {
  if (cachedRasterizer !== undefined) return cachedRasterizer

  // dynamic specifiers so TypeScript doesn't require these optional packages
  const resvgSpecifier = "@resvg/resvg-js"
  try {
    const mod = (await import(resvgSpecifier)) as unknown as {
      Resvg?: new (svg: string) => { render(): { asPng(): Buffer } }
    }
    if (mod.Resvg) {
      const Resvg = mod.Resvg
      cachedRasterizer = async (svg) => new Resvg(svg).render().asPng()
      return cachedRasterizer
    }
  } catch {
    // not installed — try the next one
  }

  const sharpSpecifier = "sharp"
  try {
    const mod = (await import(sharpSpecifier)) as unknown as {
      default?: (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
    }
    if (typeof mod.default === "function") {
      const sharp = mod.default
      cachedRasterizer = async (svg) => sharp(Buffer.from(svg)).png().toBuffer()
      return cachedRasterizer
    }
  } catch {
    // not installed either
  }

  cachedRasterizer = null
  return null
}

// ===== IMAGE HANDLE =====

export class GlyriaCanvasImage {
  constructor(
    private svgSource: string,
    private baseName: string,
  ) {}

  svg(): string {
    return this.svgSource
  }

  toBuffer(): Buffer {
    return Buffer.from(this.svgSource, "utf8")
  }

  /** PNG buffer — requires @resvg/resvg-js (recommended) or sharp. */
  async png(): Promise<Buffer> {
    const rasterizer = await findRasterizer()
    if (!rasterizer) {
      throw new Error(
        "g.canvas: PNG output needs a rasterizer — npm install @resvg/resvg-js (recommended) or sharp",
      )
    }
    return rasterizer(this.svgSource)
  }

  /**
   * { data, name } ready for `.file(data, name)` — PNG when a rasterizer is
   * installed, SVG otherwise (the .svg name makes the fallback visible:
   * Discord won't preview SVG attachments).
   */
  async attachment(): Promise<{ data: Buffer; name: string }> {
    const rasterizer = await findRasterizer()
    if (rasterizer) {
      return { data: await rasterizer(this.svgSource), name: `${this.baseName}.png` }
    }
    return { data: this.toBuffer(), name: `${this.baseName}.svg` }
  }
}

// ===== RANK CARD =====

export interface RankCardOptions {
  username: string
  level: number
  xp: number
  xpNeeded: number
  rank: number
  avatarUrl?: string
  accentColor?: string
  backgroundColor?: string
}

const rankCard = (opts: RankCardOptions): GlyriaCanvasImage => {
  const accent = opts.accentColor ?? "#5865F2"
  const background = opts.backgroundColor ?? "#2b2d31"
  const username = xmlEscape(truncate(opts.username, 20))

  const ratio = opts.xpNeeded > 0 ? Math.min(1, Math.max(0, opts.xp / opts.xpNeeded)) : 0
  const trackX = 260
  const trackWidth = 620
  const fillWidth = Math.round(trackWidth * ratio)

  const avatar = opts.avatarUrl
    ? `<clipPath id="avatarClip"><circle cx="141" cy="141" r="80"/></clipPath>
       <image href="${xmlEscape(opts.avatarUrl)}" x="61" y="61" width="160" height="160" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>
       <circle cx="141" cy="141" r="80" fill="none" stroke="${accent}" stroke-width="4"/>`
    : `<circle cx="141" cy="141" r="80" fill="${accent}"/>
       <text x="141" y="170" text-anchor="middle" font-family="${FONT}" font-size="72" font-weight="700" fill="#ffffff">${xmlEscape(opts.username.charAt(0).toUpperCase())}</text>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="934" height="282" viewBox="0 0 934 282">
  <rect width="934" height="282" rx="24" fill="${background}"/>
  ${avatar}
  <text x="${trackX}" y="120" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${username}</text>
  <text x="874" y="80" text-anchor="end" font-family="${FONT}" font-size="28" font-weight="700" fill="${accent}">Rank #${opts.rank}</text>
  <text x="874" y="120" text-anchor="end" font-family="${FONT}" font-size="28" font-weight="600" fill="#b5bac1">Level ${opts.level}</text>
  <rect x="${trackX}" y="170" width="${trackWidth}" height="36" rx="18" fill="#1e1f22"/>
  <rect x="${trackX}" y="170" width="${fillWidth}" height="36" rx="18" fill="${accent}"/>
  <text x="874" y="240" text-anchor="end" font-family="${FONT}" font-size="20" fill="#b5bac1">${opts.xp} / ${opts.xpNeeded} XP</text>
</svg>`

  return new GlyriaCanvasImage(svg, "rank-card")
}

// ===== LEADERBOARD =====

export interface LeaderboardEntry {
  rank: number
  username: string
  value: string
}

export interface LeaderboardOptions {
  title: string
  entries: LeaderboardEntry[]
  accentColor?: string
  backgroundColor?: string
}

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const leaderboard = (opts: LeaderboardOptions): GlyriaCanvasImage => {
  const accent = opts.accentColor ?? "#5865F2"
  const background = opts.backgroundColor ?? "#2b2d31"
  const entries = opts.entries.slice(0, 10)

  const headerHeight = 90
  const rowHeight = 56
  const height = headerHeight + entries.length * rowHeight + 24

  const rows = entries
    .map((entry, i) => {
      const y = headerHeight + i * rowHeight
      const zebra =
        i % 2 === 0 ? `<rect x="16" y="${y}" width="668" height="${rowHeight}" rx="10" fill="#26272b"/>` : ""
      const medal = MEDALS[entry.rank] ?? `#${entry.rank}`
      return `${zebra}
  <text x="44" y="${y + 36}" font-family="${FONT}" font-size="24" fill="#ffffff">${xmlEscape(medal)}</text>
  <text x="110" y="${y + 36}" font-family="${FONT}" font-size="24" font-weight="600" fill="#ffffff">${xmlEscape(truncate(entry.username, 24))}</text>
  <text x="660" y="${y + 36}" text-anchor="end" font-family="${FONT}" font-size="24" font-weight="700" fill="${accent}">${xmlEscape(entry.value)}</text>`
    })
    .join("\n")

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="${height}" viewBox="0 0 700 ${height}">
  <rect width="700" height="${height}" rx="20" fill="${background}"/>
  <text x="32" y="52" font-family="${FONT}" font-size="32" font-weight="700" fill="#ffffff">${xmlEscape(opts.title)}</text>
  <rect x="32" y="66" width="120" height="5" rx="2.5" fill="${accent}"/>
${rows}
</svg>`

  return new GlyriaCanvasImage(svg, "leaderboard")
}

// ===== PUBLIC API =====

export const canvas = {
  rankCard,
  leaderboard,
}

export type GlyriaCanvas = typeof canvas
