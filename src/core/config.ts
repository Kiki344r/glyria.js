import { pathToFileURL } from "url"
import { resolve } from "path"
import { existsSync } from "fs"
import type { HexColorString } from "discord.js"
import { createJiti } from "jiti"
import type { StoreConfig } from "./store.js"

export interface GlyriaConfig {
  modules?: string[]
  /** Per-module configuration, validated by each module's `config` schema. */
  moduleConfig?: Record<string, unknown>
  /** Channel id where ctx.g.log() and framework notices are posted. */
  logChannel?: string
  /** Built-in state store (ctx.g.store). Defaults to in-memory. */
  store?: StoreConfig
  /** Record interactions to .glyria/interactions for `glyria replay`. Always on in dev. */
  recording?: boolean
  /** Post a command changelog to this channel on every deployment. */
  changelog?: {
    channel?: string
  }
  dev?: {
    autoImportDirs?: string[]
    restartPaths?: string[]
  }
  theme?: {
    embedV2?: {
      primaryColor?: HexColorString
      secondaryColor?: HexColorString
      successColor?: HexColorString
      errorColor?: HexColorString
      infoColor?: HexColorString
      warningColor?: HexColorString

      footer?: {
        text?: string
      }
    }
  }
}

let _config: GlyriaConfig = {}

export const loadConfig = async () => {
  // On récupère le sous-dossier s'il existe (ex: "Bot"), sinon chaîne vide
  const botRoot = process.env.GLYRIA_BOT_ROOT ?? ""

  // On résout le chemin en incluant le dossier racine du bot
  const path = resolve(process.cwd(), botRoot, "glyria.config.ts")

  if (!existsSync(path)) return

  const jiti = createJiti(import.meta.url)
  const mod = await jiti.import(pathToFileURL(path).href)

  _config = (mod as { default?: GlyriaConfig }).default ?? {}
}

export const useConfig = () => _config

export const defineGlyriaConfig = (config: GlyriaConfig): GlyriaConfig => config
