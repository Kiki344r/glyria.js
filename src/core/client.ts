import { Client, type ClientEvents, Events } from "discord.js"

import { mkdirSync, writeFileSync } from "fs"
import { resolve } from "path"

import type { BitFieldResolvable, GatewayIntentsString } from "discord.js"

import { GlyriaBus } from "./bus.js"

import { CommandManager } from "../managers/commands.js"
import { EventManager } from "../managers/events.js"
import { ComponentManager } from "../managers/components.js"
import { ModuleManager } from "../managers/modules.js"
import { loadModules } from "./loader.js"
import { loadConfig, useConfig } from "./config.js"
import { logger } from "./logger.js"
import { configureStore } from "./store.js"

interface GlyriaClientOptions {
  intents: BitFieldResolvable<GatewayIntentsString, number>
}

interface GlyriaProcessMessage {
  type:
    | "hotreload:commands"
    | "hotreload:events"
    | "hotreload:config"
    | "hotreload:components"
    | "hotreload:modules"
}

type globalBusEvents = {
  botReady: [Client: GlyriaClient]
}

export interface GlyriaEvents extends ClientEvents {
  "glyria:ready": [
    {
      uptime: number
      shardId: number
    },
  ]
  commandsManagerReady: []
}

export const globalBus = new GlyriaBus<globalBusEvents>()

export class GlyriaClient extends Client {
  private botToken: string

  private shuttingDown = false

  public bus = new GlyriaBus<GlyriaEvents>()

  public commandsManager = new CommandManager()
  public eventsManager = new EventManager()
  public componentsManager = new ComponentManager()
  public modulesManager = new ModuleManager()

  constructor(options: GlyriaClientOptions) {
    super(options)

    const envToken = process.env.TOKEN

    if (!envToken) {
      throw new Error("TOKEN required in .env")
    }

    this.botToken = envToken

    process.once("SIGINT", async () => {
      await this.shutdown()
    })

    process.once("SIGTERM", async () => {
      await this.shutdown()
    })
  }

  // ===== SHUTDOWN =====

  private async shutdown() {
    if (this.shuttingDown) {
      return
    }

    this.shuttingDown = true

    logger.info("Shutdown", "🛑 Bot shutting down...")

    await this.modulesManager.runUnloadAll()

    await this.destroy()

    process.exit(0)
  }

  // ===== LOGIN =====

  async login(token?: string): Promise<string> {
    configureStore(useConfig().store)

    // modules load first so their hooks observe everything else
    this.modulesManager.setClient(this)
    for (const discovered of await loadModules()) {
      this.modulesManager.register(discovered.definition, discovered.source)
    }
    await this.modulesManager.loadAll(useConfig().moduleConfig)

    this.eventsManager.setClient(this)
    await this.eventsManager.load()

    let clientReady = false
    let commandsManagerReady = false

    const checkReady = () => {
      if (clientReady && commandsManagerReady) {
        logger.ready(`${this.user?.tag}`)
      }
    }

    this.bus.on("commandsManagerReady", () => {
      commandsManagerReady = true
      checkReady()
    })

    this.once(Events.ClientReady, async () => {
      clientReady = true
      checkReady()
      await this.modulesManager.runReady()
      await globalBus.emit("botReady", this)
    })

    const loggedToken = await super.login(token ?? this.botToken)

    this.commandsManager.setClient(this).setToken(token ?? this.botToken)

    await this.commandsManager.load()
    this.commandsManager.listen()

    this.componentsManager.setClient(this)
    await this.componentsManager.load()
    this.componentsManager.listen()

    // ===== ZERO-DOWNTIME RELOAD (prod) =====
    // `glyria reload` sends SIGUSR2: handlers are swapped in memory, the
    // gateway connection never drops, no interaction is missed.
    try {
      mkdirSync(resolve(process.cwd(), ".glyria"), { recursive: true })
      writeFileSync(resolve(process.cwd(), ".glyria/bot.pid"), String(process.pid))
    } catch {
      // pid file is best-effort
    }

    if (process.platform !== "win32") {
      process.on("SIGUSR2", async () => {
        logger.hotreload("Reload", "SIGUSR2 received — zero-downtime reload")
        try {
          await loadConfig()
          await this.commandsManager.hotReload()
          await this.eventsManager.hotReload()
          await this.componentsManager.hotReload()
          await this.modulesManager.hotReload(useConfig().moduleConfig)
          logger.success("Reload", "Zero-downtime reload complete")
        } catch (error) {
          logger.error("Reload", "Zero-downtime reload failed")
          console.error(error)
        }
      })
    }

    process.on("message", async (message) => {
      const msg = message as GlyriaProcessMessage

      if (typeof msg === "object" && msg?.type === "hotreload:commands") {
        await this.commandsManager.hotReload()
      } else if (typeof msg === "object" && msg?.type === "hotreload:events") {
        await this.eventsManager.hotReload()
      } else if (typeof msg === "object" && msg?.type === "hotreload:components") {
        await this.componentsManager.hotReload()
      } else if (typeof msg === "object" && msg?.type === "hotreload:modules") {
        await this.modulesManager.hotReload(useConfig().moduleConfig)
      } else if (typeof msg === "object" && msg?.type === "hotreload:config") {
        await loadConfig()
        logger.hotreload("Watcher", "🔄 Config hot reloaded")
      }
    })

    return loggedToken
  }
}
