// src/cli/commands/module.ts

import { existsSync, mkdirSync, writeFileSync } from "fs"
import { resolve } from "path"
import pc from "picocolors"
import { logger } from "../../core/logger.js"
import { loadConfig } from "../../core/config.js"
import { loadModules } from "../../core/loader.js"
import { isModuleDefinition } from "../../sdk/defineModule.js"
import type { BrandedModule } from "../../sdk/defineModule.js"

const MODULE_TEMPLATE = (name: string) => `import { defineModule } from "@glyria/bot"

export default defineModule({
  name: "${name}",
  version: "0.1.0",
  description: "TODO: describe ${name}",

  // dependsOn: ["economy"],
  // config: myZodSchema,

  setup(ctx) {
    ctx.logger.info("${name} loaded")

    // the returned object is this module's public API:
    // other modules can call ctx.modules.get("${name}").hello()
    return {
      hello: () => "hello from ${name}",
    }
  },

  hooks: {
    onReady(ctx) {
      ctx.logger.info("bot is ready")
    },

    // Global middleware — runs before every command of the bot:
    // async beforeCommand(ctx, meta, next) {
    //   await next()
    // },
  },
})
`

const COMMAND_TEMPLATE = (name: string) => `import { GlyriaCommand } from "@glyria/bot"

export default new GlyriaCommand()
  .setName("${name}")
  .setDescription("Example command from the ${name} module")
  .execute(async (ctx) => {
    await ctx.g.reply.success("${name} module works!")
  })
`

export const moduleCommand = async (args: string[]) => {
  const [action, name] = args

  switch (action) {
    case "create": {
      if (!name) {
        console.log("Usage: glyria module create <name>")
        process.exit(1)
      }

      const dir = resolve(process.cwd(), "src/modules", name)
      if (existsSync(dir)) {
        logger.error("Modules", `src/modules/${name} already exists`)
        process.exit(1)
      }

      mkdirSync(resolve(dir, "commands"), { recursive: true })
      writeFileSync(resolve(dir, "index.ts"), MODULE_TEMPLATE(name))
      writeFileSync(resolve(dir, "commands", `${name}.ts`), COMMAND_TEMPLATE(name))

      logger.success("Modules", `Module scaffolded in src/modules/${name}`)
      logger.info("Modules", "index.ts (manifest + hooks), commands/ (auto-loaded)")
      break
    }

    case "list": {
      await loadConfig()
      const discovered = await loadModules()

      if (!discovered.length) {
        logger.info("Modules", "No modules found (src/modules/ or glyria.config.ts `modules`)")
        return
      }

      console.log("")
      for (const { definition, source } of discovered) {
        if (!isModuleDefinition(definition)) {
          console.log(pc.red("  ✖"), pc.bold("<invalid>"), pc.gray(source))
          continue
        }
        const def = definition as BrandedModule
        const version = def.version ? pc.gray(`v${def.version}`) : ""
        const deps = def.dependsOn?.length ? pc.gray(`deps: ${def.dependsOn.join(", ")}`) : ""
        const hooks = Object.keys(def.hooks ?? {})
        console.log(
          pc.green("  ✔"),
          pc.bold(def.name),
          version,
          deps,
          hooks.length ? pc.cyan(`hooks: ${hooks.join(", ")}`) : "",
        )
      }
      console.log("")
      break
    }

    default:
      console.log("Usage: glyria module <create|list> [name]")
  }
}
