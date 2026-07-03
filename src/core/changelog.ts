// src/core/changelog.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, resolve } from "path"
import { useConfig } from "./config.js"
import { logger } from "./logger.js"
import { diffCommandBodies, isDiffEmpty } from "./commandDiff.js"
import type { NamedCommand } from "./commandDiff.js"
import { EmbedV2Builder } from "../builders/embedV2Builder.js"
import { hexToNumber } from "../utils/hexToNumber.js"

const snapshotPath = () => resolve(process.cwd(), ".glyria/commands.snapshot.json")

interface ChannelFetcher {
  channels: { fetch(id: string): Promise<unknown> }
}

/**
 * Compares the deployed command set against the previous deployment's
 * snapshot and posts a human-readable changelog to the configured channel.
 * Called once per boot, after commands are registered.
 */
export const postCommandChangelog = async (
  client: ChannelFetcher,
  commands: NamedCommand[],
): Promise<void> => {
  const config = useConfig()

  let previous: NamedCommand[] | null = null
  const path = snapshotPath()
  if (existsSync(path)) {
    try {
      previous = JSON.parse(readFileSync(path, "utf8")) as NamedCommand[]
    } catch {
      previous = null
    }
  }

  // always refresh the snapshot for the next deployment
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(commands, null, 2))
  } catch (error) {
    logger.warn("Changelog", "Could not write command snapshot")
    console.error(error)
  }

  const channelId = config.changelog?.channel
  if (!channelId || previous === null) return

  const diff = diffCommandBodies(previous, commands)
  if (isDiffEmpty(diff)) return

  const lines: string[] = []
  if (diff.added.length) lines.push(`**Added**\n${diff.added.map((n) => `➕ \`/${n}\``).join("\n")}`)
  if (diff.changed.length)
    lines.push(`**Updated**\n${diff.changed.map((n) => `♻️ \`/${n}\``).join("\n")}`)
  if (diff.removed.length)
    lines.push(`**Removed**\n${diff.removed.map((n) => `➖ \`/${n}\``).join("\n")}`)

  const embed = new EmbedV2Builder()
    .container({
      accentColor: hexToNumber(config.theme?.embedV2?.primaryColor ?? "#5865F2"),
    })
    .textDisplay("📦 **Deployment changelog**")
    .separator()
    .textDisplay(lines.join("\n\n"))
    .end()
    .build()

  try {
    const channel = (await client.channels.fetch(channelId)) as {
      send?(options: unknown): Promise<unknown>
    } | null
    await channel?.send?.(embed)
    logger.success("Changelog", "Deployment changelog posted")
  } catch (error) {
    logger.warn("Changelog", `Could not post changelog to ${channelId}`)
    console.error(error)
  }
}
