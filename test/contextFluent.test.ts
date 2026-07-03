import { describe, it, expect, vi } from "vitest"
import { createReplyableContext, armAutoDefer } from "../src/core/context/ReplyableContext.js"
import type { GlyriaContext, Replyable } from "../src/core/context/ReplyableContext.js"

// ===== FAKES =====

const fakeMessage = () => ({
  edit: vi.fn(async () => {}),
})

/** Interaction-like source: reply/editReply/followUp/deferReply + state flags */
const fakeInteraction = () => {
  const message = fakeMessage()
  const source = {
    user: { id: "user-1" },
    member: { nickname: "tester" },
    replied: false,
    deferred: false,
    reply: vi.fn(async () => {
      source.replied = true
      return message
    }),
    editReply: vi.fn(async () => {
      source.replied = true
      return message
    }),
    followUp: vi.fn(async () => message),
    deferReply: vi.fn(async () => {
      source.deferred = true
    }),
  }
  return { source, message }
}

/** Message-like source: reply + author, no interaction methods */
const fakeMessageSource = () => {
  const message = fakeMessage()
  const source = {
    author: { id: "author-1" },
    reply: vi.fn(async () => message),
  }
  return { source, message }
}

const payloadOf = (fn: ReturnType<typeof vi.fn>, call = 0) =>
  fn.mock.calls[call]![0] as { flags: number; components: unknown[]; files?: unknown[] }

const textOf = (payload: { components: unknown[] }) => JSON.stringify(payload.components)

// ===== TESTS =====

describe("fluent reply chaining", () => {
  it("supports .description().field().send()", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.success("Title").description("Some text").field("Field", "Value").send()

    const payload = payloadOf(source.reply)
    expect(textOf(payload)).toContain("✅ Title")
    expect(textOf(payload)).toContain("Some text")
    expect(textOf(payload)).toContain("**Field**\\nValue")
  })

  it("stays awaitable without .send() (thenable)", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.info("hello")

    expect(source.reply).toHaveBeenCalledOnce()
  })

  it("attaches files to the payload and container", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.primary("With file").file(Buffer.from("img"), "rank.png").send()

    const payload = payloadOf(source.reply)
    expect(payload.files).toEqual([{ attachment: Buffer.from("img"), name: "rank.png" }])
    expect(textOf(payload)).toContain("attachment://rank.png")
  })

  it("only sends once even if awaited twice", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    const chain = ctx.g.reply.success("once")
    await chain
    await chain.send()

    expect(source.reply).toHaveBeenCalledOnce()
  })
})

describe("smart routing", () => {
  it("uses editReply when the interaction was deferred", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.defer()
    await ctx.g.reply.success("after defer")

    expect(source.deferReply).toHaveBeenCalledOnce()
    expect(source.editReply).toHaveBeenCalledOnce()
    expect(source.reply).not.toHaveBeenCalled()
  })

  it("falls back to followUp after the first send", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.success("first")
    await ctx.g.reply.info("second")

    expect(source.reply).toHaveBeenCalledOnce()
    expect(source.followUp).toHaveBeenCalledOnce()
  })

  it("exposes typed followUps explicitly", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.followUp.warning("heads up")

    expect(source.followUp).toHaveBeenCalledOnce()
    expect(textOf(payloadOf(source.followUp))).toContain("⚠️ heads up")
  })
})

describe("ephemeral defaults", () => {
  it("applies ctx.g.ephemeral(true) to subsequent sends", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    ctx.g.ephemeral(true)
    await ctx.g.reply.success("private")

    expect(payloadOf(source.reply).flags & (1 << 6)).toBe(1 << 6)
  })

  it("never flags message-based sources as ephemeral", async () => {
    const { source } = fakeMessageSource()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.success("public", { ephemeral: true })

    expect(payloadOf(source.reply).flags & (1 << 6)).toBe(0)
  })
})

describe("ctx.g.edit", () => {
  it("edits the last sent message", async () => {
    const { source, message } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.success("original")
    await ctx.g.edit("updated")

    expect(message.edit).toHaveBeenCalledOnce()
    const edited = message.edit.mock.calls[0]![0] as { components: unknown[] }
    // keeps the success variant of the last send
    expect(textOf(edited)).toContain("✅ updated")
  })

  it("throws when nothing was sent", async () => {
    const { source } = fakeMessageSource()
    const ctx = createReplyableContext(source)

    await expect(ctx.g.edit("nope")).rejects.toThrow()
  })
})

describe("ctx.g.reply.loading", () => {
  it("resolves with the promise result and edits to success", async () => {
    const { source, message } = fakeInteraction()
    const ctx = createReplyableContext(source)

    const result = await ctx.g.reply.loading("Searching...", Promise.resolve(42), {
      done: (r) => `Found ${r}`,
    })

    expect(result).toBe(42)
    expect(textOf(payloadOf(source.reply))).toContain("⏳ Searching...")
    expect(textOf(message.edit.mock.calls[0]![0] as { components: unknown[] })).toContain(
      "✅ Found 42",
    )
  })

  it("edits to error and rethrows on failure", async () => {
    const { source, message } = fakeInteraction()
    const ctx = createReplyableContext(source)

    await expect(
      ctx.g.reply.loading("Working...", Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom")

    expect(textOf(message.edit.mock.calls[0]![0] as { components: unknown[] })).toContain("❌")
  })
})

describe("history and onSend", () => {
  it("records every send and notifies listeners", async () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)
    const seen: string[] = []

    ctx.g.onSend((entry) => seen.push(entry.variant))

    await ctx.g.reply.success("one")
    await ctx.g.followUp.info("two")

    expect(ctx.g.history().map((e) => e.variant)).toEqual(["success", "info"])
    expect(seen).toEqual(["success", "info"])
  })
})

describe("enriched context", () => {
  it("exposes user and member for interactions", () => {
    const { source } = fakeInteraction()
    const ctx = createReplyableContext(source)

    expect(ctx.g.user).toEqual({ id: "user-1" })
    expect(ctx.g.member).toEqual({ nickname: "tester" })
  })

  it("exposes author as user for messages", () => {
    const { source } = fakeMessageSource()
    const ctx = createReplyableContext(source)

    expect(ctx.g.user).toEqual({ id: "author-1" })
  })
})

describe("auto-defer", () => {
  it("defers slow handlers and skips fast ones", async () => {
    vi.useFakeTimers()
    try {
      const slow = fakeInteraction()
      const slowCtx = createReplyableContext(slow.source)
      armAutoDefer(slowCtx as GlyriaContext<Replyable>, 100)

      await vi.advanceTimersByTimeAsync(150)
      expect(slow.source.deferReply).toHaveBeenCalledOnce()

      const fast = fakeInteraction()
      const fastCtx = createReplyableContext(fast.source)
      armAutoDefer(fastCtx as GlyriaContext<Replyable>, 100)
      await fastCtx.g.reply.success("done fast")

      await vi.advanceTimersByTimeAsync(150)
      expect(fast.source.deferReply).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("idempotent wrapping", () => {
  it("returns the same context when wrapped twice", () => {
    const { source } = fakeInteraction()
    const first = createReplyableContext(source)
    const again = createReplyableContext(first)

    expect(again.g).toBe(first.g)
  })
})
