// src/cli/commands/bench.ts

import { performance } from "node:perf_hooks"
import pc from "picocolors"
import { logger } from "../../core/logger.js"
import { createTestContext } from "../../sdk/testContext.js"

// ===== ARG PARSING =====

interface BenchArgs {
  key: string | undefined
  runs: number
  concurrency: number
  options: Record<string, string>
}

const parseArgs = (args: string[]): BenchArgs => {
  const parsed: BenchArgs = { key: undefined, runs: 200, concurrency: 20, options: {} }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-n" || arg === "--runs") {
      parsed.runs = Number(args[++i]) || parsed.runs
    } else if (arg === "-c" || arg === "--concurrency") {
      parsed.concurrency = Number(args[++i]) || parsed.concurrency
    } else if (arg === "-o" || arg === "--option") {
      const pair = args[++i] ?? ""
      const eq = pair.indexOf("=")
      if (eq > 0) parsed.options[pair.slice(0, eq)] = pair.slice(eq + 1)
    } else if (!arg.startsWith("-") && parsed.key === undefined) {
      parsed.key = arg
    }
  }

  return parsed
}

// ===== STATS =====

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

const ms = (value: number) => `${value.toFixed(2)}ms`

// ===== BENCH =====

// Handlers run in-process against a fake context: this measures YOUR handler
// code (db calls, computation, awaited work) — not Discord's API latency.
export const bench = async (args: string[]) => {
  logger.banner()

  const { key, runs, concurrency, options } = parseArgs(args)

  // the loader resolves .ts vs .js at import time — decide before importing it
  process.env.GLYRIA_DEV ??= "true"
  const { loadConfig } = await import("../../core/config.js")
  await loadConfig()
  const { loadCommands } = await import("../../core/loader.js")
  const commands = await loadCommands()
  const handlers = commands.flatMap((c) => c.handlers)

  if (!key) {
    console.log("Usage: glyria bench <command> [-n runs] [-c concurrency] [-o name=value]...")
    if (handlers.length) {
      console.log("\nAvailable commands:")
      for (const h of handlers) console.log(pc.cyan(`  ${h.name}`))
    }
    process.exit(1)
  }

  const entry = handlers.find((h) => h.name === key)
  if (!entry) {
    logger.error("Bench", `Command "${key}" not found`)
    if (handlers.length) {
      console.log("\nAvailable commands:")
      for (const h of handlers) console.log(pc.cyan(`  ${h.name}`))
    }
    process.exit(1)
  }

  const subcommand = key.split(":").slice(1)

  logger.info("Bench", `${runs} run(s) of /${key.replaceAll(":", " ")} at concurrency ${concurrency}`)

  const latencies: number[] = []
  const errors: unknown[] = []
  let next = 0

  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= runs) return

      const ctx = createTestContext({
        // one user per run so per-user cooldowns don't serialize the bench
        userId: `bench-user-${i}`,
        options,
        subcommand,
      })

      const startedAt = performance.now()
      try {
        await entry.handler(ctx as never)
      } catch (error) {
        errors.push(error)
      }
      latencies.push(performance.now() - startedAt)
    }
  }

  const startedAt = performance.now()
  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, () => worker()))
  const totalMs = performance.now() - startedAt

  // ===== REPORT =====

  const sorted = [...latencies].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)

  console.log("")
  console.log(pc.bold("  Results"))
  console.log(pc.gray("  " + "─".repeat(40)))
  console.log("  total      ", pc.bold(ms(totalMs)))
  console.log("  throughput ", pc.bold(`${(runs / (totalMs / 1000)).toFixed(1)} runs/s`))
  console.log("  min        ", ms(sorted[0] ?? 0))
  console.log("  avg        ", ms(sorted.length ? sum / sorted.length : 0))
  console.log("  p50        ", ms(percentile(sorted, 50)))
  console.log("  p95        ", pc.yellow(ms(percentile(sorted, 95))))
  console.log("  p99        ", pc.yellow(ms(percentile(sorted, 99))))
  console.log("  max        ", pc.red(ms(sorted[sorted.length - 1] ?? 0)))
  console.log("")

  if (errors.length) {
    logger.warn("Bench", `${errors.length}/${runs} run(s) threw — first error:`)
    console.error(errors[0])
  } else {
    logger.success("Bench", `${runs}/${runs} run(s) completed without errors`)
  }
}
