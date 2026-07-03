// src/sdk/testContext.ts

import { createReplyableContext } from "../core/context/ReplyableContext.js"
import type { GlyriaContext } from "../core/context/ReplyableContext.js"

// ===== TYPES =====

export interface CapturedReply {
  via: "reply" | "editReply" | "followUp" | "deferReply" | "update" | "edit"
  payload: unknown
  timestamp: number
}

export interface TestContextOptions {
  userId?: string
  username?: string
  guildId?: string | null
  channelId?: string
  member?: unknown
  /** Slash option values, keyed by option name. */
  options?: Record<string, unknown>
  /** Subcommand path, e.g. ["theme", "set"] for group+sub or ["show"]. */
  subcommand?: string[]
}

export interface FakeInteraction {
  user: { id: string; username: string }
  member: unknown
  guildId: string | null
  channelId: string
  commandName: string
  replied: boolean
  deferred: boolean
  options: {
    getString(name: string): string | null
    getInteger(name: string): number | null
    getNumber(name: string): number | null
    getBoolean(name: string): boolean | null
    getUser(name: string): unknown
    getRole(name: string): unknown
    getSubcommand(required?: boolean): string | null
    getSubcommandGroup(required?: boolean): string | null
    getFocused(full?: boolean): unknown
  }
  reply(options: unknown): Promise<unknown>
  editReply(options: unknown): Promise<unknown>
  followUp(options: unknown): Promise<unknown>
  deferReply(options?: unknown): Promise<unknown>
  isChatInputCommand(): boolean
}

export type TestContext = GlyriaContext<FakeInteraction> & {
  /** Everything the handler sent, in order. */
  replies: CapturedReply[]
  /** Plain-text view of every reply (Embed V2 text extracted). */
  repliesText(): string[]
}

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

// ===== FACTORY =====

/**
 * Builds a fake interaction wrapped in a full Glyria context — run command
 * handlers, module hooks, or components without Discord, then assert on
 * `ctx.replies` / `ctx.repliesText()`.
 */
export const createTestContext = (opts: TestContextOptions = {}): TestContext => {
  const replies: CapturedReply[] = []

  const capture = (via: CapturedReply["via"]) => async (payload?: unknown) => {
    replies.push({ via, payload, timestamp: Date.now() })
    if (via === "deferReply") source.deferred = true
    else source.replied = true

    // a message-like object so g.edit()/loading()/confirm() find something
    return {
      edit: async (edited: unknown) => {
        replies.push({ via: "edit", payload: edited, timestamp: Date.now() })
        return {}
      },
      awaitMessageComponent: async () => {
        throw new Error("test context: no user to click components")
      },
    }
  }

  const values = opts.options ?? {}
  const sub = opts.subcommand ?? []

  const source: FakeInteraction = {
    user: { id: opts.userId ?? "test-user", username: opts.username ?? "tester" },
    member: opts.member ?? null,
    guildId: opts.guildId === undefined ? "test-guild" : opts.guildId,
    channelId: opts.channelId ?? "test-channel",
    commandName: "",
    replied: false,
    deferred: false,
    options: {
      getString: (name) => (values[name] as string) ?? null,
      getInteger: (name) => (values[name] as number) ?? null,
      getNumber: (name) => (values[name] as number) ?? null,
      getBoolean: (name) => (values[name] as boolean) ?? null,
      getUser: (name) => values[name] ?? null,
      getRole: (name) => values[name] ?? null,
      getSubcommand: () => (sub.length ? sub[sub.length - 1]! : null),
      getSubcommandGroup: () => (sub.length > 1 ? sub[0]! : null),
      getFocused: () => "",
    },
    reply: capture("reply"),
    editReply: capture("editReply"),
    followUp: capture("followUp"),
    deferReply: capture("deferReply"),
    isChatInputCommand: () => true,
  }

  const ctx = createReplyableContext(source) as TestContext
  ctx.replies = replies
  ctx.repliesText = () => replies.map((r) => extractText(r.payload)).filter(Boolean)

  return ctx
}
