// src/managers/commands.ts
import { REST, Routes } from "discord.js"
import type { PermissionResolvable } from "discord.js"
import { loadCommands } from "../core/loader.js"
import type { LoadedCommand } from "../core/loader.js"
import type { GlyriaClient } from "../core/client.js"
import type {
  CommandHandler,
  AutocompleteHandler,
  AutocompleteChoice,
} from "../builders/commandBuilder.js"
import { logger } from "../core/logger.js"
import { clearCommandRegistry } from "../builders/commandBuilder.js"
import { createReplyableContext, armAutoDefer } from "../core/context/ReplyableContext.js"
import { CooldownStore, runGuards } from "../core/guards.js"
import type { PermissionName } from "../core/guards.js"
import { diffCommandBodies, isDiffEmpty } from "../core/commandDiff.js"
import type { NamedCommand } from "../core/commandDiff.js"
import { postCommandChangelog } from "../core/changelog.js"
import { isRecordingEnabled, recordInteraction } from "../core/recorder.js"

export class CommandManager {
  private client?: GlyriaClient
  private token?: string
  private handlers = new Map<string, CommandHandler>()
  private autocompletes = new Map<string, AutocompleteHandler>()
  private commands: LoadedCommand[] = []
  private listening = false
  private cooldowns = new CooldownStore()
  private ownerIds: Set<string> | null = null
  private lastRegisteredBody: string | null = null

  // ===== SETTERS =====
  setClient(client: GlyriaClient) {
    this.client = client
    return this
  }

  setToken(token: string) {
    this.token = token
    return this
  }

  // ===== LOAD =====
  async load() {
    if (!this.client) throw new Error("[Commands Manager] client is not defined")
    if (!this.token) throw new Error("[Commands Manager] token is not defined")

    clearCommandRegistry()
    this.commands = await loadCommands()
    this.indexHandlers()

    await this.registerDiscordCommands()
    logger.success("Commands Manager", `${this.commands.length} command(s) loaded`)
    await this.client.bus.emit("commandsManagerReady")
  }

  // ===== HOT RELOAD =====
  async hotReload() {
    if (!this.client) throw new Error("[Commands Manager] client is not defined")
    if (!this.token) throw new Error("[Commands Manager] token is not defined")

    logger.hotreload("Watcher", "Hot reloading commands...")

    clearCommandRegistry()
    this.commands = await loadCommands()
    this.indexHandlers()

    await this.registerDiscordCommands()
    logger.hotreload("Watcher", "Commands hot reloaded")
  }

  private indexHandlers() {
    this.handlers.clear()
    this.autocompletes.clear()

    for (const cmd of this.commands) {
      for (const handler of cmd.handlers) {
        this.handlers.set(handler.name, handler)
      }
      for (const autocomplete of cmd.autocompletes) {
        this.autocompletes.set(autocomplete.name, autocomplete.handler)
      }
    }
  }

  // ===== REGISTER =====
  private async registerDiscordCommands() {
    if (!this.client) throw new Error("[Commands Manager] client is not defined")
    if (!this.token) throw new Error("[Commands Manager] token is not defined")

    const applicationId = this.client.user?.id
    if (!applicationId) {
      throw new Error("[Commands Manager] client is not logged in, cannot register commands")
    }

    const body = this.commands.map((c) => c.json)
    const serialized = JSON.stringify(body)

    // only hit the Discord API when the command payload actually changed
    if (this.lastRegisteredBody !== null) {
      const diff = diffCommandBodies(
        JSON.parse(this.lastRegisteredBody) as NamedCommand[],
        body as unknown as NamedCommand[],
      )

      if (isDiffEmpty(diff)) {
        logger.info("Commands Manager", "No command changes, skipping Discord re-register")
        return
      }

      const summary = [
        ...diff.added.map((n) => `+${n}`),
        ...diff.changed.map((n) => `~${n}`),
        ...diff.removed.map((n) => `-${n}`),
      ].join(" ")
      logger.info("Commands Manager", `Re-registering: ${summary}`)
    }

    const rest = new REST().setToken(this.token)
    await rest.put(Routes.applicationCommands(applicationId), { body })
    this.lastRegisteredBody = serialized

    // snapshot + auto-changelog (only posts when a channel is configured)
    await postCommandChangelog(this.client, body as unknown as NamedCommand[])
  }

  // ===== OWNER =====
  private async isOwner(userId: string): Promise<boolean> {
    if (!this.ownerIds) {
      const application = await this.client?.application?.fetch()
      const ids = new Set<string>()
      const owner = application?.owner

      if (owner) {
        if ("members" in owner) {
          for (const member of owner.members.values()) ids.add(member.id)
        } else {
          ids.add(owner.id)
        }
      }

      this.ownerIds = ids
    }

    return this.ownerIds.has(userId)
  }

  // ===== LISTENER =====
  listen() {
    if (!this.client) throw new Error("[Commands Manager] client is not defined")
    if (this.listening) return
    this.listening = true

    this.client.on("interactionCreate", async (interaction) => {
      let key: string
      let entry: CommandHandler | undefined

      if (interaction.isAutocomplete()) {
        const subCommandGroup = interaction.options.getSubcommandGroup(false)
        const subCommand = interaction.options.getSubcommand(false)
        const path = subCommandGroup
          ? `${interaction.commandName}:${subCommandGroup}:${subCommand}`
          : subCommand
            ? `${interaction.commandName}:${subCommand}`
            : interaction.commandName

        const focused = interaction.options.getFocused(true)
        const handler = this.autocompletes.get(`${path}::${focused.name}`)
        if (!handler) return

        try {
          const choices = await handler(String(focused.value), interaction)
          await interaction.respond(
            choices.slice(0, 25).map((c: AutocompleteChoice) =>
              typeof c === "object" ? c : { name: String(c), value: c },
            ),
          )
        } catch (error) {
          logger.error("Commands Manager", `Autocomplete error for ${path}::${focused.name}`)
          console.error(error)
        }
        return
      }

      if (interaction.isChatInputCommand()) {
        const subCommandGroup = interaction.options.getSubcommandGroup(false)
        const subCommand = interaction.options.getSubcommand(false)
        key = subCommandGroup
          ? `${interaction.commandName}:${subCommandGroup}:${subCommand}`
          : subCommand
            ? `${interaction.commandName}:${subCommand}`
            : interaction.commandName
        entry = this.handlers.get(key)
      } else if (interaction.isUserContextMenuCommand()) {
        entry = this.handlers.get(interaction.commandName)
        key = interaction.commandName
      } else if (interaction.isMessageContextMenuCommand()) {
        entry = this.handlers.get(interaction.commandName)
        key = interaction.commandName
      } else {
        return
      }

      if (!entry) return

      const ctx = createReplyableContext(interaction)
      let executionError: unknown

      try {
        if (entry.guards) {
          const denial = await runGuards(entry.guards, key, this.cooldowns, {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            missingPermissions: (permissions: PermissionName[]) =>
              interaction.memberPermissions?.missing(permissions as PermissionResolvable) ?? null,
            isOwner: () => this.isOwner(interaction.user.id),
          })

          if (denial) {
            await ctx.g.reply.error(denial, { ephemeral: true })
            return
          }
        }

        const meta = { name: key, kind: entry.kind }
        const modules = this.client!.modulesManager

        // module middleware pipeline — a module that skips next() cancels the run
        await modules.runCommandRun(ctx as never, meta)
        const proceed = await modules.runBeforeCommand(ctx as never, meta)
        if (!proceed) return

        // slow handlers get an automatic deferReply before Discord's 3s window closes
        armAutoDefer(ctx)

        // the handler union narrows per interaction kind at registration time;
        // the map erases that link, so the call site widens the argument
        const result = await entry.handler(ctx as never)

        await modules.runAfterCommand(ctx as never, meta, result)
      } catch (error) {
        executionError = error
        logger.error("Commands Manager", `Error while executing ${key}`)
        console.error(error)
        await this.client!.modulesManager.runError(error)
      }

      if (isRecordingEnabled()) {
        this.recordRun(interaction, ctx, key, entry.kind, executionError)
      }
    })
  }

  // ===== TIME-TRAVEL RECORDING =====

  private recordRun(
    interaction: {
      id: string
      user: { id: string; username?: string }
      guildId: string | null
      channelId: string | null
      isChatInputCommand(): boolean
      options?: { data?: unknown }
    },
    ctx: ReturnType<typeof createReplyableContext>,
    key: string,
    kind: "chat" | "user" | "message",
    error: unknown,
  ) {
    const options: Record<string, unknown> = {}
    const subcommand: string[] = []

    const walk = (data: unknown) => {
      if (!Array.isArray(data)) return
      for (const opt of data as { name: string; type: number; value?: unknown; options?: unknown }[]) {
        if (opt.type === 1 || opt.type === 2) {
          subcommand.push(opt.name)
          walk(opt.options)
        } else {
          options[opt.name] = opt.value
        }
      }
    }
    if (interaction.isChatInputCommand()) walk(interaction.options?.data)

    recordInteraction({
      id: interaction.id,
      key,
      kind,
      userId: interaction.user.id,
      ...(interaction.user.username && { username: interaction.user.username }),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      options,
      subcommand,
      createdAt: Date.now(),
      replies: ctx.g.history().map((e) => ({
        via: e.via,
        payload: e.payload,
        timestamp: e.timestamp,
      })),
      ...(error !== undefined && { error: String(error) }),
    })
  }
}
