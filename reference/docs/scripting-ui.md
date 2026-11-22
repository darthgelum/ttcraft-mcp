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
| `counter = "Score"` | floating panels only. `value`, `step`, optional `min` and `max` | `onChange(player, n)` |
| `{ separator = true }` | floating panels only | — |

Common options:

- `id` — needed to update the control later (`tw.ribbon.setValue`, `panel:setValue`, `tw.setUIValue`).
- `icon` — a context-menu icon name (`shuffle`, `rotl`, `layers`, `dice`, `lock`, `play`, ...). On the ribbon, `iconColor` tints it.
- `disabled` — render greyed out.
- `column` — ribbon only: controls sharing a column index stack vertically.
- `locKey` — ribbon only. Use a translation key for the label.
- `need` — ribbon visibility condition such as `"edit"` or `"spawn"`. The server still checks permissions when a command runs.
- `client` — a named action dispatched by a ribbon control (below).
- `command` — a native server command dispatched by a ribbon control (`flip`, `shuffle`, `lock`, ...).

Recognised `client` actions: `panel:<id>` (for example `shelf`, `library`, `tableeditor`, `players` or `settings`), `spawn:<kind>` (spawn at the cursor), `tool:<id>` (switch tool, with an empty id for the pointer), `editor:global` (open the table-script editor), `cmd:savetable`, `cmd:export` and `cmd:import`.

## Ribbon

```lua
function onLoad()
  tw.ribbon.addTab("My Game", {
    { group = "Turn", items = {
      { button = "Roll all", icon = "dice", onClick = "rollAll" },
    }},
    { group = "Pace", items = {
      { slider = "Speed", id = "spd", min = 1, max = 10, value = 5, onChange = "onSpeed" },
      { progress = "Round", id = "prog", value = 0 },
    }},
  })
  -- or add to an existing tab/group:
  tw.ribbon.addItem("home", "ribbon.group.table",
    { button = "Roll all", icon = "dice", onClick = "rollAll" })
end

function rollAll(player)
  for _, object in ipairs(tw.getObjects()) do
    if object:kind() == "die" then object:roll() end
  end
end
function onSpeed(player, n)
  tw.ribbon.setValue("prog", n / 10)   -- live-update any control by id
end

-- Call tw.ribbon.clear() to remove this script's ribbon contributions.
```

## Corner panel

A flat list of elements in a fixed corner — the quickest scoreboard:

```lua
local score = 0
function onLoad()
  tw.setUI({
    { text = "Score: 0", id = "score" },
    { button = "Add point", onClick = "add" },
  })
end
function add(player)
  score = score + 1
  tw.setUIValue("score", "Score: " .. score)
end

-- Call tw.clearUI() to remove this script's corner panel.
```

## Floating panels

Positioned, laid-out toolbars — the built-in drawing toolbar is one of these. Same controls as the ribbon plus `text` and `{ separator = true }`; several can run at once.

```lua
function onLoad()
  panel = tw.createPanel({
    id = "brush", anchor = "top", layout = "row", title = "Brush",
    elements = {
      { slider = "Size", id = "size", min = 1, max = 20, value = 4, onChange = "onSize" },
      { separator = true },
      { text = "Current size: 4", id = "sizeLabel" },
    },
  })
end
function onSize(player, n)
  panel:setValue("size", n)
  panel:setValue("sizeLabel", "Current size: " .. n)
end
```

`anchor` is `top` / `bottom` / `left` / `right` / `center`, or `free` with `x` / `y` screen pixels. The handle has `:setValue(id, v)`, `:setTitle(t)`, `:close()`; the non-handle forms are `tw.setPanelValue(panelId, id, v)` and `tw.closePanel(panelId)`.

Every panel has a draggable title bar, minimize/restore and a close button.
The **Script windows** list reopens locally closed windows. Set `windowList = false` on a utility panel to omit it from this list. These presentation
choices belong to each client, including for a shared panel. Calling
`createPanel` again opens it again; `setValue`/`setTitle` update it without
undoing the player's decision to minimize or hide it. `panel:close()` is the
script removing the descriptor, so it disappears from that list too.

### UI for one player

Floating panels, player dialogs and tablet element visibility offer different ways to target the UI:

| Surface | Audience |
| --- | --- |
| `tw.createPanel` | Everyone by default, or one connected player by numeric table id. |
| [Player dialogs and pickers](/docs/scripting-players#messages-and-dialogs) | One player, through their handle from `tw.getPlayer(id)`. Useful for prompts and short interactions. |
| [Native tools](/docs/scripting-players#tools) | `player:setTool()` and `player:setToolOptions()` affect that player's client. A private toolbar can call them with the player ID received by its callback. |
| [Tablet elements](#tablet-element-visibility) | All players, the GM seat, editors, or selected seat colours. Visibility is evaluated for each element. |
| Ribbon, corner panel (`tw.setUI`), context-menu contributions, hotkeys and `tw.hideUI` | Shared contributions. The client can apply ribbon visibility conditions, and an object hotkey requires hover or focus. Use a targeted panel to send private content. |

Choose the panel audience with `scope` and `player`:

- With no `player`, the default is `scope = "shared"`. A shared panel has one descriptor and shared values.
- With a connected player's positive integer id, the default is `scope = "player"`. For private content, set this scope explicitly so a missing id produces an error.
- A player scope with no id, an invalid or disconnected id, an unknown scope, or a shared scope with an id raises an error. To reach a group, make one player-scoped panel per eligible id.

This object script opens a private inspector for the player who clicks. Use it on an object with a script-assigned name and an `hp` var:

```lua
function onClick(player)
  local viewer = tw.getPlayer(player)
  if not viewer then return end

  local title = self:getName()
  if title == "" then title = "Unit" end
  tw.createPanel({
    id = "unit", scope = "player", player = player,
    title = title,
    elements = {
      {text = "HP: " .. (self:getVar("hp") or 0), id = "hp"},
      {button = "Close", onClick = "closeInspector"},
    },
  })
end

function closeInspector(player)
  tw.closePanel("unit", player)
end
```

The server sends private descriptors only to their intended recipient, including during initial state sync. The same script can use the same panel id for different players or for a shared panel. A handle remembers the audience. For functional updates, pass the target id as the last argument to `tw.setPanelValue(id, element, value, player)` or `tw.closePanel(id, player)`. Omitting it addresses the shared panel.

Panel callbacks run in server Lua and receive the actual player who clicked. The server checks that the active panel and control are available to that player. In a callback that changes game state, separately verify the player's permission to make that change. Object visibility and shared data follow their own rules.

On disconnect, the server discards that player's private panels. Recreate them after a new `onPlayerConnect` if your module needs them immediately, or reopen them on the next click. Resolve the live player id again on every join. One-off dialogs are sent directly to the selected player and can be opened again if the session needs a new answer.

## Context menus

Right-click entries — on an object (`obj:addContextMenuItem`) or on the empty table (`tw.addContextMenuItem`). Either `(label, fnName)` or a table:

```lua
tw.addContextMenuItem({ label = "Show grid", icon = "layers", category = "view",
                        toggle = true, checked = true, onClick = "onGrid", keepOpen = true })
function onGrid(player, on) Grid.setVisible(on) end

self:addContextMenuItem({ label = "Flip", command = "flip", icon = "flip" })   -- native command
```

Use `label`, `icon` and `category` to present the item. Use `onClick` (or `fn`) for a Lua callback, or `command` for a native action. A button calls its function with `(player)`. A toggle defined with `toggle = true` and an initial `checked` state passes `(player, on)`. Set `keepOpen` to keep the menu open after a button click. For numeric or choice callbacks in Lua, use a slider or select in a [floating panel](#floating-panels). Remove items with `tw.clearContextMenu()` or `obj:clearContextMenu()`.

## Hotkeys

```lua
tw.addHotkey("r", "rollAll", "Roll all")    -- global: fires when not typing in a field
self:addHotkey("f", "onF", "Flip me")       -- object-scoped: only while THIS object
                                            -- is hovered or focused
-- Call tw.clearHotkeys() or self:clearHotkeys() to remove the bindings.
```

Callbacks get `(player)` by default. Add `{hold = true}` after the function name or optional label to receive `(player, true)` on key-down and `(player, false)` on key-up. Both global and object hotkeys accept this option.

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

For an in-world screen, use `tw.spawnTablet` with a document. Page size and element rectangles are measured in pixels. This Global script places a board once and finds it by its GUID alias on reload:

```lua
function onLoad()
  if tw.getObjectFromGUID("round-board") then return end
  local board = tw.spawnTablet({
    position = {x = 0, y = 0.1, z = 0},
    document = {
      v = 3, page = {w = 600, h = 360},
      sides = {{active = "p1", pages = {{id = "p1", name = "Round"}}}},
      elements = {
        {id = "title", type = "label", side = 0, page = "p1",
         rect = {24, 24, 552, 96}, text = "Round 1"},
      },
    },
  })
  if board then board:setGuid("round-board") end
end
```

Any table script with the object's handle can update its [tablet elements](/docs/scripting-objects#tablet-elements). For interactive elements, set `action` to a named function in the tablet's **own** script. The callback receives `(player, value, elementId)`. A plain button passes `nil` for the value.

### Tablet element visibility

In **Edit tablet**, set an element's visibility, or put a `vis` rule on the element in Lua. The supported modes are `"all"` (the default), `"gm"` (the black GM seat), `"editors"` (players with Edit capability, plus the GM), and `"colors"` (the listed seat colours, plus the GM). An empty colour list leaves the element visible only to the GM.

```lua
local privateLabel = {
  id = "red-score", type = "label", side = 0, page = "p1",
  rect = {24, 120, 552, 48}, text = "Your score: 3",
  vis = {mode = "colors", colors = {"red"}},
}
```

The server sends each player only the elements they can see, rejects interaction with hidden elements, and refreshes affected documents after seat or capability changes. An element scoped by colour follows that seat. Keep player-specific content in a scoped element or a private panel. Page backgrounds belong to the page itself.

The document-level `edit` rule separately controls who can save the layout. It defaults to editors. The GM can assign it to selected seat colours with `edit = {mode = "colors", colors = {"red"}}`. The GM and table managers have access to edit even when a colour list is set. Each player sees elements according to their `vis` rule while editing, and their save preserves elements they could not see.
