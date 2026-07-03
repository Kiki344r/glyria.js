import { readdirSync, existsSync } from "fs"
import { resolve } from "path"
import { pathToFileURL } from "url"
import {
  GlyriaCommand,
  GlyriaUserCommand,
  GlyriaMessageCommand,
} from "../builders/commandBuilder.js"
import { GlyriaButton, GlyriaSelect, GlyriaModal } from "../builders/componentBuilder.js"
import type { ComponentDefinition } from "../builders/componentBuilder.js"
import { useConfig } from "./config.js"
import type { AnyArgs } from "../types/handlers.js"

const isDev = process.env.GLYRIA_DEV === "true"
const ext = isDev ? ".ts" : ".js"

// On récupère le préfixe s'il existe (ex: "Bot"), sinon chaîne vide
const botRoot = process.env.GLYRIA_BOT_ROOT ? `${process.env.GLYRIA_BOT_ROOT}/` : ""

// On applique le préfixe sur les dossiers du bot, mais PAS sur les node_modules
const commandsDir = isDev ? `${botRoot}src/commands` : `${botRoot}dist/src/commands`
const eventsDir = isDev ? `${botRoot}src/events` : `${botRoot}dist/src/events`
const componentsDir = isDev ? `${botRoot}src/components` : `${botRoot}dist/src/components`
const modulesDir = isDev ? `${botRoot}src/modules` : `${botRoot}dist/src/modules`

export interface LoadedCommand {
  json: ReturnType<
    GlyriaCommand["build"] | GlyriaUserCommand["build"] | GlyriaMessageCommand["build"]
  >
  handlers: ReturnType<GlyriaCommand["getHandlers"]>
  autocompletes: ReturnType<GlyriaCommand["getAutocompletes"]>
}

export interface LoadedEvent {
  name: string
  once: boolean
  handler: (...args: AnyArgs) => unknown
}

/** Local module folders (src/modules/<name>) that may carry their own commands/events/components. */
const localModuleDirs = (): string[] => {
  const dir = resolve(modulesDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => resolve(dir, e.name))
}

const resolveModuleDir = (moduleName: string): string | null => {
  // Les modules restent dans le node_modules global du projet (pas dans Bot/node_modules)
  const base = resolve(process.cwd(), "node_modules", moduleName)

  const distSrc = resolve(base, "dist/src")
  const dist = resolve(base, "dist")
  const src = resolve(base, "src")

  if (isDev && existsSync(resolve(base, "src"))) return src

  if (existsSync(distSrc)) return distSrc
  if (existsSync(dist)) return dist
  if (existsSync(src)) return src

  return null
}

interface GlyriaCommandLike {
  build(): unknown
  getHandlers(): unknown
  getAutocompletes?(): unknown
}

// instanceof plus a structural fallback: a duplicated framework instance
// (nested node_modules, path-based imports) must not silently drop commands
const isGlyriaCommandLike = (cmd: unknown): cmd is GlyriaCommandLike => {
  if (
    cmd instanceof GlyriaCommand ||
    cmd instanceof GlyriaUserCommand ||
    cmd instanceof GlyriaMessageCommand
  ) {
    return true
  }

  if (typeof cmd !== "object" || cmd === null) return false
  const candidate = cmd as Partial<GlyriaCommandLike> & { constructor?: { name?: string } }
  return (
    typeof candidate.build === "function" &&
    typeof candidate.getHandlers === "function" &&
    ["GlyriaCommand", "GlyriaUserCommand", "GlyriaMessageCommand"].includes(
      candidate.constructor?.name ?? "",
    )
  )
}

export const loadCommands = async (): Promise<LoadedCommand[]> => {
  const loaded: LoadedCommand[] = []

  const scanDir = async (path: string) => {
    const entries = readdirSync(path, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(resolve(path, entry.name))
      } else if (entry.name.endsWith(ext)) {
        const fileUrl = pathToFileURL(resolve(path, entry.name)).href

        const mod = await import(`${fileUrl}?update=${Date.now()}`)
        const cmd = mod.default

        if (isGlyriaCommandLike(cmd)) {
          loaded.push({
            json: cmd.build() as LoadedCommand["json"],
            handlers: cmd.getHandlers() as LoadedCommand["handlers"],
            autocompletes: (cmd.getAutocompletes?.() ?? []) as LoadedCommand["autocompletes"],
          })
        }
      }
    }
  }

  if (existsSync(resolve(commandsDir))) {
    await scanDir(resolve(commandsDir))
  }

  // ===== MODULES =====
  const config = useConfig()

  for (const moduleName of config.modules ?? []) {
    const moduleDir = resolveModuleDir(moduleName)
    if (!moduleDir) continue

    const moduleCommandsDir = resolve(moduleDir, "commands")
    if (existsSync(moduleCommandsDir)) {
      await scanDir(moduleCommandsDir)
    }
  }

  for (const localDir of localModuleDirs()) {
    const localCommandsDir = resolve(localDir, "commands")
    if (existsSync(localCommandsDir)) {
      await scanDir(localCommandsDir)
    }
  }

  return loaded
}

export const loadComponents = async (): Promise<ComponentDefinition[]> => {
  const loaded: ComponentDefinition[] = []

  const scanDir = async (path: string) => {
    const entries = readdirSync(path, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(resolve(path, entry.name))
      } else if (entry.name.endsWith(ext)) {
        const fileUrl = pathToFileURL(resolve(path, entry.name)).href
        const mod = await import(`${fileUrl}?update=${Date.now()}`)

        // a file may export one component (default) or several (named)
        for (const exported of Object.values(mod as Record<string, unknown>)) {
          if (
            exported instanceof GlyriaButton ||
            exported instanceof GlyriaSelect ||
            exported instanceof GlyriaModal
          ) {
            loaded.push(exported.build())
          }
        }
      }
    }
  }

  if (existsSync(resolve(componentsDir))) {
    await scanDir(resolve(componentsDir))
  }

  // ===== MODULES =====
  const config = useConfig()

  for (const moduleName of config.modules ?? []) {
    const moduleDir = resolveModuleDir(moduleName)
    if (!moduleDir) continue

    const moduleComponentsDir = resolve(moduleDir, "components")
    if (existsSync(moduleComponentsDir)) {
      await scanDir(moduleComponentsDir)
    }
  }

  for (const localDir of localModuleDirs()) {
    const localComponentsDir = resolve(localDir, "components")
    if (existsSync(localComponentsDir)) {
      await scanDir(localComponentsDir)
    }
  }

  return loaded
}

export interface DiscoveredModule {
  definition: unknown
  source: string
}

/**
 * Discovers module definitions:
 * - local: src/modules/<name>/index.ts or src/modules/<name>.ts
 * - npm (config.modules): <pkg>/glyria.module.{ts,js} or <pkg>/index.{ts,js}
 */
export const loadModules = async (): Promise<DiscoveredModule[]> => {
  const discovered: DiscoveredModule[] = []

  const tryImport = async (path: string): Promise<boolean> => {
    if (!existsSync(path)) return false
    const fileUrl = pathToFileURL(path).href
    const mod = await import(`${fileUrl}?update=${Date.now()}`)
    const def = (mod as { default?: unknown }).default
    if (def) {
      discovered.push({ definition: def, source: fileUrl })
      return true
    }
    return false
  }

  const localDir = resolve(modulesDir)
  if (existsSync(localDir)) {
    for (const entry of readdirSync(localDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await tryImport(resolve(localDir, entry.name, `index${ext}`))
      } else if (entry.name.endsWith(ext)) {
        await tryImport(resolve(localDir, entry.name))
      }
    }
  }

  const config = useConfig()
  for (const moduleName of config.modules ?? []) {
    const moduleDir = resolveModuleDir(moduleName)
    if (!moduleDir) continue

    const foundManifest = await tryImport(resolve(moduleDir, `glyria.module${ext}`))
    if (!foundManifest) await tryImport(resolve(moduleDir, `index${ext}`))
  }

  return discovered
}

export const loadEvents = async (): Promise<LoadedEvent[]> => {
  const loaded: LoadedEvent[] = []

  const scanDir = async (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name)

      if (entry.isDirectory()) {
        await scanDir(fullPath)
        continue
      }

      if (!entry.name.endsWith(ext)) continue

      const fileUrl = pathToFileURL(fullPath).href

      const mod = await import(`${fileUrl}?update=${Date.now()}`)
      const cmd = mod?.default

      if (!cmd || typeof cmd.build !== "function") continue

      const built = cmd.build()

      loaded.push({
        name: built.event,
        once: built.once,
        handler: built.handler,
      })
    }
  }

  if (existsSync(eventsDir)) {
    await scanDir(resolve(eventsDir))
  }

  // ===== MODULES =====
  const config = useConfig()

  for (const moduleName of config.modules ?? []) {
    const moduleDir = resolveModuleDir(moduleName)
    if (!moduleDir) continue

    const moduleEventsDir = resolve(moduleDir, "events")
    if (existsSync(moduleEventsDir)) {
      await scanDir(moduleEventsDir)
    }
  }

  for (const localDir of localModuleDirs()) {
    const localEventsDir = resolve(localDir, "events")
    if (existsSync(localEventsDir)) {
      await scanDir(localEventsDir)
    }
  }

  return loaded
}
