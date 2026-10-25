---
title: Custom UI
description: Ribbon tabs, floating panels, context menus, hotkeys and hiding built-in UI — the declarative control vocabulary tableweb's own interface is built on.
order: 35
section: Table scripting
toc: true
---

Scripts put their own controls into the app: ribbon tabs and items, a corner panel, free-floating panels, context-menu entries and hotkeys. The base UI itself is built on this same API, so script controls look and behave exactly like the native ones.

Callbacks fire on the script that declared them, with `(player)` for a button and `(player, value)` for anything that carries a value. **Contributions are cleared on script reload — declare them in `onLoad`.**

## The control vocabulary

One shared control table format is used by ribbon items, the corner panel and floating panels. The kind key's value is the label:

| Kind | Extra keys | Callback |
| --- | --- | --- |
| `button = "Roll"` | — | `onClick(player)` |
| `toggle = "Auto"` | `on` (initial, default false) | `onChange(player, on)` |
| `slider = "Speed"` | `min` 0, `max` 100, `step` 1, `value` 0 | `onChange(player, n)` |
| `select = "Mode"` | `options = {"a","b"}`, `value` | `onChange(player, choice)` |
| `color = "Tint"` | `value` ("#ffffff") | `onChange(player, hex)` |
| `input = "Name"` | `value`, `placeholder` | `onChange(player, text)` on commit |
| `image = "<src>"` | `width`, `height` (px) | `onClick(player)` |
| `progress = "Load"` | `value` 0..1, read-only | drive via `setValue` by id |
| `text = "Score: 0"` | panel/corner-panel only | — |
| `{ separator = true }` | floating panels only | — |

Option keys valid on any control:

- `id` — needed to update the control later (`tw.ribbon.setValue`, `panel:setValue`, `tw.setUIValue`).
- `icon` — a context-menu icon name (`shuffle`, `rotl`, `layers`, `dice`, `lock`, `play`, ...); `iconColor` tints it.
- `disabled` — render greyed out.
- `column` — ribbon only: controls sharing a column index stack vertically.
- `locKey` — an i18n key resolved on the client instead of the literal label.
- `client` — instead of a callback, a client-local action with no server round-trip (below).
- `command` — instead of a callback, a native server command (`flip`, `shuffle`, `lock`, ...).

Recognised `client` actions: `panel:<id>` (toggle library/players/timemachine/settings), `spawn:<kind>` (spawn at the cursor), `tool:<id>` (switch tool; `""` = pointer), `editor:global` (open the table-script editor), `cmd:savetable`, `cmd:export`.

## Ribbon

```lua
function onLoad()
  tw.ribbon.addTab("My Game", {
    { group = "Turn", items = {
      { button = "Roll all", icon = "dice", onClick = "rollAll" },
      { toggle = "Auto draw", id = "auto", on = false, onChange = "setAuto" },
    }},
    { group = "Pace", items = {
      { slider = "Speed", id = "spd", min = 1, max = 10, value = 5, onChange = "onSpeed" },
      { progress = "Round", id = "prog", value = 0 },
    }},
  })
  -- or add to an existing tab/group:
  tw.ribbon.addItem("table", "Tools", { button = "Reset", icon = "rotl", onClick = "reset" })
end

function rollAll(player) ... end
function onSpeed(player, n)
  tw.ribbon.setValue("prog", n / 10)   -- live-update any control by id
end

tw.ribbon.clear()   -- drop this script's ribbon contributions
```

## Corner panel

A flat list of elements in a fixed corner — the quickest scoreboard:

```lua
local score = 0
function onLoad()
  tw.setUI({
    { text = "Score: 0", id = "score" },
    { button = "Add point", onClick = "add" },
    { toggle = "Hard mode", id = "hard", on = false, onChange = "setHard" },
  })
end
function add(player)
  score = score + 1
  tw.setUIValue("score", "Score: " .. score)
end

tw.clearUI()
```

## Floating panels

Positioned, laid-out toolbars — the built-in drawing toolbar is one of these. Same controls as the ribbon plus `text` and `{ separator = true }`; several can run at once.

```lua
function onLoad()
  panel = tw.createPanel({
    id = "brush", anchor = "top", layout = "row", title = "Brush",
    elements = {
      { button = "Clear", icon = "rotl", onClick = "onClear" },
      { separator = true },
      { toggle = "Snap", id = "snap", on = false, onChange = "onSnap" },
      { slider = "Size", id = "size", min = 1, max = 20, value = 4, onChange = "onSize" },
      { select = "Shape", id = "shape", options = { "line", "rect", "ellipse" }, onChange = "onShape" },
      { color = "Colour", id = "col", value = "#3366ff", onChange = "onColour" },
    },
  })
end
function onSize(player, n) panel:setValue("size", n) end
```

`anchor` is `top` / `bottom` / `left` / `right` / `center`, or `free` with `x` / `y` screen pixels. The handle has `:setValue(id, v)`, `:setTitle(t)`, `:close()`; the non-handle forms are `tw.setPanelValue(panelId, id, v)` and `tw.closePanel(panelId)`.

## Context menus

Right-click entries — on an object (`obj:addContextMenuItem`) or on the empty table (`tw.addContextMenuItem`). Either `(label, fnName)` or a table:

```lua
tw.addContextMenuItem({ label = "Show grid", icon = "layers", category = "view",
                        toggle = true, checked = true, onClick = "onGrid", keepOpen = true })
function onGrid(player, on) ... end

self:addContextMenuItem({ label = "Flip", command = "flip", icon = "flip" })   -- native command
self:addContextMenuItem({ label = "Deal", onClick = "deal", slider = { min = 1, max = 10 } })
self:addContextMenuItem({ label = "Spread", onClick = "spread", options = { "faceup", "facedown" } })
```

Fields: `label`, `onClick` (or `fn`) **or** `command`, `icon`, `category` (groups entries with dividers; `"danger"` renders red), `toggle` + `checked`, `keepOpen` (keep the menu up for repeated clicks), `slider = {min, max}` (numeric pick passed to the callback), `options = {...}` (a submenu of choices). Remove with `tw.clearContextMenu()` / `obj:clearContextMenu()`.

## Hotkeys

```lua
tw.addHotkey("r", "rollAll", "Roll all")    -- global: fires when not typing in a field
self:addHotkey("f", "onF", "Flip me")       -- object-scoped: only while THIS object
                                            -- is hovered or focused
tw.clearHotkeys()   / self:clearHotkeys()
```

Callbacks get `(player)`.

## Hiding built-in UI

The base UI is itself declared through this API, so a script can suppress any of it by id — build a focused play mode, hide tools from players, or replace a whole toolbar with your own:

```lua
tw.hideUI("group:draw")     -- the whole drawing toolbar
tw.hideUI("spawn:die")      -- the "spawn die" ribbon button
tw.hideUI("panel:players")  -- the Players button
tw.hideUI("toss")           -- the "toss" object-menu action
tw.showUI("toss")           -- bring it back
```

Ids use the same vocabulary as `client` actions and menu commands: `tool:<id>`, `panel:<id>`, `spawn:<kind>`, a control's `id`, a menu action name, or `group:<name>` for a bespoke ribbon group (grid/gizmo/camera/draw/measure/snap/zones/policy). Hides clear when the script reloads.

## Tablets

For in-world UI — a screen object players gather around rather than overlay chrome — spawn a tablet with a document and drive its elements from any script: see [tablet elements](/docs/scripting-objects#tablet-elements) and `tw.spawnTablet`.
