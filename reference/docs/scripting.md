---
title: Table scripting
description: Lua scripting on TTCraft game tables — the execution model, writing handlers, the Global script, persistence, sandbox limits, and what is not available.
order: 30
section: Table scripting
toc: true
---

Any object on a game table can carry a **Lua script** that reacts to game events and queries or manipulates the table. Scripts run **on the server** — the authority over the world — so their effects are identical for every player. Open the **Script** item in an object's context menu to edit it; edits hot-reload live. Prefer a real editor? The [TTCraft VSC](https://marketplace.visualstudio.com/items?itemName=TTCraft.ttcraft-vsc) extension for VS Code mirrors a table's scripts as files, saves them back to the running table with `Ctrl+S`, streams the console into the editor and adds autocomplete for the whole API — see [Scripting from VS Code](/docs/vscode).

Names here often match what other virtual tabletops call the same idea, so the API reads as familiar if you have scripted one before. It is still its own surface: check the reference pages rather than assuming a function exists because you have seen it elsewhere.

This section:

- [Events and veto hooks](/docs/scripting-events) — everything a script can react to or cancel.
- [Objects reference](/docs/scripting-objects) — every method on the object handle.
- [World reference](/docs/scripting-world) — `tw`, zones, snap points, storage, music, timers.
- [Players and turns](/docs/scripting-players) — the player handle and the Turns system.
- [Custom UI](/docs/scripting-ui) — ribbon tabs, panels, menus, hotkeys.
- [Recipes](/docs/scripting-recipes) — complete worked examples.
- [Scripting from VS Code](/docs/vscode) — the editor extension: scripts as real files, saves to the live table, AI agents.

## The model

- Each scripted object runs in its **own sandboxed Lua state**: one script cannot read another's locals, and a script that loops or eats memory is disabled without affecting the server or other scripts.
- `self` is the object the script is attached to.
- Scripts coordinate through shared data (tags, `setVar`/`setTable`, `tw.store`) and cross-script calls (`obj:call("fn", ...)`), not shared globals.
- Scripts persist: per-object scripts are stored with the table (keyed by the object's guid), and travel inside snapshots, saved tables, exports and library templates.

```lua
-- a click counter
function onLoad()
  self:setVar("clicks", self:getVar("clicks") or 0)
end
function onClick(player)
  local n = self:getVar("clicks") + 1
  self:setVar("clicks", n)
  print("clicked", n, "times, last by player", player)
end
```

## Registering handlers

Two equivalent styles — define a global function with the event's `on`-name, or register explicitly:

```lua
function onUpdate(dt) end            -- the global-function style

self:on("update", function(dt) end)  -- explicit registration
```

Use named functions in the Global script, where `self` is unavailable. In an object script, explicit registration for an event takes precedence over its named function. An unknown event name in `self:on` is ignored. See the [events reference](/docs/scripting-events) for where each event is delivered.

## The Global script

Besides per-object scripts there is **one table-level script** with no `self`. Open it from **Tools → Table script** in the **Table setup** group. It receives table-wide events such as player joins, turn changes, and the `trySpawn` and `onPlayerAction` vetoes. Use it for game rules, table UI and zone logic. It persists in the table's database and survives restarts.

```lua
function onPlayerConnect(player)
  local p = tw.getPlayer(player)
  if p then tw.broadcastToAll(p:getDisplayName() .. " joined") end
end
```

A game can also ship a Global script (`"globalScript"` in `game.json`); a user's saved edit overrides it. The application's own base UI is implemented the same way in a privileged *system* script that loads before yours and cannot be edited over the wire — which is why your Global script's contributions never collide with the base UI's.

## Persisting state

Choose a store based on how the state should be restored:

1. **`self:setVar(key, primitive)`** stores per-object numbers, strings or booleans in snapshots.
2. **`self:setTable(key, tbl)` / `tw.setTable(key, tbl)`** store per-object or table-wide tables by value in snapshots. Time Machine restores these stores and object vars.
3. **`tw.store(key, value)`** writes to the table database and is included in exported archives. Time Machine leaves this store at its current value.

A bare Lua global (`count = 5`) or a closure upvalue does **not** round-trip: a live VM can't be frozen, so on restore the source is re-run to rebuild handlers and the saved vars are re-injected.

### `onSave` / `onLoad`

For state that doesn't fit the typed stores, return a string from `onSave()`; it is captured with the object and handed back to `onLoad(saved)` on restore.

```lua
function onSave()
  return JSON.encode({ score = self:getVar("score") or 0 })
end
function onLoad(saved)
  if saved ~= "" then self:setVar("score", JSON.decode(saved).score) end
end
```

Defining `onSave` opts the script into this model: its `onLoad(saved)` then runs on every restore. A script *without* `onSave` keeps the simpler behaviour — vars are re-injected and `onLoad` does **not** re-run on a restore, so one-shot setup isn't repeated. Two things to know:

- `onSave` fires on every automatic snapshot — continuously during play, not only on explicit saves. Keep it fast and side-effect free.
- Recreate ephemeral contributions such as scripting zones, UI, hotkeys and timers in `onLoad`. An object script that needs this setup after snapshot restoration can define `onSave` returning an empty string. Keep the setup safe to repeat. Per-object snap points are saved with the object.

## Errors and hot reload

Saving a script compiles it in a fresh state. On a compile error the old version keeps running and the error appears in the editor. An uncaught runtime error, including a memory or time limit, appears in the browser console and disables the script. Saving it again recompiles it. The server's `resumescript` command can also re-enable an existing instance. A veto hook that errors allows the action.

On reload, the script's previous contributions are cleared: zones, ribbon items, panels, menus, hotkeys, hidden-UI entries and pending timers/dialog callbacks all die with the old instance.

## Sandbox and limits

- **Stdlib:** `base`, `math`, `string`, `table` only — no file, OS or network access; `load`/`require`/`rawset`/`rawget`/`collectgarbage` are removed.
- **Memory:** 2 MB per script state; exceeding it is an error (script disabled).
- **CPU:** each handler call has a 50 ms wall-clock budget; an infinite loop is aborted, the server never freezes. Script-to-script `call` chains share the outer deadline and may nest 64 deep.
- **Log flood:** ~40 log lines per handler call; beyond that output is suppressed for the rest of the call.
- **Contribution caps:** 512 vars, 512 tables and 256 tags per object. Each script can add up to 64 ribbon tabs and 256 standalone ribbon items. The limits for hotkeys and context-menu items are 256 per owner or menu. Floating panels and scripting zones are capped table-wide at 256 and 1024 respectively.

## Not available (yet)

So that neither you nor your AI assistant has to guess — the following do **not** exist in the scripting API:

- **Networking:** no HTTP requests, no `WebRequest`, no sockets.
- **Modules:** no `require` and no shared libraries between scripts; reuse code via `obj:call` or by keeping data in `tw.setTable`.
- **Spawning assets by URL:** scripts spawn built-in kinds (`tw.spawnObject`), library templates (`tw.spawnTemplate`) and serialized snapshots (`tw.spawnObjectJSON`) — there is no fetching of models or images from the web. Files get onto a table through the workbench or inside a [table archive](/docs/table-archives).
- **Other tabletops' saves and scripts:** a Tabletop Simulator save, mod or Global script is not a supported input — see [Table archives](/docs/table-archives#saves-from-other-tabletops) for what a conversion involves.
- **Timers across reloads:** `Wait` timers die when their script reloads — re-arm them in `onLoad`.
- **Precise physics contacts:** collision events are bounding-box overlaps, not mesh-accurate contact points (`tw.cast` rays *are* collider-accurate).
- **Per-player Lua:** scripts run on the server only; per-player behaviour is expressed through the player handle (dialogs, visibility, tools), not client-side code.
