// src/managers/modules.ts

import { logger } from "../core/logger.js"
import { useStore } from "../core/store.js"
import { loadModules } from "../core/loader.js"
import { isModuleDefinition } from "../sdk/defineModule.js"
import type {
  BrandedModule,
  CommandRunMeta,
  ModuleContext,
  ModuleHooks,
} from "../sdk/defineModule.js"
import type { GlyriaClient } from "../core/client.js"
import type { GlyriaContext, Replyable } from "../core/context/ReplyableContext.js"

export type ModuleStatus = "active" | "disabled" | "error"

export interface LoadedModule {
  definition: BrandedModule
  status: ModuleStatus
  /** Public API returned by setup(). */
  api: unknown
  context: ModuleContext
  /** Where the module was imported from (for hot-swap). */
  source?: string | undefined
  errorCount: number
  statusReason?: string | undefined
}

/** Consecutive runtime hook errors before a module is auto-disabled. */
const MAX_HOOK_ERRORS = 5

// ===== TOPO SORT =====

export const resolveLoadOrder = (
  definitions: BrandedModule[],
): { order: BrandedModule[]; failed: { name: string; reason: string }[] } => {
  const byName = new Map(definitions.map((d) => [d.name, d]))
  const order: BrandedModule[] = []
  const failed: { name: string; reason: string }[] = []
  const state = new Map<string, "visiting" | "done" | "failed">()

  const visit = (def: BrandedModule, chain: string[]): boolean => {
    const s = state.get(def.name)
    if (s === "done") return true
    if (s === "failed") return false
    if (s === "visiting") {
      failed.push({ name: def.name, reason: `dependency cycle: ${[...chain, def.name].join(" → ")}` })
      state.set(def.name, "failed")
      return false
    }

    state.set(def.name, "visiting")

    for (const dep of def.dependsOn ?? []) {
      const target = byName.get(dep)
      if (!target) {
        failed.push({ name: def.name, reason: `missing dependency "${dep}"` })
        state.set(def.name, "failed")
        return false
      }
      if (!visit(target, [...chain, def.name])) {
        if (state.get(def.name) !== "failed") {
          failed.push({ name: def.name, reason: `dependency "${dep}" failed to load` })
          state.set(def.name, "failed")
        }
        return false
      }
    }

    state.set(def.name, "done")
    order.push(def)
    return true
  }

  for (const def of definitions) visit(def, [])
  return { order, failed }
}

// ===== MANAGER =====

export class ModuleManager {
  private client?: GlyriaClient
  private modules = new Map<string, LoadedModule>()
  private pendingDefinitions: { definition: BrandedModule; source?: string | undefined }[] = []
  private listening = false

  setClient(client: GlyriaClient) {
    this.client = client
    return this
  }

  /** Queue a module definition (from the loader or programmatically). */
  register(definition: unknown, source?: string): boolean {
    if (!isModuleDefinition(definition)) return false
    this.pendingDefinitions.push({ definition, source })
    return true
  }

  // ===== LOADING =====

  async loadAll(moduleConfig: Record<string, unknown> = {}) {
    if (!this.client) throw new Error("[Modules Manager] client is not defined")

    const sources = new Map(this.pendingDefinitions.map((p) => [p.definition.name, p.source]))
    const { order, failed } = resolveLoadOrder(this.pendingDefinitions.map((p) => p.definition))
    this.pendingDefinitions = []

    for (const failure of failed) {
      logger.error("Modules", `${failure.name} disabled: ${failure.reason}`)
      this.modules.set(failure.name, {
        definition: { name: failure.name } as BrandedModule,
        status: "error",
        api: undefined,
        context: undefined as unknown as ModuleContext,
        errorCount: 0,
        statusReason: failure.reason,
      })
    }

    for (const definition of order) {
      await this.loadOne(definition, moduleConfig[definition.name], sources.get(definition.name))
    }

    const active = [...this.modules.values()].filter((m) => m.status === "active").length
    if (this.modules.size) {
      logger.success("Modules", `${active}/${this.modules.size} module(s) active`)
    }

    this.bridgeGuildEvents()
  }

  private async loadOne(definition: BrandedModule, rawConfig: unknown, source?: string) {
    let config: unknown = rawConfig ?? definition.defaultConfig

    try {
      if (definition.config) {
        config =
          typeof definition.config === "function"
            ? definition.config(config)
            : definition.config.parse(config)
      }
    } catch (error) {
      logger.error("Modules", `${definition.name} disabled: invalid config`)
      console.error(error)
      this.modules.set(definition.name, {
        definition,
        status: "error",
        api: undefined,
        context: undefined as unknown as ModuleContext,
        source,
        errorCount: 0,
        statusReason: "invalid config",
      })
      return
    }

    const context = this.createContext(definition.name, config)
    const loaded: LoadedModule = {
      definition,
      status: "active",
      api: undefined,
      context,
      source,
      errorCount: 0,
    }
    this.modules.set(definition.name, loaded)

    // a crashing module must never take the bot down
    try {
      await definition.hooks?.onLoad?.(context)
      loaded.api = (await definition.setup?.(context)) ?? {}
    } catch (error) {
      loaded.status = "error"
      loaded.statusReason = "setup crashed"
      logger.error("Modules", `${definition.name} disabled: setup crashed`)
      console.error(error)
      await this.safeErrorHook(loaded, error)
    }
  }

  private createContext(name: string, config: unknown): ModuleContext {
    const client = this.client!
    const registry = this.modules

    return {
      name,
      client,
      config,
      store: useStore().forModule(name),
      logger: {
        info: (message: string) => logger.info(`mod:${name}`, message),
        warn: (message: string) => logger.warn(`mod:${name}`, message),
        error: (message: string) => logger.error(`mod:${name}`, message),
      },
      modules: {
        get: ((target: string) => {
          const found = registry.get(target)
          if (!found || found.status !== "active") {
            throw new Error(`modules.get("${target}"): module not loaded or inactive`)
          }
          return found.api
        }) as ModuleContext["modules"]["get"],
        has: (target: string) => registry.get(target)?.status === "active",
      },
    }
  }

  // ===== HOT RELOAD (all) =====

  async hotReload(moduleConfig: Record<string, unknown> = {}) {
    logger.hotreload("Watcher", "Hot reloading modules...")
    await this.runUnloadAll()
    this.modules.clear()

    for (const discovered of await loadModules()) {
      this.register(discovered.definition, discovered.source)
    }
    await this.loadAll(moduleConfig)
    logger.hotreload("Watcher", "Modules hot reloaded")
  }

  // ===== HOT-SWAP =====

  /** Reload a single module in place — hooks re-registered, others untouched. */
  async reload(name: string, moduleConfig: Record<string, unknown> = {}): Promise<boolean> {
    const current = this.modules.get(name)
    if (!current) return false

    await this.runHookFor(current, "onUnload")

    let definition = current.definition
    if (current.source) {
      try {
        const mod = await import(`${current.source}?update=${Date.now()}`)
        const fresh = (mod as { default?: unknown }).default
        if (isModuleDefinition(fresh)) definition = fresh
      } catch (error) {
        logger.error("Modules", `${name}: hot-swap re-import failed`)
        console.error(error)
        return false
      }
    }

    this.modules.delete(name)
    await this.loadOne(definition, moduleConfig[name], current.source)
    logger.hotreload("Modules", `${name} hot-swapped`)
    return this.modules.get(name)?.status === "active"
  }

  // ===== INTROSPECTION =====

  list(): {
    name: string
    version?: string | undefined
    status: ModuleStatus
    reason?: string | undefined
    hooks: string[]
  }[] {
    return [...this.modules.values()].map((m) => ({
      name: m.definition.name,
      version: m.definition.version,
      status: m.status,
      reason: m.statusReason,
      hooks: Object.keys(m.definition.hooks ?? {}),
    }))
  }

  getApi(name: string): unknown {
    return this.modules.get(name)?.api
  }

  // ===== HOOK EXECUTION =====

  private active(): LoadedModule[] {
    return [...this.modules.values()].filter((m) => m.status === "active")
  }

  private async safeErrorHook(loaded: LoadedModule, error: unknown) {
    try {
      await loaded.definition.hooks?.onError?.(loaded.context, error)
    } catch {
      // an onError hook that itself throws is dropped
    }
  }

  private async runHookFor(
    loaded: LoadedModule,
    hook: "onLoad" | "onReady" | "onUnload",
  ): Promise<void> {
    const fn = loaded.definition.hooks?.[hook]
    if (!fn) return
    try {
      await fn(loaded.context)
    } catch (error) {
      this.recordHookError(loaded, hook, error)
    }
  }

  private recordHookError(loaded: LoadedModule, hook: string, error: unknown) {
    loaded.errorCount += 1
    logger.error("Modules", `${loaded.definition.name}.${hook} threw (${loaded.errorCount}/${MAX_HOOK_ERRORS})`)
    console.error(error)
    void this.safeErrorHook(loaded, error)

    if (loaded.errorCount >= MAX_HOOK_ERRORS) {
      loaded.status = "disabled"
      loaded.statusReason = `auto-disabled after ${MAX_HOOK_ERRORS} hook errors`
      logger.error("Modules", `${loaded.definition.name} auto-disabled (too many errors)`)
    }
  }

  async runReady(): Promise<void> {
    for (const loaded of this.active()) await this.runHookFor(loaded, "onReady")
  }

  async runUnloadAll(): Promise<void> {
    for (const loaded of this.active()) await this.runHookFor(loaded, "onUnload")
  }

  /**
   * Koa-style middleware chain over every active module's beforeCommand.
   * Returns true when the whole chain called through (command may run).
   */
  async runBeforeCommand(ctx: GlyriaContext<Replyable>, meta: CommandRunMeta): Promise<boolean> {
    const chain = this.active()
      .map((m) => ({ loaded: m, fn: m.definition.hooks?.beforeCommand }))
      .filter((e): e is { loaded: LoadedModule; fn: NonNullable<ModuleHooks["beforeCommand"]> } =>
        Boolean(e.fn),
      )

    let reached = false

    const dispatch = async (i: number): Promise<void> => {
      if (i === chain.length) {
        reached = true
        return
      }
      const { loaded, fn } = chain[i]!
      try {
        let nextCalled = false
        await fn(ctx, meta, async () => {
          nextCalled = true
          await dispatch(i + 1)
        })
        // not calling next() cancels the pipeline silently (module replied already)
        void nextCalled
      } catch (error) {
        this.recordHookError(loaded, "beforeCommand", error)
        // a crashing middleware must not block every command: continue the chain
        await dispatch(i + 1)
      }
    }

    await dispatch(0)
    return reached
  }

  async runAfterCommand(
    ctx: GlyriaContext<Replyable>,
    meta: CommandRunMeta,
    result: unknown,
  ): Promise<void> {
    for (const loaded of this.active()) {
      const fn = loaded.definition.hooks?.afterCommand
      if (!fn) continue
      try {
        await fn(ctx, meta, result)
      } catch (error) {
        this.recordHookError(loaded, "afterCommand", error)
      }
    }
  }

  async runCommandRun(ctx: GlyriaContext<Replyable>, meta: CommandRunMeta): Promise<void> {
    for (const loaded of this.active()) {
      const fn = loaded.definition.hooks?.onCommandRun
      if (!fn) continue
      try {
        await fn(ctx, meta)
      } catch (error) {
        this.recordHookError(loaded, "onCommandRun", error)
      }
    }
  }

  async runError(error: unknown): Promise<void> {
    for (const loaded of this.active()) {
      await this.safeErrorHook(loaded, error)
    }
  }

  // ===== GUILD EVENTS =====

  private bridgeGuildEvents() {
    if (!this.client || this.listening) return
    this.listening = true

    this.client.on("guildCreate", async (guild) => {
      for (const loaded of this.active()) {
        const fn = loaded.definition.hooks?.onGuildJoin
        if (!fn) continue
        try {
          await fn(loaded.context, guild)
        } catch (error) {
          this.recordHookError(loaded, "onGuildJoin", error)
        }
      }
    })

    this.client.on("guildDelete", async (guild) => {
      for (const loaded of this.active()) {
        const fn = loaded.definition.hooks?.onGuildLeave
        if (!fn) continue
        try {
          await fn(loaded.context, guild)
        } catch (error) {
          this.recordHookError(loaded, "onGuildLeave", error)
        }
      }
    })
  }
}
