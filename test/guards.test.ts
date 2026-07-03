import { describe, it, expect } from "vitest"
import { CooldownStore, normalizeCooldown, runGuards } from "../src/core/guards.js"
import type { GuardSubject } from "../src/core/guards.js"

const subject = (overrides: Partial<GuardSubject> = {}): GuardSubject => ({
  userId: "user-1",
  guildId: "guild-1",
  missingPermissions: () => [],
  isOwner: async () => false,
  ...overrides,
})

describe("normalizeCooldown", () => {
  it("treats a bare duration as a user cooldown", () => {
    expect(normalizeCooldown("5s")).toEqual({ user: 5_000 })
    expect(normalizeCooldown(1500)).toEqual({ user: 1500 })
  })

  it("parses per-scope durations", () => {
    expect(normalizeCooldown({ user: "5s", guild: "2s", global: 100 })).toEqual({
      user: 5_000,
      guild: 2_000,
      global: 100,
    })
  })
})

describe("CooldownStore", () => {
  it("reports remaining time and expires", () => {
    const store = new CooldownStore()
    store.set("key", 5_000, 1_000)

    expect(store.remaining("key", 2_000)).toBe(4_000)
    expect(store.remaining("key", 6_000)).toBe(0)
    expect(store.remaining("other", 2_000)).toBe(0)
  })
})

describe("runGuards", () => {
  it("passes when no guards deny", async () => {
    const denial = await runGuards({ cooldown: { user: 1000 } }, "ping", new CooldownStore(), subject())
    expect(denial).toBeNull()
  })

  it("denies non-owners on ownerOnly commands", async () => {
    const denial = await runGuards({ ownerOnly: true }, "admin", new CooldownStore(), subject())
    expect(denial).toMatch(/owner/i)

    const allowed = await runGuards(
      { ownerOnly: true },
      "admin",
      new CooldownStore(),
      subject({ isOwner: async () => true }),
    )
    expect(allowed).toBeNull()
  })

  it("denies when permissions are missing and lists them", async () => {
    const denial = await runGuards(
      { permissions: ["BanMembers"] },
      "ban",
      new CooldownStore(),
      subject({ missingPermissions: () => ["BanMembers"] }),
    )
    expect(denial).toContain("Ban Members")
  })

  it("denies permission-gated commands in DMs (no member permissions)", async () => {
    const denial = await runGuards(
      { permissions: ["BanMembers"] },
      "ban",
      new CooldownStore(),
      subject({ missingPermissions: () => null }),
    )
    expect(denial).not.toBeNull()
  })

  it("enforces user cooldowns per user", async () => {
    const store = new CooldownStore()
    const guards = { cooldown: { user: 5_000 } }

    expect(await runGuards(guards, "ping", store, subject())).toBeNull()
    expect(await runGuards(guards, "ping", store, subject())).toMatch(/cooldown/i)

    // another user is unaffected
    expect(await runGuards(guards, "ping", store, subject({ userId: "user-2" }))).toBeNull()
  })

  it("enforces guild cooldowns across users, but not in DMs", async () => {
    const store = new CooldownStore()
    const guards = { cooldown: { guild: 5_000 } }

    expect(await runGuards(guards, "ping", store, subject())).toBeNull()
    expect(await runGuards(guards, "ping", store, subject({ userId: "user-2" }))).toMatch(
      /cooldown/i,
    )

    // DM: guild scope does not apply
    expect(await runGuards(guards, "ping", store, subject({ userId: "user-3", guildId: null }))).toBeNull()
  })

  it("scopes cooldowns per command key", async () => {
    const store = new CooldownStore()
    const guards = { cooldown: { user: 5_000 } }

    expect(await runGuards(guards, "ping", store, subject())).toBeNull()
    expect(await runGuards(guards, "pong", store, subject())).toBeNull()
  })

  it("does not consume the cooldown when another guard denies", async () => {
    const store = new CooldownStore()
    const guards = { ownerOnly: true, cooldown: { user: 5_000 } }

    // denied by ownerOnly — cooldown must not be set
    expect(await runGuards(guards, "admin", store, subject())).toMatch(/owner/i)

    // now as owner: cooldown should still be fresh
    const owner = subject({ isOwner: async () => true })
    expect(await runGuards(guards, "admin", store, owner)).toBeNull()
  })
})
