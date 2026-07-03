// src/managers/components.ts

import { loadComponents } from "../core/loader.js"
import type { GlyriaClient } from "../core/client.js"
import type { ComponentDefinition, ComponentKind } from "../builders/componentBuilder.js"
import { createReplyableContext, armAutoDefer } from "../core/context/ReplyableContext.js"
import { logger } from "../core/logger.js"

export class ComponentManager {
  private client?: GlyriaClient
  private definitions: ComponentDefinition[] = []
  private listening = false

  setClient(client: GlyriaClient) {
    this.client = client
    return this
  }

  async load() {
    this.definitions = await loadComponents()
    if (this.definitions.length) {
      logger.success("Components", `${this.definitions.length} component(s) loaded`)
    }
  }

  async hotReload() {
    logger.hotreload("Watcher", "Hot reloading components...")
    this.definitions = await loadComponents()
    logger.hotreload("Watcher", `${this.definitions.length} component(s) hot reloaded`)
  }

  listen() {
    if (!this.client) throw new Error("[Components Manager] client is not defined")
    if (this.listening) return
    this.listening = true

    this.client.on("interactionCreate", async (interaction) => {
      let kind: ComponentKind

      if (interaction.isButton()) kind = "button"
      else if (interaction.isAnySelectMenu()) kind = "select"
      else if (interaction.isModalSubmit()) kind = "modal"
      else return

      // framework-reserved ids (confirm/paginate) are handled by collectors
      if (interaction.customId.startsWith("glyria:")) return

      for (const def of this.definitions) {
        if (def.kind !== kind) continue

        const match = def.regex.exec(interaction.customId)
        if (!match) continue

        const ctx = createReplyableContext(interaction)
        armAutoDefer(ctx)

        try {
          await def.handler(ctx as never, { ...match.groups })
        } catch (error) {
          logger.error("Components", `Error while executing ${def.pattern}`)
          console.error(error)
        }
        return
      }
    })
  }
}
