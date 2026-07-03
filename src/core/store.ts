// src/core/store.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, resolve } from "path"
import { logger } from "./logger.js"

// ===== ADAPTER CONTRACT =====

export interface StoreAdapter {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  keys(prefix: string): Promise<string[]>
}

// ===== MEMORY ADAPTER =====

export class MemoryStoreAdapter implements StoreAdapter {
  private data = new Map<string, unknown>()

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }
}

// ===== JSON FILE ADAPTER =====

/**
 * Zero-config persistence: keeps everything in memory and debounces writes
 * to a JSON file (.glyria/store.json by default). Good for small bots;
 * plug a real adapter (Redis, SQLite) for anything serious.
 */
export class JsonFileStoreAdapter implements StoreAdapter {
  private data = new Map<string, unknown>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private path: string,
    private flushDelay = 250,
  ) {
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
        this.data = new Map(Object.entries(raw))
      } catch {
        logger.warn("Store", `Could not parse ${path}, starting empty`)
      }
    }
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
    this.scheduleFlush()
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.data.delete(key)
    if (deleted) this.scheduleFlush()
    return deleted
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.data), null, 2))
    } catch (error) {
      logger.error("Store", `Failed to flush store to ${this.path}`)
      console.error(error)
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, this.flushDelay)
    if (typeof this.flushTimer.unref === "function") this.flushTimer.unref()
  }
}

// ===== SCOPED VIEW =====

export interface ScopedStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  keys(): Promise<string[]>
}

const scoped = (adapter: StoreAdapter, prefix: string): ScopedStore => ({
  get: async <T>(key: string) => (await adapter.get(`${prefix}${key}`)) as T | undefined,
  set: (key, value) => adapter.set(`${prefix}${key}`, value),
  delete: (key) => adapter.delete(`${prefix}${key}`),
  keys: async () => (await adapter.keys(prefix)).map((k) => k.slice(prefix.length)),
})

// ===== GLYRIA STORE =====

export class GlyriaStore {
  constructor(private adapter: StoreAdapter) {}

  /** Global (bot-wide) scope. */
  get global(): ScopedStore {
    return scoped(this.adapter, "global:")
  }

  forGuild(guildId: string): ScopedStore {
    return scoped(this.adapter, `guild:${guildId}:`)
  }

  forUser(userId: string): ScopedStore {
    return scoped(this.adapter, `user:${userId}:`)
  }

  /** Namespaced scope for modules (`module:<name>:`). */
  forModule(name: string): ScopedStore {
    return scoped(this.adapter, `module:${name}:`)
  }

  /** Per-guild configuration namespace, kept apart from regular guild data. */
  forGuildConfig(guildId: string): ScopedStore {
    return scoped(this.adapter, `guildconfig:${guildId}:`)
  }
}

// ===== SINGLETON =====

let _store: GlyriaStore | null = null

export interface StoreConfig {
  adapter?: "memory" | "json" | StoreAdapter
  /** Path of the JSON file when adapter is "json". Default: .glyria/store.json */
  path?: string
}

export const configureStore = (config: StoreConfig = {}): GlyriaStore => {
  let adapter: StoreAdapter

  if (config.adapter && typeof config.adapter === "object") {
    adapter = config.adapter
  } else if (config.adapter === "json") {
    adapter = new JsonFileStoreAdapter(
      resolve(process.cwd(), config.path ?? ".glyria/store.json"),
    )
  } else {
    adapter = new MemoryStoreAdapter()
  }

  _store = new GlyriaStore(adapter)
  return _store
}

export const useStore = (): GlyriaStore => {
  if (!_store) _store = new GlyriaStore(new MemoryStoreAdapter())
  return _store
}
