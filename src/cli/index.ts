#!/usr/bin/env node

const args = process.argv.slice(2)

// Détecte si le flag --module est présent dans les arguments
const enableModuleSDK = args.includes("--module")

// On récupère le premier argument qui n'est pas un flag (commençant par --) pour la commande
const cmd = args.find((arg) => !arg.startsWith("--"))

switch (cmd) {
  case "init": {
    const { init } = await import("./commands/init.js")
    await init()
    break
  }
  case "dev": {
    const { dev } = await import("./commands/dev.js")
    // On passe le booléen à ta fonction dev()
    dev(enableModuleSDK)
    break
  }
  case "build": {
    const { build } = await import("./commands/build.js")
    await build(enableModuleSDK)
    break
  }
  case "generate": {
    const { generate } = await import("./commands/generate.js")
    await generate(enableModuleSDK)
    break
  }
  case "start": {
    const { start } = await import("./commands/start.js")
    start(enableModuleSDK)
    break
  }
  case "module": {
    const { moduleCommand } = await import("./commands/module.js")
    await moduleCommand(args.filter((a) => !a.startsWith("--")).slice(1))
    break
  }
  case "reload": {
    const { reload } = await import("./commands/reload.js")
    reload()
    break
  }
  case "replay": {
    const { replay } = await import("./commands/replay.js")
    await replay(args.slice(args.indexOf("replay") + 1))
    break
  }
  case "bench": {
    const { bench } = await import("./commands/bench.js")
    await bench(args.slice(args.indexOf("bench") + 1))
    break
  }
  case "studio": {
    const { studio } = await import("./commands/studio.js")
    await studio(args.slice(args.indexOf("studio") + 1))
    break
  }
  default:
    console.log(
      "Usage: glyria <init|dev|build|start|generate|module|reload|replay|bench|studio> [--module]",
    )
}
