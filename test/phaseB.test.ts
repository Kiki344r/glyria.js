import { describe, it, expect, vi } from "vitest"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { GlyriaCommand, clearCommandRegistry } from "../src/builders/commandBuilder.js"
import {
  GlyriaButton,
  GlyriaModal,
  compilePattern,
  buildCustomId,
} from "../src/builders/componentBuilder.js"
import {
  GlyriaStore,
  MemoryStoreAdapter,
  JsonFileStoreAdapter,
} from "../src/core/store.js"
import { diffCommandBodies, isDiffEmpty } from "../src/core/commandDiff.js"

// ===== AUTOCOMPLETE =====

describe("typed autocomplete", () => {
  it("marks the option and collects the handler under command::option", () => {
    clearCommandRegistry()
    const handler = vi.fn(async () => ["a", "b"])

    const cmd = new GlyriaCommand()
      .setName("search")
      .addStringOption((o) => o.setName("query").setDescription("q").setAutocomplete(handler))
      .execute(() => {})

    const json = cmd.build()
    expect(json.options).toEqual([
      expect.objectContaining({ name: "query", autocomplete: true }),
    ])
    expect(cmd.getAutocompletes()).toEqual([{ name: "search::query", handler }])
  })

  it("namespaces subcommand autocompletes", () => {
    clearCommandRegistry()
    const handler = vi.fn(async () => [])

    const cmd = new GlyriaCommand()
      .setName("tag")
      .addSubCommand((sub) =>
        sub
          .setName("get")
          .addStringOption((o) => o.setName("name").setDescription("n").setAutocomplete(handler))
          .execute(() => {}),
      )

    expect(cmd.getAutocompletes()).toEqual([{ name: "tag:get::name", handler }])
  })
})

// ===== TYPED CUSTOM IDS =====

describe("typed customIds", () => {
  it("compiles patterns into matching regexes with named groups", () => {
    const regex = compilePattern("role_picker:{roleId}:{action}")

    const match = regex.exec("role_picker:123:add")
    expect(match?.groups).toEqual({ roleId: "123", action: "add" })
    expect(regex.test("role_picker:123")).toBe(false)
    expect(regex.test("other:123:add")).toBe(false)
  })

  it("builds concrete ids from params and validates them", () => {
    expect(buildCustomId("role_picker:{roleId}", { roleId: "42" })).toBe("role_picker:42")
    expect(() => buildCustomId("x:{a}", { a: "with:colon" })).toThrow()
    // @ts-expect-error missing param
    expect(() => buildCustomId("x:{a}", {})).toThrow()
  })

  it("builds definitions that route params to the handler", async () => {
    const seen: Record<string, string>[] = []
    const button = new GlyriaButton("vote:{pollId}:{choice}").execute((_ctx, params) => {
      // params are typed: { pollId: string; choice: string }
      seen.push(params)
    })

    const def = button.build()
    expect(def.kind).toBe("button")

    const match = def.regex.exec("vote:p1:yes")!
    await def.handler(undefined as never, { ...match.groups })
    expect(seen).toEqual([{ pollId: "p1", choice: "yes" }])
  })

  it("exposes .id() helper bound to the pattern", () => {
    const button = new GlyriaButton("vote:{pollId}:{choice}").execute(() => {})
    expect(button.id({ pollId: "p1", choice: "no" })).toBe("vote:p1:no")
  })

  it("throws when built without a handler", () => {
    expect(() => new GlyriaModal("form:{id}").build()).toThrow()
  })
})

// ===== STORE =====

describe("GlyriaStore", () => {
  it("isolates guild, user, module and global scopes", async () => {
    const store = new GlyriaStore(new MemoryStoreAdapter())

    await store.forGuild("g1").set("k", "guild-value")
    await store.forUser("u1").set("k", "user-value")
    await store.forModule("economy").set("k", "module-value")
    await store.global.set("k", "global-value")

    expect(await store.forGuild("g1").get("k")).toBe("guild-value")
    expect(await store.forGuild("g2").get("k")).toBeUndefined()
    expect(await store.forUser("u1").get("k")).toBe("user-value")
    expect(await store.forModule("economy").get("k")).toBe("module-value")
    expect(await store.global.get("k")).toBe("global-value")
  })

  it("lists and deletes keys within a scope", async () => {
    const store = new GlyriaStore(new MemoryStoreAdapter())
    const guild = store.forGuild("g1")

    await guild.set("a", 1)
    await guild.set("b", 2)
    await store.forGuild("g2").set("c", 3)

    expect((await guild.keys()).sort()).toEqual(["a", "b"])
    expect(await guild.delete("a")).toBe(true)
    expect(await guild.get("a")).toBeUndefined()
  })

  it("persists through the JSON file adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glyria-store-"))
    const path = join(dir, "store.json")

    const adapter = new JsonFileStoreAdapter(path)
    const store = new GlyriaStore(adapter)
    await store.forUser("u1").set("coins", 100)
    adapter.flush()

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "user:u1:coins": 100 })

    // reload from disk
    const store2 = new GlyriaStore(new JsonFileStoreAdapter(path))
    expect(await store2.forUser("u1").get("coins")).toBe(100)
  })
})

// ===== COMMAND DIFF =====

describe("diffCommandBodies", () => {
  const cmd = (name: string, description = "d") => ({ name, description })

  it("detects added, removed and changed commands", () => {
    const diff = diffCommandBodies(
      [cmd("keep"), cmd("gone"), cmd("edit", "before")],
      [cmd("keep"), cmd("new"), cmd("edit", "after")],
    )

    expect(diff).toEqual({ added: ["new"], removed: ["gone"], changed: ["edit"] })
    expect(isDiffEmpty(diff)).toBe(false)
  })

  it("reports empty diff for identical bodies", () => {
    expect(isDiffEmpty(diffCommandBodies([cmd("a")], [cmd("a")]))).toBe(true)
  })
})
