// src/utils/duration.ts

export type Duration = number | string

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * Parse a duration into milliseconds.
 * Accepts a raw number (ms) or a string like "500ms", "5s", "2m", "1h", "1d".
 */
export const parseDuration = (input: Duration): number => {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid duration: ${input}`)
    }
    return input
  }

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(input.trim())
  if (!match) {
    throw new Error(`Invalid duration: "${input}"`)
  }

  const value = Number(match[1])
  const unit = (match[2] ?? "ms").toLowerCase()

  return value * (UNIT_MS[unit] ?? 1)
}

/**
 * Format milliseconds into a compact human string ("3s", "1m 30s", "2h 5m").
 * Rounds up to the next second — meant for "try again in X" messages.
 */
export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))

  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60

  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`
}
