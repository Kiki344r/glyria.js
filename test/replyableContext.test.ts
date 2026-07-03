import { describe, it, expect, vi } from "vitest"
import { createReplyableContext } from "../src/core/context/ReplyableContext.js"

// ===== FAKES =====

interface FakeClick {
  customId: string
  user: { id: string }
  update: ReturnType<typeof vi.fn>
}

const click = (customId: string, userId = "user-1"): FakeClick => ({
  customId,
  user: { id: userId },
  update: vi.fn(async () => {}),
})

/**
 * Builds a fake interaction whose reply() resolves to a fake message.
 * `clicks` are consumed one per awaitMessageComponent call (respecting the
 * filter); when exhausted, the next await rejects like a timeout would.
 */
const fakeSource = (clicks: FakeClick[] = []) => {
  const queue = [...clicks]

  const message = {
    edit: vi.fn(async () => {}),
    awaitMessageComponent: vi.fn(
      async ({ filter }: { filter: (i: FakeClick) => boolean; time: number }) => {
        const next = queue.shift()
        if (!next || !filter(next)) throw new Error("timeout")
        return next
      },
    ),
  }

  const source = {
    user: { id: "user-1" },
    reply: vi.fn(async () => message),
  }

  return { source, message }
}

const componentsOf = (payload: unknown) =>
  JSON.stringify((payload as { components: unknown[] }).components)

// ===== TESTS =====

describe("ctx.g.reply", () => {
  it("adds the ephemeral flag when requested", async () => {
    const { source } = fakeSource()
    const ctx = createReplyableContext(source)

    await ctx.g.reply.success("done")
    await ctx.g.reply.error("nope", { ephemeral: true })

    const [normal] = source.reply.mock.calls[0] as [{ flags: number }]
    const [ephemeral] = source.reply.mock.calls[1] as [{ flags: number }]

    expect(normal.flags & (1 << 6)).toBe(0)
    expect(ephemeral.flags & (1 << 6)).toBe(1 << 6)
    expect(ephemeral.flags & (1 << 15)).toBe(1 << 15)
  })
})

describe("ctx.g.confirm", () => {
  it("resolves true when the confirm button is clicked", async () => {
    const confirm = click("glyria:confirm:yes")
    const { source } = fakeSource([confirm])
    const ctx = createReplyableContext(source)

    await expect(ctx.g.confirm("Delete everything?")).resolves.toBe(true)
    expect(confirm.update).toHaveBeenCalledOnce()
  })

  it("resolves false when the cancel button is clicked", async () => {
    const { source } = fakeSource([click("glyria:confirm:no")])
    const ctx = createReplyableContext(source)

    await expect(ctx.g.confirm("Delete everything?")).resolves.toBe(false)
  })

  it("resolves false and disables buttons on timeout", async () => {
    const { source, message } = fakeSource([])
    const ctx = createReplyableContext(source)

    await expect(ctx.g.confirm("Sure?", { timeout: "1s" })).resolves.toBe(false)
    expect(message.edit).toHaveBeenCalledOnce()
    expect(componentsOf(message.edit.mock.calls[0]![0])).toContain('"disabled":true')
  })

  it("ignores clicks from other users", async () => {
    const { source } = fakeSource([click("glyria:confirm:yes", "intruder")])
    const ctx = createReplyableContext(source)

    await expect(ctx.g.confirm("Sure?")).resolves.toBe(false)
  })
})

describe("ctx.g.paginate", () => {
  it("throws on an empty page list", async () => {
    const { source } = fakeSource()
    const ctx = createReplyableContext(source)

    await expect(ctx.g.paginate([])).rejects.toThrow()
  })

  it("sends a single page without buttons", async () => {
    const { source, message } = fakeSource()
    const ctx = createReplyableContext(source)

    await ctx.g.paginate(["only page"])

    expect(source.reply).toHaveBeenCalledOnce()
    expect(componentsOf(source.reply.mock.calls[0]![0])).not.toContain("glyria:page:")
    expect(message.awaitMessageComponent).not.toHaveBeenCalled()
  })

  it("navigates pages on clicks and disables buttons on timeout", async () => {
    const next = click("glyria:page:next")
    const { source, message } = fakeSource([next])
    const ctx = createReplyableContext(source)

    await ctx.g.paginate(["page one", "page two"], { timeout: "1s" })

    // initial render: page 1, prev disabled
    const initial = componentsOf(source.reply.mock.calls[0]![0])
    expect(initial).toContain("page one")
    expect(initial).toContain("1/2")

    // after next: page 2
    const updated = componentsOf(next.update.mock.calls[0]![0])
    expect(updated).toContain("page two")
    expect(updated).toContain("2/2")

    // timeout: everything disabled
    expect(message.edit).toHaveBeenCalledOnce()
  })
})
