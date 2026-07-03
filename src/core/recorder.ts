// src/core/recorder.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { resolve } from "path"
import { useConfig } from "./config.js"
import { logger } from "./logger.js"

// ===== TYPES =====

export interface RecordedReply {
  via: string
  payload: unknown
  timestamp: number
}

export interface RecordedInteraction {
  id: string
  /** Resolved handler key, e.g. "config:theme:set". */
  key: string
  kind: "chat" | "user" | "message"
  userId: string
  username?: string
  guildId: string | null
  channelId: string | null
  /** Flat option values, keyed by option name. */
  options: Record<string, unknown>
  subcommand: string[]
  createdAt: number
  replies: RecordedReply[]
  error?: string
}

// ===== PATHS =====

const recordingsDir = () => resolve(process.cwd(), ".glyria/interactions")

// ===== ENABLED? =====

export const isRecordingEnabled = (): boolean => {
  if (process.env.GLYRIA_DEV === "true") return true
  return useConfig().recording === true
}

// ===== WRITE =====

export const recordInteraction = (entry: RecordedInteraction): void => {
  try {
    mkdirSync(recordingsDir(), { recursive: true })
    writeFileSync(
      resolve(recordingsDir(), `${entry.id}.json`),
      JSON.stringify(entry, null, 2),
    )
  } catch (error) {
    logger.warn("Recorder", `Could not record interaction ${entry.id}`)
    console.error(error)
  }
}

// ===== READ =====

export const readRecording = (id: string): RecordedInteraction | null => {
  const path = resolve(recordingsDir(), `${id}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RecordedInteraction
  } catch {
    return null
  }
}

export const listRecordings = (): RecordedInteraction[] => {
  const dir = recordingsDir()
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, f), "utf8")) as RecordedInteraction
      } catch {
        return null
      }
    })
    .filter((r): r is RecordedInteraction => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}
