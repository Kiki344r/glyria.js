// src/cli/commands/start.ts
// Production start with a self-healing supervisor: crash-loop detection,
// exponential backoff, and automatic rollback to the last stable build.

import { spawn } from "child_process"
import type { ChildProcess } from "child_process"
import { cpSync, existsSync, rmSync } from "fs"
import { resolve } from "path"
import { pathToFileURL } from "url"
import { logger } from "../../core/logger.js"

const STABLE_AFTER_MS = 60_000
const CRASH_WINDOW_MS = 60_000
const CRASH_LOOP_THRESHOLD = 3

export const start = async (enableModuleSDK = false) => {
  const distFolder = enableModuleSDK ? "Bot/dist/src" : "dist/src"
  const entryPoint = `${distFolder}/index.js`

  if (!existsSync(entryPoint)) {
    console.error(`❌ No build found in ${distFolder}, start the build first.`)
    process.exit(1)
  }

  const distRoot = resolve(process.cwd(), enableModuleSDK ? "Bot/dist" : "dist")
  const lastGoodDir = resolve(process.cwd(), ".glyria/last-good")

  const bootstrapPath = pathToFileURL(
    resolve(process.cwd(), "node_modules/@glyria/bot/dist/runtime/bootstrap.js"),
  ).href

  let proc: ChildProcess
  let crashes: number[] = []
  let stableTimer: NodeJS.Timeout | null = null
  let rolledBack = false
  let shuttingDown = false

  const snapshotLastGood = () => {
    try {
      rmSync(lastGoodDir, { recursive: true, force: true })
      cpSync(distRoot, lastGoodDir, { recursive: true })
      logger.success("Self-Heal", "Build marked stable — snapshot saved to .glyria/last-good")
    } catch (error) {
      logger.warn("Self-Heal", "Could not snapshot the stable build")
      console.error(error)
    }
  }

  const rollback = (): boolean => {
    if (!existsSync(lastGoodDir)) {
      logger.error("Self-Heal", "No stable snapshot available — cannot roll back")
      return false
    }
    try {
      rmSync(distRoot, { recursive: true, force: true })
      cpSync(lastGoodDir, distRoot, { recursive: true })
      logger.warn("Self-Heal", "Rolled back to the last stable build")
      return true
    } catch (error) {
      logger.error("Self-Heal", "Rollback failed")
      console.error(error)
      return false
    }
  }

  const boot = () => {
    proc = spawn("node", ["--import", bootstrapPath], {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        GLYRIA_BOT_ROOT: enableModuleSDK ? "Bot" : ".",
      },
    })

    // a run that survives STABLE_AFTER_MS becomes the rollback target
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      crashes = []
      rolledBack = false
      snapshotLastGood()
    }, STABLE_AFTER_MS)

    proc.on("exit", (code, signal) => {
      if (stableTimer) clearTimeout(stableTimer)
      if (shuttingDown || signal === "SIGTERM" || code === 0) return

      console.error(`❌ Bot crashed with code ${code}`)

      const now = Date.now()
      crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]

      if (crashes.length >= CRASH_LOOP_THRESHOLD) {
        logger.error(
          "Self-Heal",
          `Crash loop detected (${crashes.length} crashes in ${CRASH_WINDOW_MS / 1000}s)`,
        )

        if (!rolledBack && rollback()) {
          rolledBack = true
          crashes = []
          logger.info("Self-Heal", "Restarting on the last stable build...")
          boot()
        } else {
          logger.error("Self-Heal", "Already on the stable build (or no snapshot) — giving up")
          process.exit(1)
        }
        return
      }

      const backoff = 1000 * 2 ** (crashes.length - 1)
      logger.warn("Self-Heal", `Restarting in ${backoff / 1000}s...`)
      setTimeout(boot, backoff)
    })

    proc.on("error", (error) => {
      logger.error("Self-Heal", "Failed to start bot process")
      console.error(error)
    })
  }

  const forward = (signal: NodeJS.Signals) => {
    shuttingDown = true
    proc?.kill(signal)
  }
  process.on("SIGINT", () => forward("SIGINT"))
  process.on("SIGTERM", () => forward("SIGTERM"))

  boot()
}
