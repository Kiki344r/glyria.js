// src/core/ReplyableContext.ts

import { useConfig } from "../config.js"

import { EmbedV2Builder } from "../../builders/embedV2Builder.js"
import { hexToNumber } from "../../utils/hexToNumber.js"
import { parseDuration } from "../../utils/duration.js"
import type { Duration } from "../../utils/duration.js"
import { logger } from "../logger.js"
import { useStore } from "../store.js"
import type { ScopedStore } from "../store.js"
import { canvas } from "../canvas/index.js"
import type { GlyriaCanvas } from "../canvas/index.js"

// ===== TYPES =====

export interface Replyable {
  reply(options: unknown): Promise<unknown>
}

export interface ReplyOptions {
  ephemeral?: boolean
}

export interface ConfirmOptions {
  /** Idle timeout before the confirmation resolves to false. Default: "30s". */
  timeout?: Duration
  confirmLabel?: string
  cancelLabel?: string
  ephemeral?: boolean
}

export interface PaginateOptions {
  /** Idle timeout before the pagination buttons are disabled. Default: "2m". */
  timeout?: Duration
  ephemeral?: boolean
}

export interface LoadingOptions extends ReplyOptions {
  /** Message shown when the promise resolves. Default: "Done". */
  done?: string | ((result: unknown) => string)
  /** Message shown when the promise rejects. Default: "Something went wrong". */
  fail?: string | ((error: unknown) => string)
}

export type ReplyVariant = "primary" | "secondary" | "success" | "warning" | "error" | "info"

export interface SentEntry {
  variant: ReplyVariant | "raw"
  via: "reply" | "followUp" | "edit" | "update"
  payload: unknown
  message: unknown
  timestamp: number
}

export interface FileAttachment {
  attachment: Buffer | string
  name: string
}

// ===== FLUENT BUILDER TYPE =====

export interface ReplyChain extends PromiseLike<unknown> {
  description(text: string): this
  field(name: string, value: string): this
  file(data: Buffer | string, name: string): this
  ephemeral(ephemeral?: boolean): this
  send(): Promise<unknown>
}

export type StyledSender = (content: string, opts?: ReplyOptions) => ReplyChain

export interface StyledSenderSet {
  primary: StyledSender
  secondary: StyledSender
  success: StyledSender
  warning: StyledSender
  error: StyledSender
  info: StyledSender
}

export interface GlyriaReply extends StyledSenderSet {
  /** Escape hatch: send a raw discord.js payload, bypassing Embed V2 styling. */
  raw(payload: unknown): Promise<unknown>
  /**
   * Send a styled loading message, await the promise, then edit the message
   * with the outcome. Resolves with the promise result (rethrows on failure).
   */
  loading<T>(content: string, promise: Promise<T>, opts?: LoadingOptions): Promise<T>
}

interface GlyriaBaseG {
  reply: GlyriaReply
  followUp: StyledSenderSet & { raw(payload: unknown): Promise<unknown> }

  confirm(content: string, opts?: ConfirmOptions): Promise<boolean>
  paginate(pages: string[], opts?: PaginateOptions): Promise<void>

  /** Edit the last message sent through this context. */
  edit(content: string, opts?: { variant?: ReplyVariant }): Promise<unknown>

  /** Set the default ephemeral behavior for every send from this context. */
  ephemeral(ephemeral?: boolean): void

  /** All messages sent through this context, most recent last. */
  history(): SentEntry[]

  /** Register a callback invoked after every message sent through this context. */
  onSend(listener: (entry: SentEntry) => void): void

  /** Log to the console and, when `logChannel` is configured, to Discord. */
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>

  /** The invoking user (interaction.user / message.author). */
  user: unknown
  /** The invoking guild member, when available. */
  member: unknown

  /** Built-in state store, scoped to the invocation. */
  store: {
    /** Scoped to the current guild — throws when used in DMs. */
    guild: ScopedStore
    /** Scoped to the invoking user. */
    user: ScopedStore
    /** Bot-wide scope. */
    global: ScopedStore
  }

  /** Per-guild configuration namespace — throws when used in DMs. */
  guildConfig: ScopedStore

  /** Built-in visual generator: `(await ctx.g.canvas.rankCard({...}).attachment())`. */
  canvas: GlyriaCanvas
}

type HasDefer = { deferReply(options?: never): unknown }
type HasUpdate = { update(options: never): unknown }

export type GlyriaG<T> = GlyriaBaseG &
  (T extends HasDefer ? { defer(opts?: { ephemeral?: boolean }): Promise<void> } : object) &
  (T extends HasUpdate ? { update: StyledSenderSet } : object)

export type GlyriaContext<T extends Replyable> = T & {
  g: GlyriaG<T>
}

// ===== STRUCTURAL SHAPES =====
// Kept structural so the context works for interactions, messages, and test
// fakes alike without importing concrete discord.js classes.

interface ComponentClick {
  customId: string
  user: { id: string }
  update(options: unknown): Promise<unknown>
}

interface SentReply {
  fetch?(): Promise<SentReply>
  awaitMessageComponent?(options: {
    filter: (i: ComponentClick) => boolean
    time: number
  }): Promise<ComponentClick>
  edit?(options: unknown): Promise<unknown>
}

interface DuckSource {
  reply(options: unknown): Promise<unknown>
  followUp?(options: unknown): Promise<unknown>
  editReply?(options: unknown): Promise<unknown>
  deferReply?(options?: unknown): Promise<unknown>
  update?(options: unknown): Promise<unknown>
  deferred?: boolean
  replied?: boolean
  user?: { id?: string }
  author?: { id?: string }
  member?: unknown
  guildId?: string | null
  channel?: { send?(options: unknown): Promise<unknown> }
  client?: { channels?: { fetch(id: string): Promise<unknown> } }
}

// ===== FLAGS =====

const IS_COMPONENTS_V2 = 1 << 15
const EPHEMERAL = 1 << 6

// ===== THEME =====

const themeColor = (key: string, fallback: string): number => {
  const config = useConfig()
  const theme = config?.theme?.embedV2 as Record<string, string | undefined> | undefined
  return hexToNumber((theme?.[key] ?? fallback) as `#${string}`)
}

const VARIANTS: Record<ReplyVariant, { key: string; fallback: string; prefix: string }> = {
  primary: { key: "primaryColor", fallback: "#5865F2", prefix: "" },
  secondary: { key: "secondaryColor", fallback: "#4F545C", prefix: "" },
  success: { key: "successColor", fallback: "#57F287", prefix: "✅ " },
  warning: { key: "warningColor", fallback: "#FEE75C", prefix: "⚠️ " },
  error: { key: "errorColor", fallback: "#ED4245", prefix: "❌ " },
  info: { key: "infoColor", fallback: "#5DADE2", prefix: "ℹ️ " },
}

// ===== PAYLOAD BUILDING =====

interface StyledPayload {
  flags: number
  components: unknown[]
  files?: FileAttachment[]
}

const buildStyledPayload = (
  parts: string[],
  color: number,
  files: FileAttachment[] = [],
): StyledPayload => {
  const container = new EmbedV2Builder().container({ accentColor: color })

  for (const part of parts) container.textDisplay(part)
  for (const file of files) container.file(`attachment://${file.name}`)

  const payload = container.end().build() as StyledPayload
  if (files.length) payload.files = files
  return payload
}

const buildEmbed = (content: string, color: number) => buildStyledPayload([content], color)

// ===== CONTEXT STATE =====

class ContextState {
  defaultEphemeral = false
  sent: SentEntry[] = []
  listeners: ((entry: SentEntry) => void)[] = []
  autoDeferTimer: ReturnType<typeof setTimeout> | null = null

  constructor(public source: DuckSource) {}

  /** Messages can't be ephemeral — only interaction-like sources support the flag. */
  supportsEphemeral(): boolean {
    return typeof this.source.deferReply === "function" || !this.source.author
  }

  applyFlags(payload: StyledPayload, opts?: ReplyOptions): StyledPayload {
    const ephemeral = opts?.ephemeral ?? this.defaultEphemeral
    if (ephemeral && this.supportsEphemeral()) payload.flags |= EPHEMERAL
    return payload
  }

  cancelAutoDefer(): void {
    if (this.autoDeferTimer) {
      clearTimeout(this.autoDeferTimer)
      this.autoDeferTimer = null
    }
  }

  record(entry: SentEntry): void {
    this.sent.push(entry)
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch (error) {
        logger.error("Context", "onSend listener threw")
        console.error(error)
      }
    }
  }

  /**
   * Send through the right channel for the source's current state:
   * fresh → reply, deferred → editReply (first send), already replied →
   * followUp (channel.send as a last resort).
   */
  async dispatch(
    payload: unknown,
    variant: SentEntry["variant"],
    via?: "followUp",
  ): Promise<unknown> {
    this.cancelAutoDefer()
    const s = this.source

    let sender: ((options: unknown) => Promise<unknown>) | undefined
    let usedVia: SentEntry["via"]

    const alreadyResponded = s.replied === true || this.sent.length > 0

    if (via === "followUp" || alreadyResponded) {
      sender = s.followUp?.bind(s) ?? s.channel?.send?.bind(s.channel) ?? s.reply.bind(s)
      usedVia = "followUp"
    } else if (s.deferred === true && typeof s.editReply === "function") {
      sender = s.editReply.bind(s)
      usedVia = "edit"
    } else {
      sender = s.reply.bind(s)
      usedVia = "reply"
    }

    let message: unknown
    try {
      message = await sender(payload)
    } catch (error) {
      // Components V2 fallback: retry once as plain text (older proxies /
      // unsupported surfaces), preserving any files.
      const p = payload as Partial<StyledPayload> & { content?: string }
      if (typeof p?.flags === "number" && p.flags & IS_COMPONENTS_V2) {
        const text = extractText(p)
        message = await sender({ content: text, ...(p.files && { files: p.files }) })
      } else {
        throw error
      }
    }

    const entry: SentEntry = { variant, via: usedVia, payload, message, timestamp: Date.now() }
    this.record(entry)
    return message
  }
}

const extractText = (payload: Partial<StyledPayload>): string => {
  const texts: string[] = []
  const walk = (components: unknown[]) => {
    for (const c of components) {
      const comp = c as { type?: number; content?: string; components?: unknown[] }
      if (comp.type === 10 && comp.content) texts.push(comp.content)
      if (Array.isArray(comp.components)) walk(comp.components)
    }
  }
  walk(payload.components ?? [])
  return texts.join("\n") || "​"
}

// ===== FLUENT REPLY BUILDER =====

class ReplyBuilder implements ReplyChain {
  private parts: string[]
  private files: FileAttachment[] = []
  private opts: ReplyOptions
  private sending?: Promise<unknown>

  constructor(
    private state: ContextState,
    private variant: ReplyVariant,
    content: string,
    opts: ReplyOptions = {},
    private via?: "followUp",
  ) {
    this.parts = [`${VARIANTS[variant].prefix}${content}`]
    this.opts = { ...opts }
  }

  description(text: string): this {
    this.parts.push(text)
    return this
  }

  field(name: string, value: string): this {
    this.parts.push(`**${name}**\n${value}`)
    return this
  }

  file(data: Buffer | string, name: string): this {
    this.files.push({ attachment: data, name })
    return this
  }

  ephemeral(ephemeral = true): this {
    this.opts.ephemeral = ephemeral
    return this
  }

  send(): Promise<unknown> {
    if (!this.sending) {
      const { key, fallback } = VARIANTS[this.variant]
      const payload = this.state.applyFlags(
        buildStyledPayload(this.parts, themeColor(key, fallback), this.files),
        this.opts,
      )
      this.sending = this.state.dispatch(payload, this.variant, this.via)
    }
    return this.sending
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((value: unknown) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.send().then(onfulfilled, onrejected)
  }
}

// ===== STYLED SENDER SETS =====

const createSenderSet = (state: ContextState, via?: "followUp"): StyledSenderSet => {
  const make =
    (variant: ReplyVariant): StyledSender =>
    (content, opts) =>
      new ReplyBuilder(state, variant, content, opts, via)

  return {
    primary: make("primary"),
    secondary: make("secondary"),
    success: make("success"),
    warning: make("warning"),
    error: make("error"),
    info: make("info"),
  }
}

// ===== HELPERS =====

const resolveInvokerId = (source: DuckSource): string | undefined => {
  return source.user?.id ?? source.author?.id
}

const resolveMessage = async (replyResult: unknown): Promise<SentReply> => {
  const sent = replyResult as SentReply

  // An InteractionResponse can await components but cannot edit(); fetching
  // resolves both it and a Message to an editable Message.
  if (typeof sent?.fetch === "function") {
    try {
      return await sent.fetch()
    } catch {
      return sent
    }
  }

  return sent
}

const applyText = (fn: string | ((value: unknown) => string) | undefined, value: unknown) =>
  typeof fn === "function" ? fn(value) : fn

// ===== CONFIRM =====

const createConfirm = (state: ContextState) => {
  return async (content: string, opts: ConfirmOptions = {}): Promise<boolean> => {
    const time = parseDuration(opts.timeout ?? "30s")
    const invokerId = resolveInvokerId(state.source)
    const color = themeColor("warningColor", "#FEE75C")

    const render = (disabled: boolean) =>
      new EmbedV2Builder()
        .container({ accentColor: color })
        .textDisplay(content)
        .actionRow()
        .button({
          customId: "glyria:confirm:yes",
          label: opts.confirmLabel ?? "Confirm",
          style: "success",
          disabled,
        })
        .button({
          customId: "glyria:confirm:no",
          label: opts.cancelLabel ?? "Cancel",
          style: "danger",
          disabled,
        })
        .end()
        .end()
        .build() as StyledPayload

    const message = await resolveMessage(
      await state.dispatch(state.applyFlags(render(false), opts), "raw"),
    )

    if (typeof message?.awaitMessageComponent !== "function") {
      throw new Error("g.confirm: reply target does not support message components")
    }

    try {
      const click = await message.awaitMessageComponent({
        filter: (i) =>
          i.customId.startsWith("glyria:confirm:") && (!invokerId || i.user.id === invokerId),
        time,
      })

      await click.update(render(true))
      return click.customId === "glyria:confirm:yes"
    } catch {
      await message.edit?.(render(true))?.catch(() => {})
      return false
    }
  }
}

// ===== PAGINATE =====

const createPaginate = (state: ContextState) => {
  return async (pages: string[], opts: PaginateOptions = {}): Promise<void> => {
    if (!pages.length) throw new Error("g.paginate: no pages provided")

    const time = parseDuration(opts.timeout ?? "2m")
    const invokerId = resolveInvokerId(state.source)
    const color = themeColor("primaryColor", "#5865F2")

    // Single page: no buttons needed
    if (pages.length === 1) {
      await state.dispatch(state.applyFlags(buildEmbed(pages[0] ?? "", color), opts), "raw")
      return
    }

    let page = 0

    const render = (disabled: boolean) =>
      new EmbedV2Builder()
        .container({ accentColor: color })
        .textDisplay(pages[page] ?? "")
        .separator()
        .actionRow()
        .button({
          customId: "glyria:page:prev",
          label: "◀",
          style: "secondary",
          disabled: disabled || page === 0,
        })
        .button({
          customId: "glyria:page:indicator",
          label: `${page + 1}/${pages.length}`,
          style: "secondary",
          disabled: true,
        })
        .button({
          customId: "glyria:page:next",
          label: "▶",
          style: "secondary",
          disabled: disabled || page === pages.length - 1,
        })
        .end()
        .end()
        .build() as StyledPayload

    const message = await resolveMessage(
      await state.dispatch(state.applyFlags(render(false), opts), "raw"),
    )

    if (typeof message?.awaitMessageComponent !== "function") {
      throw new Error("g.paginate: reply target does not support message components")
    }

    for (;;) {
      try {
        const click = await message.awaitMessageComponent({
          filter: (i) =>
            i.customId.startsWith("glyria:page:") && (!invokerId || i.user.id === invokerId),
          time,
        })

        if (click.customId === "glyria:page:prev") page = Math.max(0, page - 1)
        else if (click.customId === "glyria:page:next") page = Math.min(pages.length - 1, page + 1)

        await click.update(render(false))
      } catch {
        await message.edit?.(render(true))?.catch(() => {})
        return
      }
    }
  }
}

// ===== AUTO DEFER =====

/**
 * Arms an automatic deferReply that fires when the handler hasn't responded
 * within `delay` ms — Discord's 3s interaction window minus safety margin.
 * Called by the framework before invoking a handler; a no-op for sources
 * without deferReply (messages).
 */
export const armAutoDefer = <T extends Replyable>(
  ctx: GlyriaContext<T>,
  delay = 1_500,
): void => {
  const state = stateOf(ctx)
  if (!state || typeof state.source.deferReply !== "function") return

  state.cancelAutoDefer()
  state.autoDeferTimer = setTimeout(() => {
    state.autoDeferTimer = null
    const s = state.source
    if (s.replied || s.deferred || state.sent.length) return

    const flags = state.defaultEphemeral && state.supportsEphemeral() ? EPHEMERAL : undefined
    s.deferReply?.(flags ? { flags } : undefined)?.catch?.(() => {})
  }, delay)

  if (typeof state.autoDeferTimer.unref === "function") state.autoDeferTimer.unref()
}

// ===== STATE ACCESS =====

const STATE = Symbol.for("glyria.context.state")

const stateOf = (ctx: unknown): ContextState | undefined =>
  (ctx as { [STATE]?: ContextState })[STATE]

// ===== CONTEXT CREATOR =====

export const createReplyableContext = <T extends Replyable>(source: T): GlyriaContext<T> => {
  const ctx = source as GlyriaContext<T> & { [STATE]?: ContextState }

  // idempotent: events + manager may both wrap the same object
  if (ctx.g && ctx[STATE]) return ctx

  const state = new ContextState(source as DuckSource)
  ctx[STATE] = state

  const reply = createSenderSet(state) as GlyriaReply

  reply.raw = async (payload: unknown) => state.dispatch(payload, "raw")

  reply.loading = async <R>(
    content: string,
    promise: Promise<R>,
    opts: LoadingOptions = {},
  ): Promise<R> => {
    const payload = state.applyFlags(
      buildStyledPayload([`⏳ ${content}`], themeColor("secondaryColor", "#4F545C")),
      opts,
    )
    const message = await resolveMessage(await state.dispatch(payload, "secondary"))

    const editWith = async (variant: ReplyVariant, text: string) => {
      const { key, fallback, prefix } = VARIANTS[variant]
      const edited = buildStyledPayload([`${prefix}${text}`], themeColor(key, fallback))
      await message.edit?.(edited)?.catch?.(() => {})
    }

    try {
      const result = await promise
      await editWith("success", applyText(opts.done, result) ?? "Done")
      return result
    } catch (error) {
      await editWith("error", applyText(opts.fail, error) ?? "Something went wrong")
      throw error
    }
  }

  const followUp = createSenderSet(state, "followUp") as GlyriaBaseG["followUp"]
  followUp.raw = async (payload: unknown) => state.dispatch(payload, "raw", "followUp")

  const g: GlyriaBaseG & {
    defer(opts?: { ephemeral?: boolean }): Promise<void>
    update: StyledSenderSet
  } = {
    reply,
    followUp,

    confirm: createConfirm(state),
    paginate: createPaginate(state),

    edit: async (content: string, opts: { variant?: ReplyVariant } = {}) => {
      const last = state.sent.at(-1)
      const s = state.source
      const variant =
        opts.variant ??
        (last && last.variant !== "raw" ? (last.variant as ReplyVariant) : "primary")
      const { key, fallback, prefix } = VARIANTS[variant]
      const payload = buildStyledPayload([`${prefix}${content}`], themeColor(key, fallback))

      if (last) {
        const message = await resolveMessage(last.message)
        if (typeof message?.edit === "function") return await message.edit(payload)
      }
      if (typeof s.editReply === "function" && (s.replied || s.deferred)) {
        return await s.editReply(payload)
      }
      throw new Error("g.edit: nothing sent through this context yet")
    },

    ephemeral: (ephemeral = true) => {
      state.defaultEphemeral = ephemeral
    },

    history: () => [...state.sent],

    onSend: (listener) => {
      state.listeners.push(listener)
    },

    log: async (message: string, level: "info" | "warn" | "error" = "info") => {
      logger[level]("Bot Log", message)

      const config = useConfig()
      const channelId = config.logChannel
      const client = (source as DuckSource).client
      if (!channelId || !client?.channels) return

      try {
        const channel = (await client.channels.fetch(channelId)) as {
          send?(options: unknown): Promise<unknown>
        } | null
        const variant: ReplyVariant = level === "info" ? "info" : level === "warn" ? "warning" : "error"
        const { key, fallback, prefix } = VARIANTS[variant]
        await channel?.send?.(buildStyledPayload([`${prefix}${message}`], themeColor(key, fallback)))
      } catch {
        logger.warn("Bot Log", `Could not post to log channel ${channelId}`)
      }
    },

    defer: async (opts?: { ephemeral?: boolean }) => {
      const s = state.source
      if (typeof s.deferReply !== "function" || s.deferred || s.replied) return
      const ephemeral = opts?.ephemeral ?? state.defaultEphemeral
      await s.deferReply(ephemeral ? { flags: EPHEMERAL } : undefined)
    },

    update: createSenderSet(state) as StyledSenderSet,

    get user() {
      const s = state.source
      return s.user ?? s.author
    },

    get member() {
      return state.source.member
    },

    get store() {
      const store = useStore()
      const s = state.source
      const userId = resolveInvokerId(s)
      const guildId = s.guildId

      return {
        get guild() {
          if (!guildId) throw new Error("g.store.guild: not in a guild")
          return store.forGuild(guildId)
        },
        get user() {
          if (!userId) throw new Error("g.store.user: no invoking user")
          return store.forUser(userId)
        },
        global: store.global,
      }
    },

    get guildConfig() {
      const guildId = state.source.guildId
      if (!guildId) throw new Error("g.guildConfig: not in a guild")
      return useStore().forGuildConfig(guildId)
    },

    canvas,
  }

  // update.* re-styles the originating component message (buttons/selects)
  if (typeof (source as DuckSource).update === "function") {
    const s = source as DuckSource
    const set = {} as StyledSenderSet
    for (const variant of Object.keys(VARIANTS) as ReplyVariant[]) {
      set[variant] = (content, opts) => {
        const { key, fallback, prefix } = VARIANTS[variant]
        const payload = state.applyFlags(
          buildStyledPayload([`${prefix}${content}`], themeColor(key, fallback)),
          opts,
        )
        const promise = (async () => {
          state.cancelAutoDefer()
          const message = await s.update!(payload)
          state.record({ variant, via: "update", payload, message, timestamp: Date.now() })
          return message
        })()
        // minimal chain: update() payloads are single-shot
        const chain: ReplyChain = {
          description: () => chain,
          field: () => chain,
          file: () => chain,
          ephemeral: () => chain,
          send: () => promise,
          then: (f, r) => promise.then(f, r),
        }
        return chain
      }
    }
    g.update = set
  }

  ctx.g = g as GlyriaG<T>

  return ctx
}
