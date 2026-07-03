// src/managers/events.ts

import { Events, type ClientEvents } from "discord.js"

import { loadEvents } from "../core/loader.js"

import type { LoadedEvent } from "../core/loader.js"

import type { GlyriaClient, GlyriaEvents } from "../core/client.js"

import type { AnyArgs } from "../types/handlers.js"

import { logger } from "../core/logger.js"

import { createReplyableContext } from "../core/context/ReplyableContext.js"

export class EventManager {
  private client?: GlyriaClient

  private events: LoadedEvent[] = []

  // unsubscribe functions of user listeners
  private unsubscribers: (() => void)[] = []

  // listeners bridge djs
  private bridgeListeners = new Map<string, (...args: AnyArgs) => void>()

  // ===== SET CLIENT =====

  setClient(client: GlyriaClient) {
    this.client = client

    return this
  }

  // ===== LOAD =====

  async load() {
    if (!this.client) {
      throw new Error("[Events Manager] client is not defined")
    }

    // bridge DJS -> BUS
    this.bridgeDiscordEvents()

    // load user events
    this.events = await loadEvents()

    // register user events
    this.registerEvents()

    logger.success("Events Manager", `${this.events.length} event(s) loaded`)
  }

  // ===== HOT RELOAD =====

  async hotReload() {
    if (!this.client) {
      throw new Error("[Events Manager] client is not defined")
    }

    logger.hotreload("Watcher", "Hot reloading events...")

    // unregister user listeners without touching listeners registered elsewhere
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }

    this.unsubscribers = []

    // reload events
    this.events = await loadEvents()

    // re-register
    this.registerEvents()

    logger.hotreload("Watcher", `${this.events.length} event(s) hot reloaded`)
  }

  // ===== DISCORD.JS BRIDGE =====

  private bridgeDiscordEvents() {
    if (!this.client) {
      return
    }

    const events = Object.values(Events) as (keyof ClientEvents)[]

    for (const event of events) {
      // évite double bridge
      if (this.bridgeListeners.has(event)) {
        continue
      }

      const listener = async (...args: AnyArgs) => {
        try {
          // ===== EMIT BUS =====

          await this.client?.bus.emit(event, ...(args as GlyriaEvents[typeof event]))
        } catch (error) {
          logger.error("Events Manager", `❌ Error while bridging ${event}`)

          console.error(error)
        }
      }

      this.bridgeListeners.set(event, listener)

      this.client.on(event, listener)
    }
  }

  // ===== REGISTER USER EVENTS =====

  private registerEvents() {
    if (!this.client) {
      throw new Error("[Events Manager] client is not defined")
    }

    for (const event of this.events) {
      const listener = async (...args: AnyArgs) => {
        try {
          // any replyable payload (message, interaction) gets ctx.g for free
          const wrapped = args.map((arg) =>
            arg && typeof (arg as { reply?: unknown }).reply === "function"
              ? createReplyableContext(arg as Parameters<typeof createReplyableContext>[0])
              : arg,
          )
          await event.handler(...(wrapped as AnyArgs))
        } catch (error) {
          logger.error("Events Manager", `Error in event ${event.name}`)

          console.error(error)
        }
      }

      // ===== REGISTER BUS =====

      const name = event.name as keyof GlyriaEvents

      const off = event.once
        ? this.client.bus.once(name, listener)
        : this.client.bus.on(name, listener)

      this.unsubscribers.push(off)
    }
  }
}
