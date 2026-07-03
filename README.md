# glyria.js

**The Discord bot framework with a clean DX — built on top of discord.js.**

File-based commands, auto-imports, Embed V2 support, and zero boilerplate out of the box.

---

## Quick start

```bash
npm install @glyria/bot
npx glyria init
```

Fill in your `.env`:

```bash
TOKEN=your_bot_token_here
```

Start your bot:

```bash
npm run dev
```

---

## Why glyria.js?

### Zero boilerplate

```ts
// src/index.ts — that's it
const client = new GlyriaClient({
  intents: [GatewayIntentBits.Guilds]
})

await client.login()
```

### File-based commands

Drop a file in `src/commands/` — it's automatically loaded and registered on Discord.

```ts
// src/commands/ping.ts — no imports needed
export default new GlyriaCommand()
  .setName("ping")
  .setDescription("Pong!")
  .execute(async (ctx) => {
    await ctx.reply({ content: "Pong!" })
  })
```

### Subcommands & groups

```ts
export default new GlyriaCommand()
  .setName("moderation")
  .setDescription("Moderation commands")
  .addSubCommand((cmd) =>
    cmd
      .setName("ban")
      .setDescription("Ban a user")
      .addUserOption((option) =>
        option.setName("user").setDescription("User to ban").setRequired(true)
      )
      .execute(async (ctx) => { /* handle ban */ })
  )
  .addSubCommandGroup((group) =>
    group
      .setName("config")
      .setDescription("Configuration")
      .addSubCommand((cmd) =>
        cmd
          .setName("logs")
          .setDescription("Configure logs")
          .addBooleanOption((option) =>
            option.setName("enabled").setDescription("Enable logs").setRequired(true)
          )
          .execute(async (ctx) => { /* handle logs config */ })
      )
  )
```

### Embed V2 builder

First-class support for Discord's new Components V2 system:

```ts
const embed = new EmbedV2Builder()
  .container({ accentColor: 0x5865F2 })
    .textDisplay("# Hello!")
    .separator({ spacing: "large" })
    .section()
      .textDisplay("Choose your role")
      .buttonAccessory({ label: "Pick", customId: "role_picker", style: "primary" })
    .end()
    .actionRow()
      .button({ label: "Confirm", customId: "confirm", style: "success" })
      .button({ label: "Cancel", customId: "cancel", style: "danger" })
    .end()
  .end()
  .build()

await ctx.reply({ ...embed })
```

### Styled replies

```ts
await ctx.g.reply.success("User banned successfully!")
await ctx.g.reply.error("You don't have permission.")
await ctx.g.reply.info("Here are the details...")
```

### Auto-imports

Every glyria.js utility is available globally — no import needed anywhere:

```ts
// GlyriaClient, GlyriaCommand, GlyriaEvent, EmbedV2Builder,
// GlyriaBus, createReplyableContext, GatewayIntentBits, Events...
// all available without a single import line
```

---

## CLI

| Command | Description |
|---|---|
| `npx glyria init` | Scaffold a new project |
| `npm run dev` | Start in dev mode with hot reload |
| `npm run build` | Compile for production |
| `npm run start` | Start in production mode |
| `npm run generate` | Regenerate auto-imports |

---

## Configuration

```ts
// glyria.config.ts
export default defineGlyriaConfig({
  theme: {
    embedV2: {
      primaryColor: "#5865F2",
      successColor: "#57F287",
      errorColor: "#ED4245",
      footer: {
        text: "My Bot • v1.0"
      }
    }
  }
})
```

---

## Support

- 📖 **Documentation** — [js.glyria.app](https://js.glyria.app)
- 💬 **Discord** — [discord.gg/FMTdrdNJx5](https://discord.gg/FMTdrdNJx5)
- 🐛 **Issues** — [GitHub Issues](https://github.com/Kiki344r/glyria.js/issues)
- 🏷️ **Versioning & releases** — [VERSIONING.md](./VERSIONING.md)

---

## Requirements

- Node.js 22.x or higher
- TypeScript 6.x
- discord.js 14.x (installed automatically)

---

## License

MIT — [Glyria](https://glyria.app)