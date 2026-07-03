// src/cli/commands/replay.ts

import pc from "picocolors"
import { logger } from "../../core/logger.js"
import { readRecording, listRecordings } from "../../core/recorder.js"
import { createTestContext } from "../../sdk/testContext.js"

// ===== TEXT EXTRACTION =====

const extractText = (payload: unknown): string => {
  const texts: string[] = []
  const walk = (components: unknown[]) => {
    for (const c of components) {
      const comp = c as { type?: number; content?: string; components?: unknown[] }
      if (comp.type === 10 && comp.content) texts.push(comp.content)
      if (Array.isArray(comp.components)) walk(comp.components)
    }
  }
  const p = payload as { components?: unknown[]; content?: string }
  if (p?.content) texts.push(p.content)
  if (Array.isArray(p?.components)) walk(p.components)
  return texts.join("\n")
}

const ago = (timestamp: number): string => {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

// ===== LIST =====

const printList = () => {
  const recordings = listRecordings().slice(0, 20)

  if (!recordings.length) {
    logger.info("Replay", "No recordings in .glyria/interactions/ yet")
    logger.info("Replay", "Interactions are recorded automatically in dev (or `recording: true`)")
    return
  }

  console.log("")
  for (const r of recordings) {
    console.log(
      r.error ? pc.red("  ✖") : pc.green("  ✔"),
      pc.bold(pc.cyan(r.id)),
      pc.bold(`/${r.key.replaceAll(":", " ")}`),
      pc.gray(`by ${r.username ?? r.userId}`),
      pc.gray(ago(r.createdAt)),
    )
  }
  console.log("")
  logger.info("Replay", "glyria replay <id> to re-run one of these")
}

// ===== REPLAY =====

export const replay = async (args: string[]) => {
  logger.banner()

  const id = args.find((a) => !a.startsWith("--"))

  if (!id || args.includes("--list")) {
    printList()
    return
  }

  const recording = readRecording(id)
  if (!recording) {
    logger.error("Replay", `No recording found for id ${id}`)
    process.exit(1)
  }

  // ===== ORIGINAL RUN =====

  console.log("")
  console.log(pc.bold("  Original run"))
  console.log(pc.gray("  " + "─".repeat(40)))
  console.log("  command ", pc.bold(`/${recording.key.replaceAll(":", " ")}`))
  console.log("  user    ", `${recording.username ?? "?"} (${recording.userId})`)
  console.log("  guild   ", recording.guildId ?? pc.gray("DM"))
  console.log(
    "  when    ",
    `${new Date(recording.createdAt).toISOString()} (${ago(recording.createdAt)})`,
  )
  if (Object.keys(recording.options).length) {
    console.log("  options ", JSON.stringify(recording.options))
  }
  if (recording.error) console.log("  error   ", pc.red(recording.error))

  const originalTexts = recording.replies.map((r) => extractText(r.payload)).filter(Boolean)
  for (const text of originalTexts) {
    console.log(pc.gray("  ┃"), text.split("\n").join(`\n${pc.gray("  ┃ ")}`))
  }

  // ===== RE-RUN =====

  // the loader resolves .ts vs .js at import time — decide before importing it
  process.env.GLYRIA_DEV ??= "true"
  const { loadConfig } = await import("../../core/config.js")
  await loadConfig()
  const { loadCommands } = await import("../../core/loader.js")
  const commands = await loadCommands()

  const handler = commands.flatMap((c) => c.handlers).find((h) => h.name === recording.key)
  if (!handler) {
    logger.error("Replay", `Command "${recording.key}" no longer exists`)
    process.exit(1)
  }

  const ctx = createTestContext({
    userId: recording.userId,
    ...(recording.username && { username: recording.username }),
    guildId: recording.guildId,
    ...(recording.channelId && { channelId: recording.channelId }),
    options: recording.options,
    subcommand: recording.subcommand,
  })

  console.log("")
  console.log(pc.bold("  Replay"))
  console.log(pc.gray("  " + "─".repeat(40)))

  let replayError: unknown
  try {
    await handler.handler(ctx as never)
  } catch (error) {
    replayError = error
  }

  const newTexts = ctx.repliesText()
  for (const text of newTexts) {
    console.log(pc.gray("  ┃"), text.split("\n").join(`\n${pc.gray("  ┃ ")}`))
  }

  if (replayError) {
    console.log("")
    logger.error("Replay", "Handler threw during replay (reproduced!):")
    console.error(replayError)
  }

  // ===== VERDICT =====

  console.log("")
  if (newTexts.join("\n") === originalTexts.join("\n") && !replayError === !recording.error) {
    logger.success("Replay", "PASS — replay matches the original run")
  } else {
    logger.warn("Replay", "DIFF — replay output differs from the original run")
  }
}
