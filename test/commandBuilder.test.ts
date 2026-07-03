import { describe, it, expect, beforeEach } from "vitest"
import {
  GlyriaCommand,
  GlyriaUserCommand,
  GlyriaMessageCommand,
  clearCommandRegistry,
  useCommands,
} from "../src/builders/commandBuilder.js"

beforeEach(() => {
  clearCommandRegistry()
})

describe("GlyriaCommand", () => {
  it("builds a basic command with options", () => {
    const cmd = new GlyriaCommand()
      .setName("ping")
      .setDescription("Ping the bot")
      .addStringOption((o) => o.setName("message").setDescription("A message").setRequired(true))
      .execute(() => {})

    const json = cmd.build()

    expect(json.name).toBe("ping")
    expect(json.description).toBe("Ping the bot")
    expect(json.options).toEqual([
      { type: 3, name: "message", description: "A message", required: true },
    ])
  })

  it("registers the root handler under the command name", () => {
    const cmd = new GlyriaCommand().setName("ping").execute(() => {})

    expect(cmd.getHandlers().map((h) => h.name)).toEqual(["ping"])
  })

  it("namespaces subcommand handlers as parent:sub", () => {
    const cmd = new GlyriaCommand()
      .setName("config")
      .addSubCommand((sub) => sub.setName("show").execute(() => {}))

    expect(cmd.getHandlers().map((h) => h.name)).toEqual(["config:show"])
  })

  it("namespaces subcommand group handlers as parent:group:sub", () => {
    const cmd = new GlyriaCommand()
      .setName("config")
      .addSubCommandGroup((group) =>
        group.setName("theme").addSubCommand((sub) => sub.setName("set").execute(() => {})),
      )

    expect(cmd.getHandlers().map((h) => h.name)).toEqual(["config:theme:set"])
  })

  it("serializes permissions to string", () => {
    const cmd = new GlyriaCommand().setName("admin").setPermissions(8n)

    expect(cmd.build().default_member_permissions).toBe("8")
  })

  it("registers command info in the registry on build", () => {
    new GlyriaCommand().setName("ping").setDescription("Ping").setMetaData({ tag: "x" }).build()

    expect(useCommands()).toEqual([{ name: "ping", description: "Ping", meta: { tag: "x" } }])
  })
})

describe("declarative guards", () => {
  it("attaches a user cooldown from a bare duration", () => {
    const cmd = new GlyriaCommand().setName("ping").setCooldown("5s").execute(() => {})

    expect(cmd.getHandlers()[0].guards).toEqual({ cooldown: { user: 5_000 } })
  })

  it("attaches per-scope cooldowns", () => {
    const cmd = new GlyriaCommand()
      .setName("ping")
      .setCooldown({ user: "5s", guild: "2s" })
      .execute(() => {})

    expect(cmd.getHandlers()[0].guards).toEqual({ cooldown: { user: 5_000, guild: 2_000 } })
  })

  it("applies guards even when set after execute()", () => {
    const cmd = new GlyriaCommand().setName("ping").execute(() => {}).setOwnerOnly()

    expect(cmd.getHandlers()[0].guards).toEqual({ ownerOnly: true })
  })

  it("converts permission name arrays to a bitfield and a runtime guard", () => {
    const cmd = new GlyriaCommand()
      .setName("ban")
      .setPermissions(["BanMembers", "KickMembers"])
      .execute(() => {})

    expect(cmd.build().default_member_permissions).toBe(String((1n << 2n) | (1n << 1n)))
    expect(cmd.getHandlers()[0].guards).toEqual({ permissions: ["BanMembers", "KickMembers"] })
  })

  it("keeps the raw bigint setPermissions behavior", () => {
    const cmd = new GlyriaCommand().setName("admin").setPermissions(8n).execute(() => {})

    expect(cmd.build().default_member_permissions).toBe("8")
    expect(cmd.getHandlers()[0].guards).toBeUndefined()
  })

  it("propagates command guards to subcommand handlers, subcommand guards win", () => {
    const cmd = new GlyriaCommand()
      .setName("config")
      .setCooldown("10s")
      .setOwnerOnly()
      .addSubCommand((sub) => sub.setName("show").setCooldown("2s").execute(() => {}))
      .addSubCommand((sub) => sub.setName("reset").execute(() => {}))

    const handlers = cmd.getHandlers()
    const show = handlers.find((h) => h.name === "config:show")
    const reset = handlers.find((h) => h.name === "config:reset")

    expect(show?.guards).toEqual({ cooldown: { user: 2_000 }, ownerOnly: true })
    expect(reset?.guards).toEqual({ cooldown: { user: 10_000 }, ownerOnly: true })
  })

  it("supports guards on user and message context commands", () => {
    const user = new GlyriaUserCommand().setName("Inspect").setCooldown("3s").execute(() => {})
    const msg = new GlyriaMessageCommand().setName("Report").setOwnerOnly().execute(() => {})

    expect(user.getHandlers()[0].guards).toEqual({ cooldown: { user: 3_000 } })
    expect(msg.getHandlers()[0].guards).toEqual({ ownerOnly: true })
  })
})

describe("GlyriaUserCommand / GlyriaMessageCommand", () => {
  it("builds a user context menu command with type 2", () => {
    const json = new GlyriaUserCommand().setName("Inspect").build()

    expect(json).toMatchObject({ name: "Inspect", type: 2 })
  })

  it("builds a message context menu command with type 3", () => {
    const json = new GlyriaMessageCommand().setName("Report").build()

    expect(json).toMatchObject({ name: "Report", type: 3 })
  })
})
