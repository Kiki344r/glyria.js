// src/sdk/defineModule.ts

import type { GlyriaClient } from "../core/client.js"
import type { GlyriaContext, Replyable } from "../core/context/ReplyableContext.js"
import type { ScopedStore } from "../core/store.js"
import { GlyriaCommand } from "../builders/commandBuilder.js"
import { GlyriaEvent } from "../builders/eventBuilder.js"

// ===== INTER-MODULE TYPING =====

/**
 * Augment this interface to get typed inter-module APIs:
 *
 *   declare module "@glyria/bot" {
 *     interface GlyriaModules {
 *       economy: { addBalance(userId: string, amount: number): Promise<void> }
 *     }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GlyriaModules {}

export interface ModuleRegistryAccess {
  get<K extends keyof GlyriaModules>(name: K): GlyriaModules[K]
  get(name: string): unknown
  has(name: string): boolean
}

// ===== MODULE CONTEXT =====

export interface ModuleLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface ModuleContext<C = unknown> {
  name: string
  client: GlyriaClient
  /** Validated config for this module (from glyria.config.ts `moduleConfig`). */
  config: C
  /** Store scoped to this module (`module:<name>:`). */
  store: ScopedStore
  logger: ModuleLogger
  /** Access other modules' public APIs. */
  modules: ModuleRegistryAccess
}

// ===== HOOKS =====

export interface CommandRunMeta {
  /** Fully-resolved command key, e.g. "config:theme:set". */
  name: string
  kind: "chat" | "user" | "message"
}

export type CommandMiddleware = (
  ctx: GlyriaContext<Replyable>,
  meta: CommandRunMeta,
  next: () => Promise<void>,
) => unknown

export interface ModuleHooks<C = unknown> {
  onLoad?(ctx: ModuleContext<C>): unknown
  onReady?(ctx: ModuleContext<C>): unknown
  onUnload?(ctx: ModuleContext<C>): unknown
  onError?(ctx: ModuleContext<C>, error: unknown): unknown
  onGuildJoin?(ctx: ModuleContext<C>, guild: unknown): unknown
  onGuildLeave?(ctx: ModuleContext<C>, guild: unknown): unknown
  /** Global middleware: runs before EVERY command. Skip next() to cancel. */
  beforeCommand?: CommandMiddleware
  /** Runs after every command handler completes. */
  afterCommand?(ctx: GlyriaContext<Replyable>, meta: CommandRunMeta, result: unknown): unknown
  onCommandRun?(ctx: GlyriaContext<Replyable>, meta: CommandRunMeta): unknown
}

// ===== CONFIG VALIDATION =====

/** Zod-compatible: anything with .parse(), or a plain validation function. */
export type ConfigSchema<C> = { parse(input: unknown): C } | ((input: unknown) => C)

// ===== DEFINITION =====

export interface ModuleDefinition<C = unknown> {
  name: string
  version?: string
  description?: string
  /** Names of modules that must load before this one. */
  dependsOn?: string[]
  /** Validates the module's entry in `moduleConfig`. Zod schemas work as-is. */
  config?: ConfigSchema<C>
  defaultConfig?: unknown
  /** Entry point — returns the module's public API (consumable via ctx.modules.get). */
  setup?(ctx: ModuleContext<C>): unknown
  hooks?: ModuleHooks<C>
}

const MODULE_BRAND = Symbol.for("glyria.module")

export interface BrandedModule<C = unknown> extends ModuleDefinition<C> {
  [MODULE_BRAND]: true
}

export const defineModule = <C = unknown>(def: ModuleDefinition<C>): BrandedModule<C> => {
  if (!def.name) throw new Error("defineModule: name is required")
  return { ...def, [MODULE_BRAND]: true }
}

export const isModuleDefinition = (value: unknown): value is BrandedModule =>
  typeof value === "object" && value !== null && MODULE_BRAND in value

// ===== SDK PRIMITIVES =====
// Thin, typed entry points for module authors — same builders, stricter intent.

export const defineCommand = (fn: (cmd: GlyriaCommand) => GlyriaCommand): GlyriaCommand =>
  fn(new GlyriaCommand())

export const defineEvent = (fn: (event: GlyriaEvent) => GlyriaEvent): GlyriaEvent =>
  fn(new GlyriaEvent())

export const defineHook = <C = unknown>(hooks: ModuleHooks<C>): ModuleHooks<C> => hooks
