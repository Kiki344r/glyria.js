import { describe, it, expect, vi } from "vitest"
import { defineModule, defineHook, isModuleDefinition } from "../src/sdk/defineModule.js"
import { ModuleManager, resolveLoadOrder } from "../src/managers/modules.js"
import { createTestContext } from "../src/sdk/testContext.js"
import type { GlyriaClient } from "../src/core/client.js"

// the manager only uses client.on for guild events — a stub suffices for tests
const fakeClient = () => ({ on: vi.fn() }) as unknown as GlyriaClient

const manager = () => new ModuleManager().setClient(fakeClient())

describe("defineModule", () => {
  it("brands definitions and validates the name", () => {
    const def = defineModule({ name: "economy" })
    expect(isModuleDefinition(def)).toBe(true)
    expect(isModuleDefinition({ name: "not-branded" })).toBe(false)
    expect(() => defineModule({ name: "" })).toThrow()
  })
})

describe("resolveLoadOrder", () => {
  const mod = (name: string, dependsOn?: string[]) => defineModule({ name, ...(dependsOn && { dependsOn }) })

  it("orders dependencies before dependents", () => {
    const { order, failed } = resolveLoadOrder([
      mod("shop", ["economy"]),
      mod("economy"),
      mod("casino", ["economy", "shop"]),
    ])

    expect(order.map((d) => d.name)).toEqual(["economy", "shop", "casino"])
    expect(failed).toEqual([])
  })

  it("fails modules with missing dependencies", () => {
    const { order, failed } = resolveLoadOrder([mod("shop", ["economy"])])

    expect(order).toEqual([])
    expect(failed[0]).toMatchObject({ name: "shop" })
    expect(failed[0]!.reason).toContain("missing dependency")
  })

  it("detects cycles", () => {
    const { failed } = resolveLoadOrder([mod("a", ["b"]), mod("b", ["a"])])
    expect(failed.some((f) => f.reason.includes("cycle"))).toBe(true)
  })
})

describe("ModuleManager", () => {
  it("runs setup and exposes the public API to other modules", async () => {
    const m = manager()
    m.register(
      defineModule({
        name: "economy",
        setup: () => ({ addBalance: (n: number) => n + 1 }),
      }),
    )
    m.register(
      defineModule({
        name: "shop",
        dependsOn: ["economy"],
        setup: (ctx) => {
          const economy = ctx.modules.get("economy") as { addBalance(n: number): number }
          return { buy: () => economy.addBalance(10) }
        },
      }),
    )

    await m.loadAll()

    const shop = m.getApi("shop") as { buy(): number }
    expect(shop.buy()).toBe(11)
  })

  it("validates module config with zod-compatible schemas", async () => {
    const m = manager()
    const seen: unknown[] = []

    m.register(
      defineModule({
        name: "validated",
        config: { parse: (input: unknown) => (input as { rate: number }) },
        setup: (ctx) => void seen.push(ctx.config),
      }),
    )
    await m.loadAll({ validated: { rate: 2 } })

    expect(seen).toEqual([{ rate: 2 }])
    expect(m.list()[0]).toMatchObject({ name: "validated", status: "active" })
  })

  it("disables a module whose config validation throws", async () => {
    const m = manager()
    m.register(
      defineModule({
        name: "strict",
        config: () => {
          throw new Error("bad config")
        },
      }),
    )
    await m.loadAll()

    expect(m.list()[0]).toMatchObject({ name: "strict", status: "error" })
  })

  it("isolates a crashing setup without affecting other modules", async () => {
    const m = manager()
    m.register(
      defineModule({
        name: "bomb",
        setup: () => {
          throw new Error("boom")
        },
      }),
    )
    m.register(defineModule({ name: "stable", setup: () => ({ ok: true }) }))

    await m.loadAll()

    const statuses = Object.fromEntries(m.list().map((e) => [e.name, e.status]))
    expect(statuses).toEqual({ bomb: "error", stable: "active" })
  })

  it("runs the beforeCommand middleware chain in order", async () => {
    const m = manager()
    const calls: string[] = []

    m.register(
      defineModule({
        name: "first",
        hooks: defineHook({
          beforeCommand: async (_ctx, _meta, next) => {
            calls.push("first:in")
            await next()
            calls.push("first:out")
          },
        }),
      }),
    )
    m.register(
      defineModule({
        name: "second",
        hooks: {
          beforeCommand: async (_ctx, _meta, next) => {
            calls.push("second")
            await next()
          },
        },
      }),
    )

    await m.loadAll()
    const ctx = createTestContext()
    const proceed = await m.runBeforeCommand(ctx as never, { name: "ping", kind: "chat" })

    expect(proceed).toBe(true)
    expect(calls).toEqual(["first:in", "second", "first:out"])
  })

  it("cancels the command when a middleware skips next()", async () => {
    const m = manager()
    m.register(
      defineModule({
        name: "blocker",
        hooks: {
          beforeCommand: async () => {
            /* no next() — cancel */
          },
        },
      }),
    )

    await m.loadAll()
    const proceed = await m.runBeforeCommand(createTestContext() as never, {
      name: "ping",
      kind: "chat",
    })

    expect(proceed).toBe(false)
  })

  it("auto-disables a module after repeated hook crashes", async () => {
    const m = manager()
    m.register(
      defineModule({
        name: "flaky",
        hooks: {
          afterCommand: () => {
            throw new Error("always fails")
          },
        },
      }),
    )
    await m.loadAll()

    for (let i = 0; i < 5; i++) {
      await m.runAfterCommand(createTestContext() as never, { name: "x", kind: "chat" }, undefined)
    }

    expect(m.list()[0]).toMatchObject({ name: "flaky", status: "disabled" })
  })

  it("hot-swaps a module in place", async () => {
    const m = manager()
    m.register(defineModule({ name: "swap", setup: () => ({ version: 1 }) }))
    await m.loadAll()

    expect((m.getApi("swap") as { version: number }).version).toBe(1)

    // no source file: reload re-runs the same definition
    const ok = await m.reload("swap")
    expect(ok).toBe(true)
    expect(m.list()[0]).toMatchObject({ name: "swap", status: "active" })
  })
})

describe("createTestContext", () => {
  it("captures styled replies as text", async () => {
    const ctx = createTestContext({ options: { target: "world" } })

    await ctx.g.reply.success(`Hello ${ctx.options.getString("target")}`)
    await ctx.g.followUp.info("Second message")

    expect(ctx.repliesText()).toEqual(["✅ Hello world", "ℹ️ Second message"])
    expect(ctx.replies.map((r) => r.via)).toEqual(["reply", "followUp"])
  })

  it("resolves subcommand paths", () => {
    const ctx = createTestContext({ subcommand: ["theme", "set"] })
    expect(ctx.options.getSubcommandGroup()).toBe("theme")
    expect(ctx.options.getSubcommand()).toBe("set")
  })
})
