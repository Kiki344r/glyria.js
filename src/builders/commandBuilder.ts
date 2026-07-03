import { PermissionFlagsBits } from "discord.js"
import type {
  ChatInputCommandInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
  AutocompleteInteraction,
} from "discord.js"
import { normalizeCooldown } from "../core/guards.js"
import type { CommandGuards, CooldownInput, PermissionName } from "../core/guards.js"
import type { GlyriaContext } from "../core/context/ReplyableContext.js"

interface Command {
  name: string
  description: string
  options: CommandOptionData[]
  default_member_permissions: string | undefined
}

type CommandOptionData =
  | StringOption
  | BooleanOption
  | IntegerOption
  | NumberOption
  | UserOption
  | RoleOption
  | SubCommandOption
  | SubCommandGroupOption

type BasicCommandOption =
  | StringOption
  | BooleanOption
  | IntegerOption
  | NumberOption
  | UserOption
  | RoleOption

interface BaseOption {
  name: string
  description: string
  required: boolean
}

interface StringOption extends BaseOption {
  type: 3
  autocomplete?: boolean
}

interface BooleanOption extends BaseOption {
  type: 5
}

interface IntegerOption extends BaseOption {
  type: 4
  autocomplete?: boolean
}

interface NumberOption extends BaseOption {
  type: 10
  autocomplete?: boolean
}

interface UserOption extends BaseOption {
  type: 6
}

interface RoleOption extends BaseOption {
  type: 8
}

interface SubCommandOption {
  type: 1
  name: string
  description: string
  options: CommandOptionData[]
}

interface SubCommandGroupOption {
  type: 2
  name: string
  description: string
  options: SubCommandOption[]
}

type CommandHandler =
  | {
      name: string
      type: "command" | "subcommand"
      kind: "chat"
      guards?: CommandGuards
      handler: (ctx: GlyriaContext<ChatInputCommandInteraction>) => unknown
    }
  | {
      name: string
      type: "command" | "subcommand"
      kind: "user"
      guards?: CommandGuards
      handler: (ctx: GlyriaContext<UserContextMenuCommandInteraction>) => unknown
    }
  | {
      name: string
      type: "command" | "subcommand"
      kind: "message"
      guards?: CommandGuards
      handler: (ctx: GlyriaContext<MessageContextMenuCommandInteraction>) => unknown
    }

export interface CommandInfo {
  name: string
  description: string
  meta: Record<string, unknown>
}

export type AutocompleteChoice = string | number | { name: string; value: string | number }

export type AutocompleteHandler = (
  query: string,
  interaction: AutocompleteInteraction,
) => AutocompleteChoice[] | Promise<AutocompleteChoice[]>

export interface AutocompleteEntry {
  /** `${command path}::${option name}` once fully namespaced */
  name: string
  handler: AutocompleteHandler
}

type AutocompletableOption = StringOption | IntegerOption | NumberOption

class CommandOption<T extends BasicCommandOption> {
  protected data: T
  protected autocompleteHandler?: AutocompleteHandler

  constructor(type: T["type"]) {
    this.data = { type, name: "", description: "", required: false } as T
  }

  setName(name: string): this {
    this.data.name = name
    return this
  }
  setDescription(description: string): this {
    this.data.description = description
    return this
  }
  setRequired(required: boolean): this {
    this.data.required = required
    return this
  }

  /**
   * Inline autocomplete: return choices (strings, numbers, or {name, value})
   * from the current query — no separate handler file needed.
   */
  setAutocomplete(
    this: CommandOption<AutocompletableOption>,
    handler: AutocompleteHandler,
  ): CommandOption<T> {
    ;(this.data as AutocompletableOption).autocomplete = true
    this.autocompleteHandler = handler
    return this as unknown as CommandOption<T>
  }

  protected build(): T {
    return this.data
  }
}

class CommandOptionInternal<T extends BasicCommandOption> extends CommandOption<T> {
  override build(): T {
    return super.build()
  }

  takeAutocomplete(): { option: string; handler: AutocompleteHandler } | undefined {
    return this.autocompleteHandler
      ? { option: this.data.name, handler: this.autocompleteHandler }
      : undefined
  }
}

abstract class BaseCommand {
  protected options: CommandOptionData[] = []
  protected handlers: CommandHandler[] = []
  protected autocompletes: { option: string; handler: AutocompleteHandler }[] = []

  private addOption<T extends BasicCommandOption>(
    type: T["type"],
    fn: (o: CommandOption<T>) => CommandOption<T>,
  ): this {
    const o = fn(new CommandOptionInternal<T>(type)) as CommandOptionInternal<T>
    this.options.push(o.build())

    const autocomplete = o.takeAutocomplete()
    if (autocomplete) this.autocompletes.push(autocomplete)
    return this
  }

  addStringOption(fn: (o: CommandOption<StringOption>) => CommandOption<StringOption>): this {
    return this.addOption<StringOption>(3, fn)
  }
  addBooleanOption(fn: (o: CommandOption<BooleanOption>) => CommandOption<BooleanOption>): this {
    return this.addOption<BooleanOption>(5, fn)
  }
  addIntegerOption(fn: (o: CommandOption<IntegerOption>) => CommandOption<IntegerOption>): this {
    return this.addOption<IntegerOption>(4, fn)
  }
  addNumberOption(fn: (o: CommandOption<NumberOption>) => CommandOption<NumberOption>): this {
    return this.addOption<NumberOption>(10, fn)
  }
  addUserOption(fn: (o: CommandOption<UserOption>) => CommandOption<UserOption>): this {
    return this.addOption<UserOption>(6, fn)
  }
  addRoleOption(fn: (o: CommandOption<RoleOption>) => CommandOption<RoleOption>): this {
    return this.addOption<RoleOption>(8, fn)
  }
}

export class GlyriaSubCommand extends BaseCommand {
  private data = { name: "", description: "" }
  private guards: CommandGuards = {}

  setName(name: string): this {
    this.data.name = name
    return this
  }
  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  setCooldown(cooldown: CooldownInput): this {
    this.guards.cooldown = normalizeCooldown(cooldown)
    return this
  }

  setPermissions(permissions: PermissionName[]): this {
    this.guards.permissions = permissions
    return this
  }

  setOwnerOnly(ownerOnly = true): this {
    this.guards.ownerOnly = ownerOnly
    return this
  }

  execute(handler: (ctx: GlyriaContext<ChatInputCommandInteraction>) => unknown): this {
    this.handlers.push({ name: this.data.name, type: "subcommand", kind: "chat", handler })
    return this
  }

  build(): SubCommandOption {
    return {
      type: 1,
      name: this.data.name,
      description: this.data.description,
      options: this.options,
    }
  }

  getHandler(parent: string, group?: string): CommandHandler[] {
    return this.handlers.map((h) => ({
      ...h,
      name: group ? `${parent}:${group}:${h.name}` : `${parent}:${h.name}`,
      ...(Object.keys(this.guards).length && { guards: { ...this.guards } }),
    }))
  }

  getAutocompletes(parent: string, group?: string): AutocompleteEntry[] {
    const prefix = group
      ? `${parent}:${group}:${this.data.name}`
      : `${parent}:${this.data.name}`
    return this.autocompletes.map((a) => ({ name: `${prefix}::${a.option}`, handler: a.handler }))
  }
}

export class GlyriaSubCommandGroup {
  private data = { name: "", description: "", subcommands: [] as GlyriaSubCommand[] }
  private handlers: CommandHandler[] = []

  setName(name: string): this {
    this.data.name = name
    return this
  }
  setDescription(description: string): this {
    this.data.description = description
    return this
  }

  addSubCommand(fn: (cmd: GlyriaSubCommand) => GlyriaSubCommand): this {
    const cmd = new GlyriaSubCommand()
    fn(cmd)
    this.data.subcommands.push(cmd)
    this.handlers.push(...cmd.getHandler(this.data.name))
    return this
  }

  build(): SubCommandGroupOption {
    return {
      type: 2,
      name: this.data.name,
      description: this.data.description,
      options: this.data.subcommands.map((c) => c.build()),
    }
  }

  getHandler(parent: string): CommandHandler[] {
    return this.handlers.map((h) => ({
      ...h,
      name: `${parent}:${h.name}`,
    }))
  }

  getAutocompletes(parent: string): AutocompleteEntry[] {
    return this.data.subcommands.flatMap((c) => c.getAutocompletes(parent, this.data.name))
  }
}

const commandRegistry: CommandInfo[] = []

export const clearCommandRegistry = (): void => {
  commandRegistry.length = 0
}

export const useCommands = (): CommandInfo[] => commandRegistry

export const registerCommandInfo = (info: CommandInfo): void => {
  const existing = commandRegistry.findIndex((c) => c.name === info.name)
  if (existing !== -1) {
    commandRegistry[existing] = info
  } else {
    commandRegistry.push(info)
  }
}

export class GlyriaCommand extends BaseCommand {
  private command: Command = {
    name: "",
    description: "",
    options: [],
    default_member_permissions: undefined,
  }
  private metadata: Record<string, unknown> = {}
  private guards: CommandGuards = {}
  private nestedAutocompletes: AutocompleteEntry[] = []

  setName(name: string): this {
    this.command.name = name
    return this
  }

  setDescription(description: string): this {
    this.command.description = description
    return this
  }

  setMetaData(meta: Record<string, unknown>): this {
    this.metadata = meta
    return this
  }

  addSubCommand(fn: (cmd: GlyriaSubCommand) => GlyriaSubCommand): this {
    const cmd = new GlyriaSubCommand()
    fn(cmd)
    this.command.options.push(cmd.build())
    this.handlers.push(...cmd.getHandler(this.command.name))
    this.nestedAutocompletes.push(...cmd.getAutocompletes(this.command.name))
    return this
  }

  addSubCommandGroup(fn: (group: GlyriaSubCommandGroup) => GlyriaSubCommandGroup): this {
    const group = new GlyriaSubCommandGroup()
    fn(group)
    this.command.options.push(group.build())
    this.handlers.push(...group.getHandler(this.command.name))
    this.nestedAutocompletes.push(...group.getAutocompletes(this.command.name))
    return this
  }

  setPermissions(permissions: bigint | number | string | PermissionName[]): this {
    if (Array.isArray(permissions)) {
      this.guards.permissions = permissions
      const bits = permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n)
      this.command.default_member_permissions = bits.toString()
    } else {
      this.command.default_member_permissions = permissions.toString()
    }
    return this
  }

  setCooldown(cooldown: CooldownInput): this {
    this.guards.cooldown = normalizeCooldown(cooldown)
    return this
  }

  setOwnerOnly(ownerOnly = true): this {
    this.guards.ownerOnly = ownerOnly
    return this
  }

  execute(handler: (ctx: GlyriaContext<ChatInputCommandInteraction>) => unknown): this {
    this.handlers.push({ name: this.command.name, type: "command", kind: "chat", handler })
    return this
  }

  build(): Command {
    registerCommandInfo({
      name: this.command.name,
      description: this.command.description,
      meta: this.metadata,
    })
    return { ...this.command, options: [...this.options, ...this.command.options] }
  }

  getHandlers(): CommandHandler[] {
    // command-level guards apply to every handler; subcommand-level guards win
    if (!Object.keys(this.guards).length) return this.handlers

    return this.handlers.map((h) => ({
      ...h,
      guards: { ...this.guards, ...h.guards },
    }))
  }

  getAutocompletes(): AutocompleteEntry[] {
    return [
      ...this.autocompletes.map((a) => ({
        name: `${this.command.name}::${a.option}`,
        handler: a.handler,
      })),
      ...this.nestedAutocompletes,
    ]
  }
}

export class GlyriaUserCommand {
  private data = {
    name: "",
    type: 2 as const,
    default_member_permissions: undefined as string | undefined,
  }
  private handlers: CommandHandler[] = []
  private metadata: Record<string, unknown> = {}
  private guards: CommandGuards = {}

  setName(name: string): this {
    this.data.name = name
    return this
  }

  setMetaData(meta: Record<string, unknown>): this {
    this.metadata = meta
    return this
  }

  setPermissions(permissions: bigint | number | string | PermissionName[]): this {
    if (Array.isArray(permissions)) {
      this.guards.permissions = permissions
      const bits = permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n)
      this.data.default_member_permissions = bits.toString()
    } else {
      this.data.default_member_permissions = permissions.toString()
    }
    return this
  }

  setCooldown(cooldown: CooldownInput): this {
    this.guards.cooldown = normalizeCooldown(cooldown)
    return this
  }

  setOwnerOnly(ownerOnly = true): this {
    this.guards.ownerOnly = ownerOnly
    return this
  }

  execute(handler: (ctx: GlyriaContext<UserContextMenuCommandInteraction>) => unknown): this {
    this.handlers.push({ name: this.data.name, type: "command", kind: "user", handler })
    return this
  }

  build() {
    registerCommandInfo({ name: this.data.name, description: "", meta: this.metadata })
    return { ...this.data }
  }

  getHandlers(): CommandHandler[] {
    if (!Object.keys(this.guards).length) return this.handlers

    return this.handlers.map((h) => ({ ...h, guards: { ...this.guards, ...h.guards } }))
  }
}

export class GlyriaMessageCommand {
  private data = {
    name: "",
    type: 3 as const,
    default_member_permissions: undefined as string | undefined,
  }
  private handlers: CommandHandler[] = []
  private metadata: Record<string, unknown> = {}
  private guards: CommandGuards = {}

  setName(name: string): this {
    this.data.name = name
    return this
  }

  setMetaData(meta: Record<string, unknown>): this {
    this.metadata = meta
    return this
  }

  setPermissions(permissions: bigint | number | string | PermissionName[]): this {
    if (Array.isArray(permissions)) {
      this.guards.permissions = permissions
      const bits = permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n)
      this.data.default_member_permissions = bits.toString()
    } else {
      this.data.default_member_permissions = permissions.toString()
    }
    return this
  }

  setCooldown(cooldown: CooldownInput): this {
    this.guards.cooldown = normalizeCooldown(cooldown)
    return this
  }

  setOwnerOnly(ownerOnly = true): this {
    this.guards.ownerOnly = ownerOnly
    return this
  }

  execute(handler: (ctx: GlyriaContext<MessageContextMenuCommandInteraction>) => unknown): this {
    this.handlers.push({ name: this.data.name, type: "command", kind: "message", handler })
    return this
  }

  build() {
    registerCommandInfo({ name: this.data.name, description: "", meta: this.metadata })
    return { ...this.data }
  }

  getHandlers(): CommandHandler[] {
    if (!Object.keys(this.guards).length) return this.handlers

    return this.handlers.map((h) => ({ ...h, guards: { ...this.guards, ...h.guards } }))
  }
}

export type { CommandHandler }
