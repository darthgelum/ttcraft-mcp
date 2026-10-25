---
title: Scripting from VS Code
description: The TTCraft VSC extension — sign in from the editor, mirror a running table's Lua scripts as real files, save straight to the table, read the console, and let an AI coding agent work on the scripts.
order: 37
section: Table scripting
toc: true
---

The [**TTCraft VSC**](https://marketplace.visualstudio.com/items?itemName=TTCraft.ttcraft-vsc) extension edits the scripts of a running game table from Visual Studio Code. It signs in to TTCraft, lists the tables you may manage, and mirrors one table's Lua scripts into a folder of real files: the Global script, every scripted object, every scripted library template. Saving a file pushes it to the live table; the table's console streams back into the editor. Because the files are real, the Lua language server and AI coding agents (Copilot, Claude Code, Codex and the like) can read and edit them like any other project.

It edits **scripts only**. For an AI assistant that can also build objects, arrange the table and upload assets, use [TTCraft MCP](/docs/mcp). Whole tables move around as [table archives](/docs/table-archives). The table's outline, seats and named areas can also be described as a [table plan](/docs/table-plan), which a script applies with `Table.set`.

## Install

Get it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=TTCraft.ttcraft-vsc), or open the Extensions view in VS Code (`Ctrl+Shift+X`), search for *TTCraft* and click **Install**. The extension is free and open source; the code is on [GitHub](https://github.com/darthgelum/ttcraft-vsc).

At a glance, it gives you:

- **Your tables in the sidebar** — every table you manage, with its Global script, objects and library templates, updating live as things spawn and despawn.
- **Scripts as real files** — one folder on disk mirrors the table, so search, git and every editor tool work on the scripts.
- **Save is deploy** — `Ctrl+S` sends a script to the running table and it takes effect for every player at once; a compile error is shown on the offending line and the previous version keeps running.
- **The console in the editor** — everything scripts print and every error, in an output channel and in a file.
- **Autocomplete for the whole API** — `tw`, `self`, players, `JSON`, `Vector`, `Color` and every event, through the Lua language server.
- **Made for AI agents** — the folder explains itself to Copilot, Claude Code, Codex and friends, so an agent can write and debug table scripts on its own.

The rest of this page walks through each of those.

## What you need

- A TTCraft account that is a member of a room with the **Manage table** permission (room owners and moderators have it by default).
- The table **open** in that room. The extension does not boot a stopped table — start it from the room page first, then it appears with a filled dot in the extension's list.
- VS Code 1.85 or newer with the extension installed.
- Optionally the **Lua** extension (`sumneko.lua`) for highlighting and autocomplete; TTCraft VSC offers to install it the first time you open a script.

## Signing in

Open the **TTCraft** view in the Activity Bar and click **Sign in**. The extension opens the *link a device* page on ttcraft.net in your browser with a short code already filled in; approve it there. No password is ever typed into the editor — the flow is the same device authorisation that command-line tools use. The resulting token lives in VS Code's secret storage and can be revoked from **Settings → Security** on ttcraft.net.

## The Tables view

Every table you may manage is listed as `#channel` with its room name. Expanding a table connects to it and shows:

- **Global script** — the table-level script.
- **Objects** — every object on the table, live: spawns appear, despawns disappear. Objects that already carry a script have a code icon.
- **Templates** — the table's library, foldered by category.
- **Effects** — listed for reference; effects are data, not scripts, and do not open.

Click an entry to open its script. Clicking a script-less object or template starts an empty script for it. **Open table** on a table mirrors the whole table and opens `global.lua`; **Switch table** (also in the status bar) picks a table from a list.

## The table folder

Opening a script mirrors the table into **one folder** — the *table folder* — which the extension adds to your workspace:

| Path | What it is |
| --- | --- |
| `global.lua` | The Global script |
| `objects/<Name>__<guid>.lua` | One live object's script. The guid is the object's stable identity; the name is for reading |
| `templates/<Category>/…/<Name>__<id>.lua` | One library template's script, under its category |
| `.ttcraft/table.json` | Which table this is and whether the extension is connected |
| `.ttcraft/console.log` | The table's console, appended live |
| `AGENTS.md`, `CLAUDE.md` | Orientation for AI agents — see [below](#working-with-an-ai-agent) |
| `.luarc.json` | Wires the Lua language server to the bundled API definitions |

Only objects and templates that already carry a script get a file. Names are the same the table shows in the browser, so built-in templates read as *Playing cards*, not as i18n keys.

**One folder holds one table.** Opening a script on a different table switches the folder: editors on the old table's files are closed, its files are removed, and the new table's scripts are written in their place. Nothing is lost by this — the table is the source of truth and every save has already reached it — and whoever works in the folder, you or an agent, never sees two tables mixed together. The status bar shows which table is in the folder.

Do not rename, move or create script files by hand: the `__<id>` suffix is how a file maps back to its entity. Deleting a file deletes nothing on the table.

## Saving

`Ctrl+S` pushes the file to the table at once, exactly like the **Save** button in the browser's script editor: the script is compiled in a fresh state and, if it compiles, replaces the running one for every player. If it does not compile, the previous version keeps running, the error is shown as a diagnostic on the offending line, and a line is appended to `.ttcraft/console.log`.

Everything the table's scripts print — `print()`, `log()`, runtime errors — arrives in the **TTCraft Table** output channel (*TTCraft: Show table console*) and in `.ttcraft/console.log`, prefixed by the table. A runtime error disables that script until its next save, as in the browser.

Live changes on the table reach the folder as they happen: a despawned object's file goes away, a template edited in the browser is rewritten. An *object's* script edited in the browser is not broadcast, so after editing the same script in both places press **Refresh** in the view's toolbar — it reconnects and re-pulls every script.

## Autocomplete and checking

The extension ships EmmyLua definitions of the whole API — `tw`, the object and player handles, `JSON`, `Vector`, `Color`, and every event callback — and points the Lua language server at them through the folder's `.luarc.json`. With the Lua extension installed you get completion, signatures and undefined-global checks for `self`, `tw` and friends. The definitions file (`resources/library/ttcraft.lua` inside the extension) is also the most exact description of the API there is, and `AGENTS.md` names its absolute path for agents.

## Working with an AI agent

The folder is made for it. Open VS Code on the table folder, or point your agent at it, and read `AGENTS.md` yourself once: it tells the agent

- what the folder is and which table it mirrors (with `.ttcraft/table.json` as the machine-readable copy);
- that saving a `.lua` file pushes it to the running table, and how to see the result in `.ttcraft/console.log`;
- where the manual and the API definitions are, and that scripts run sandboxed on the server — no `require`, no HTTP, nothing fetched from URLs;
- what cannot be done from the folder: booting or closing the table, uploading assets, importing other tabletops' saves.

`CLAUDE.md` defers to `AGENTS.md` for tools that only read the former. The manual itself is served as markdown for agents at [`/llms.txt`](/llms.txt) (an index) and [`/llms-full.txt`](/llms-full.txt) (every page in one file).

A useful loop for an agent: edit → save → read the tail of `.ttcraft/console.log` → adjust. A save that lands prints `saved to the table`; a rejected one prints the compiler's message.

## Workspace restarts

VS Code restarts all extensions when a window gets its first workspace folder, and reloads the window when a single-folder workspace turns into a multi-root one. The first table you open in a window may therefore flash once. The extension expects this: the open you started is finished after the restart, and a table folder that is already in the workspace reconnects on its own every time the window opens. Closing a table or signing out empties the folder but leaves it in the workspace, so nothing restarts again.

To avoid the restart entirely, set **Settings → TTCraft → Table Folder** to an empty folder *inside* a workspace folder you already have open — `my-campaign/table`, say. Nothing is added to the workspace then, and an agent working on your project sees the table's scripts next to your own files. The folder must be empty the first time; the extension owns its contents from then on.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The list is empty | You need **Manage table** in a room you are a member of. The practice table is never listed. |
| *The table is not open* | Start the table from the room page, then expand it again. |
| *Your TTCraft session expired* | The device token was revoked or expired — **Sign in** again. |
| *The table folder … is not empty* | `ttcraft.tableFolder` points at a folder with other files in it. Use an empty one. |
| A save does nothing | Check the **TTCraft Table** output: a lost connection shows as *not saved*. **Refresh** reconnects. |
| Objects show as `object` or an i18n key | The names arrived after the objects. **Refresh**. |

## Under the hood

For anyone building their own tooling — the extension is a thin client over two existing surfaces, and both are documented here so a script or agent can use them directly.

**Signing in** is the OAuth 2.0 Device Authorization Grant (RFC 8628) against ttcraft.net:

- `POST /api/devices/code` with `{"client_name": "…"}` returns `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in` (600) and `interval` (5).
- The user approves at `verification_uri_complete` (the `/link` page) while signed in to TTCraft.
- `POST /api/devices/token` with `{"device_code": "…"}` returns `{"error": "authorization_pending"}` until then, then `{"access_token": "ttcd_…", "token_type": "Bearer", "name", "user": {"id", "username"}}`. Other errors: `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. The token is valid for 90 days.

**The dev API** takes that token as `Authorization: Bearer ttcd_…`:

- `GET /api/dev/me` → `{"user": {"id", "username", "name"}}`.
- `GET /api/dev/tables` → `{"tables": [{"id", "channel": {"id", "name", "slug"}, "room": {"name", "slug"}, "status", "running", "last_activity_at"}]}` — the tables whose room grants you *Manage table*.
- `GET /api/dev/tables/{id}/connect` → `{"table_id", "token", "caps", "ws_url", "http_url", "expires_in"}` — a two-minute WebSocket token for one running table, with the same capabilities you would get in the browser. A stopped table answers `409 {"error": "table_not_open"}`.

**The table itself** speaks JSON over `ws_url?token=…`. After `{"type": "identify", "clientId", "tabId"}` the server sends `hello` (object names) and `props` (objects with their `guid`), then keeps both up to date. The scripting messages:

| Send | Receive |
| --- | --- |
| `{"type": "getglobalscript"}` | `{"type": "script", "id": 0, "code": "…"}` |
| `{"type": "setglobalscript", "code": "…"}` | `{"type": "scriptresult", "id": 0, "ok": true}` or `"ok": false, "error": "…"` |
| `{"type": "getscript", "id": <runtime id>}` | `{"type": "script", "id", "code"}` |
| `{"type": "setscript", "id", "code"}` | `{"type": "scriptresult", "id", "ok", "error"}` |
| `{"type": "liblist"}` | `{"type": "library", "items": [{"id", "name", "category", "kind", "script", …}]}` — also pushed on every library change |
| `{"type": "libsave", …whole item…, "script": "…"}` | `{"type": "libresult", "id", "ok", "error"}` — a whole-item replace: resend name and category |
| — | `{"type": "log", "id", "level", "msg"}` for every console line |

Object *runtime ids* change across reconnects; scripts persist by **guid**, which is why the extension names files after it. `setscript` needs the *Edit* capability, which *Manage table* grants.
