// src/cli/commands/studio.ts
// Local web studio: browse every command, execute it against a fake context,
// and preview the Embed V2 render — without opening Discord.

import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { logger } from "../../core/logger.js"
import { createTestContext } from "../../sdk/testContext.js"
import { listRecordings } from "../../core/recorder.js"

// ===== TYPES =====

interface OptionDescriptor {
  name: string
  type: "string" | "integer" | "number" | "boolean" | "user" | "role"
  required: boolean
  description: string
}

interface CommandDescriptor {
  key: string
  kind: string
  description: string
  guards: unknown
  options: OptionDescriptor[]
}

interface RawOption {
  type: number
  name: string
  description?: string
  required?: boolean
  options?: RawOption[]
}

// ===== HELPERS =====

const OPTION_TYPES: Record<number, OptionDescriptor["type"]> = {
  3: "string",
  4: "integer",
  5: "boolean",
  6: "user",
  8: "role",
  10: "number",
}

const optionsForKey = (rootOptions: RawOption[], path: string[]): OptionDescriptor[] => {
  let options = rootOptions
  for (const segment of path) {
    const next = options.find((o) => (o.type === 1 || o.type === 2) && o.name === segment)
    options = next?.options ?? []
  }
  return options
    .filter((o) => o.type !== 1 && o.type !== 2)
    .map((o) => ({
      name: o.name,
      type: OPTION_TYPES[o.type] ?? "string",
      required: o.required ?? false,
      description: o.description ?? "",
    }))
}

const extractText = (payload: unknown): string => {
  const texts: string[] = []
  const walk = (components: unknown[]) => {
    for (const c of components) {
      const comp = c as { type?: number; content?: string; components?: unknown[] }
      if (comp.type === 10 && comp.content) texts.push(comp.content)
      if (Array.isArray(comp.components)) walk(comp.components)
    }
  }
  const p = payload as { components?: unknown[]; content?: string }
  if (p?.content) texts.push(p.content)
  if (Array.isArray(p?.components)) walk(p.components)
  return texts.join("\n")
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolvePromise, reject) => {
    let raw = ""
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on("end", () => {
      try {
        resolvePromise(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    req.on("error", reject)
  })

// ===== DATA =====

const loadDescriptors = async (): Promise<{
  descriptors: CommandDescriptor[]
  handlers: Map<string, (ctx: never) => unknown>
}> => {
  // fresh load on every call: live preview while files are being edited
  const { loadCommands } = await import("../../core/loader.js")
  const commands = await loadCommands()

  const descriptors: CommandDescriptor[] = []
  const handlers = new Map<string, (ctx: never) => unknown>()

  for (const cmd of commands) {
    const cmdJson = cmd.json as { description?: string; options?: RawOption[] }
    for (const h of cmd.handlers) {
      handlers.set(h.name, h.handler as (ctx: never) => unknown)
      descriptors.push({
        key: h.name,
        kind: h.kind,
        description: cmdJson.description ?? "",
        guards: h.guards ?? null,
        options: h.kind === "chat" ? optionsForKey(cmdJson.options ?? [], h.name.split(":").slice(1)) : [],
      })
    }
  }

  return { descriptors, handlers }
}

// ===== SERVER =====

export const studio = async (args: string[]) => {
  logger.banner()

  const portFlag = args.findIndex((a) => a === "-p" || a === "--port")
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) || 4111 : 4111

  // the loader resolves .ts vs .js at import time — decide before importing it
  process.env.GLYRIA_DEV ??= "true"
  const { loadConfig } = await import("../../core/config.js")
  await loadConfig()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    try {
      if (url.pathname === "/api/commands") {
        const { descriptors } = await loadDescriptors()
        return json(res, 200, descriptors)
      }

      if (url.pathname === "/api/recordings") {
        return json(
          res,
          200,
          listRecordings()
            .slice(0, 50)
            .map((r) => ({
              id: r.id,
              key: r.key,
              username: r.username ?? r.userId,
              createdAt: r.createdAt,
              hasError: Boolean(r.error),
              options: r.options,
            })),
        )
      }

      if (url.pathname === "/api/run" && req.method === "POST") {
        const body = (await readBody(req)) as {
          key?: string
          options?: Record<string, unknown>
          userId?: string
          guildId?: string
        }
        if (!body.key) return json(res, 400, { ok: false, error: "key is required" })

        const { handlers } = await loadDescriptors()
        const handler = handlers.get(body.key)
        if (!handler) return json(res, 404, { ok: false, error: `unknown command ${body.key}` })

        const ctx = createTestContext({
          ...(body.userId && { userId: body.userId }),
          ...(body.guildId !== undefined && { guildId: body.guildId || null }),
          options: body.options ?? {},
          subcommand: body.key.split(":").slice(1),
        })

        const startedAt = performance.now()
        let error: string | undefined
        try {
          await handler(ctx as never)
        } catch (e) {
          error = e instanceof Error ? (e.stack ?? e.message) : String(e)
        }

        return json(res, 200, {
          ok: !error,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          ...(error && { error }),
          replies: ctx.replies.map((r) => ({
            via: r.via,
            payload: r.payload,
            text: extractText(r.payload),
          })),
        })
      }

      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        return res.end(HTML)
      }

      json(res, 404, { error: "not found" })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.listen(port, () => {
    logger.success("Studio", `Glyria Studio running at http://localhost:${port}`)
    logger.info("Studio", "Commands reload on every request — keep coding, keep previewing")
  })
}

// ===== UI =====

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glyria Studio</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.5 system-ui, 'Segoe UI', sans-serif; background: #313338; color: #dbdee1; display: flex; height: 100vh; }
  #sidebar { width: 300px; background: #2b2d31; overflow-y: auto; padding: 12px; flex-shrink: 0; border-right: 1px solid #1e1f22; }
  #sidebar h1 { font-size: 16px; color: #fff; padding: 8px 8px 14px; }
  #sidebar h1 span { color: #949ba4; font-weight: 400; font-size: 12px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .tabs button { flex: 1; background: #1e1f22; color: #b5bac1; border: 0; border-radius: 6px; padding: 6px; cursor: pointer; }
  .tabs button.active { background: #5865f2; color: #fff; }
  .cmd { padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; gap: 6px; align-items: center; }
  .cmd:hover { background: #35373c; }
  .cmd.selected { background: #404249; color: #fff; }
  .cmd .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 10px; background: #1e1f22; border-radius: 4px; padding: 1px 5px; color: #949ba4; }
  #main { flex: 1; overflow-y: auto; padding: 28px 36px; }
  #main h2 { color: #fff; font-size: 20px; }
  #main .desc { color: #949ba4; margin: 4px 0 18px; }
  .guardline { margin-bottom: 14px; display: flex; gap: 8px; }
  .guardline .badge { font-size: 12px; padding: 3px 8px; }
  form { background: #2b2d31; border-radius: 10px; padding: 18px; max-width: 640px; }
  label { display: block; margin: 10px 0 4px; color: #b5bac1; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  label em { color: #f23f43; font-style: normal; }
  input[type=text], input[type=number] { width: 100%; background: #1e1f22; border: 0; border-radius: 6px; color: #dbdee1; padding: 9px 10px; font-size: 14px; }
  .row2 { display: flex; gap: 12px; } .row2 > div { flex: 1; }
  button.run { margin-top: 16px; background: #5865f2; color: #fff; border: 0; border-radius: 6px; padding: 10px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button.run:hover { background: #4752c4; }
  #out { max-width: 640px; margin-top: 22px; }
  .meta { color: #949ba4; font-size: 12px; margin-bottom: 8px; }
  .msg { background: #2b2d31; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .container-v2 { border-left: 4px solid #5865f2; background: #383a40; border-radius: 6px; padding: 10px 14px; margin: 4px 0; }
  .container-v2 hr { border: 0; border-top: 1px solid #4e5058; margin: 8px 0; }
  .btnrow { display: flex; gap: 8px; margin-top: 8px; }
  .dbtn { border: 0; border-radius: 4px; padding: 6px 14px; font-size: 13px; color: #fff; cursor: default; }
  .dbtn.s1 { background: #5865f2; } .dbtn.s2 { background: #4e5058; } .dbtn.s3 { background: #248046; } .dbtn.s4 { background: #da373c; }
  .dbtn[disabled] { opacity: .45; }
  .error { background: #3c1e20; border-left: 4px solid #f23f43; border-radius: 6px; padding: 12px; white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #fbb; }
  .via { font-size: 10px; background: #1e1f22; color: #949ba4; border-radius: 4px; padding: 1px 6px; margin-right: 6px; }
  .empty { color: #6d7178; padding: 40px; text-align: center; }
  b { color: #fff; } code { background: #1e1f22; border-radius: 3px; padding: 1px 4px; font-size: 12px; }
</style>
</head>
<body>
<div id="sidebar">
  <h1>⚡ Glyria Studio <span>live preview</span></h1>
  <div class="tabs">
    <button id="tab-cmds" class="active">Commands</button>
    <button id="tab-recs">Recordings</button>
  </div>
  <div id="list"></div>
</div>
<div id="main"><div class="empty">Select a command on the left</div></div>
<script>
var commands = [], recordings = [], selected = null, tab = "cmds";

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function mdlite(s) {
  return esc(s)
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
    .replace(/\\u0060([^\\u0060]+)\\u0060/g, "<code>$1</code>")
    .replace(/\\n/g, "<br>");
}

function guardBadges(g) {
  if (!g) return "";
  var out = "";
  if (g.cooldown) out += '<span class="badge">⏱ cooldown</span>';
  if (g.permissions) out += '<span class="badge">🔒 ' + esc(g.permissions.join(", ")) + '</span>';
  if (g.ownerOnly) out += '<span class="badge">👑 owner</span>';
  return out;
}

function renderList() {
  var el = document.getElementById("list");
  if (tab === "cmds") {
    el.innerHTML = commands.map(function (c, i) {
      return '<div class="cmd' + (selected === i ? " selected" : "") + '" onclick="select(' + i + ')">' +
        '<span class="name">/' + esc(c.key.split(":").join(" ")) + '</span>' +
        '<span class="badge">' + c.kind + '</span>' + guardBadges(c.guards) + '</div>';
    }).join("") || '<div class="empty">No commands found</div>';
  } else {
    el.innerHTML = recordings.map(function (r) {
      return '<div class="cmd" onclick="pickRecording(\\'' + r.id + '\\')">' +
        (r.hasError ? "✖ " : "✔ ") +
        '<span class="name">/' + esc(r.key.split(":").join(" ")) + '</span>' +
        '<span class="badge">' + esc(r.username) + '</span></div>';
    }).join("") || '<div class="empty">No recordings yet</div>';
  }
}

function select(i) {
  selected = i; renderList();
  var c = commands[i];
  var opts = c.options.map(function (o) {
    var input;
    if (o.type === "boolean") input = '<input type="checkbox" data-opt="' + o.name + '" data-type="boolean">';
    else if (o.type === "integer" || o.type === "number") input = '<input type="number" data-opt="' + o.name + '" data-type="number">';
    else input = '<input type="text" data-opt="' + o.name + '" data-type="string" placeholder="' + esc(o.description) + '">';
    return '<label>' + esc(o.name) + (o.required ? ' <em>*</em>' : '') + '</label>' + input;
  }).join("");
  document.getElementById("main").innerHTML =
    '<h2>/' + esc(c.key.split(":").join(" ")) + '</h2>' +
    '<div class="desc">' + esc(c.description || "(no description)") + '</div>' +
    '<div class="guardline">' + guardBadges(c.guards) + '</div>' +
    '<form onsubmit="return run()">' + opts +
    '<div class="row2"><div><label>user id</label><input type="text" id="uid" placeholder="test-user"></div>' +
    '<div><label>guild id</label><input type="text" id="gid" placeholder="test-guild"></div></div>' +
    '<button type="submit" class="run">▶ Run</button></form><div id="out"></div>';
}

function pickRecording(id) {
  var r = recordings.find(function (x) { return x.id === id; });
  if (!r) return;
  tab = "cmds"; document.getElementById("tab-cmds").classList.add("active");
  document.getElementById("tab-recs").classList.remove("active");
  var i = commands.findIndex(function (c) { return c.key === r.key; });
  if (i < 0) return alert("Command " + r.key + " no longer exists");
  select(i);
  Object.keys(r.options || {}).forEach(function (name) {
    var input = document.querySelector('[data-opt="' + name + '"]');
    if (!input) return;
    if (input.dataset.type === "boolean") input.checked = Boolean(r.options[name]);
    else input.value = r.options[name];
  });
}

function renderPayload(p) {
  var out = "";
  (p.components || []).forEach(function (comp) { out += renderComponent(comp); });
  if (p.content) out += '<div>' + mdlite(p.content) + '</div>';
  return out || '<div style="color:#6d7178">(no visual payload)</div>';
}

function renderComponent(comp) {
  if (comp.type === 17) {
    var color = comp.accent_color != null ? "#" + comp.accent_color.toString(16).padStart(6, "0") : "#4e5058";
    return '<div class="container-v2" style="border-left-color:' + color + '">' +
      (comp.components || []).map(renderComponent).join("") + '</div>';
  }
  if (comp.type === 10) return '<div>' + mdlite(comp.content || "") + '</div>';
  if (comp.type === 14) return '<hr>';
  if (comp.type === 1) return '<div class="btnrow">' + (comp.components || []).map(renderComponent).join("") + '</div>';
  if (comp.type === 2) return '<button class="dbtn s' + (comp.style || 2) + '"' + (comp.disabled ? " disabled" : "") + '>' + esc(comp.label || "") + '</button>';
  if (comp.type === 13) return '<div style="color:#949ba4">📎 ' + esc((comp.file && comp.file.url) || "file") + '</div>';
  if (comp.components) return comp.components.map(renderComponent).join("");
  return "";
}

function run() {
  var c = commands[selected];
  var options = {};
  document.querySelectorAll("[data-opt]").forEach(function (input) {
    if (input.dataset.type === "boolean") { if (input.checked) options[input.dataset.opt] = true; }
    else if (input.value !== "") options[input.dataset.opt] = input.dataset.type === "number" ? Number(input.value) : input.value;
  });
  var body = { key: c.key, options: options };
  var uid = document.getElementById("uid").value; if (uid) body.userId = uid;
  var gid = document.getElementById("gid").value; if (gid) body.guildId = gid;
  fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      var out = '<div class="meta">' + (r.ok ? "✅" : "❌") + " " + r.durationMs + "ms</div>";
      (r.replies || []).forEach(function (reply) {
        out += '<div class="msg"><span class="via">' + reply.via + '</span>' + renderPayload(reply.payload || {}) + '</div>';
      });
      if (r.error) out += '<div class="error">' + esc(r.error) + '</div>';
      if (!(r.replies || []).length && !r.error) out += '<div class="empty">Handler sent nothing</div>';
      document.getElementById("out").innerHTML = out;
    });
  return false;
}

document.getElementById("tab-cmds").onclick = function () { tab = "cmds"; this.classList.add("active"); document.getElementById("tab-recs").classList.remove("active"); renderList(); };
document.getElementById("tab-recs").onclick = function () { tab = "recs"; this.classList.add("active"); document.getElementById("tab-cmds").classList.remove("active"); refresh(); };
document.addEventListener("keydown", function (e) { if (e.ctrlKey && e.key === "Enter" && selected != null) run(); });

function refresh() {
  fetch("/api/commands").then(function (r) { return r.json(); }).then(function (data) { commands = data; renderList(); });
  fetch("/api/recordings").then(function (r) { return r.json(); }).then(function (data) { recordings = data; if (tab === "recs") renderList(); });
}
refresh();
</script>
</body>
</html>`
