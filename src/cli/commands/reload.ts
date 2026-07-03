// src/cli/commands/reload.ts

import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import { logger } from "../../core/logger.js"

/**
 * Zero-downtime reload: signals the running bot (pid from .glyria/bot.pid)
 * with SIGUSR2 so it hot-swaps commands/events/components/modules in memory
 * without dropping the gateway connection.
 */
export const reload = () => {
  if (process.platform === "win32") {
    logger.error("Reload", "SIGUSR2 reload is not supported on Windows")
    process.exit(1)
  }

  const pidPath = resolve(process.cwd(), ".glyria/bot.pid")
  if (!existsSync(pidPath)) {
    logger.error("Reload", "No .glyria/bot.pid found — is the bot running?")
    process.exit(1)
  }

  const pid = Number(readFileSync(pidPath, "utf8").trim())
  if (!Number.isInteger(pid) || pid <= 0) {
    logger.error("Reload", `Invalid pid in ${pidPath}`)
    process.exit(1)
  }

  try {
    process.kill(pid, "SIGUSR2")
    logger.success("Reload", `Sent SIGUSR2 to pid ${pid} — bot is hot-swapping without restart`)
  } catch {
    logger.error("Reload", `Could not signal pid ${pid} — is the bot still running?`)
    process.exit(1)
  }
}
