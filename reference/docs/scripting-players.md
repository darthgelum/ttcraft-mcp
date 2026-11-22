---
title: Players and turns
description: The player handle — capabilities, hands, dialogs, camera and tools, moderation — and the Turns system for turn order.
order: 34
section: Table scripting
toc: true
---

Event handlers receive a numeric `player` id; `tw.getPlayer(id)` turns it into a **player handle**. `tw.getPlayers()` lists the connected ids.

```lua
function onClick(player)
  local p = tw.getPlayer(player)
  if not p then return end
  if not p:can("edit") then
    p:print("You can't edit right now.")
    return
  end
  print(p:getDisplayName(), p:getColor(), p:getSeat())
end
```

## Identity and capabilities

```lua
p:id()              -- numeric player id
p:getName()         -- base name (account username for signed-in players)
p:getDisplayName()  -- nickname at this table, or the base name if unset
p:getColor()        -- seat color name ("black" = GM)
p:getSeat()         -- seat index
p:isHost()          -- true for a table manager (Owner/Admin)
p:getCaps()         -- list of effective capability names
p:can("play")       -- capability check: "play" | "edit" | "admin" | "owner"
p:changeColor("blue")  -- switch to blue, swapping with its current occupant if needed
```

Use `p:can(...)` with [veto hooks](/docs/scripting-events#veto-hooks) to enforce your rules. Capability checks include inherited permissions, so an Admin also has Play and Edit. `changeColor()` returns false for an unknown color or a player who has left.

Use `getDisplayName()` for labels and messages addressed to players. It reads the current nickname on each call, so it reflects a nickname change or reset as soon as the server applies it. Nicknames can change and can be shared by multiple players. Use the numeric player ID for lookups during the connection. For initialization, read the name in `onPlayerConnect(player)` and use `tw.getPlayers()` to cover players already present when your script loads.

## Presence: pointer, selection, hands

```lua
p:getPointerPosition()   -- cursor position on the table (Vector), nil if off-table
p:getPointerRotation()   -- the seat's facing yaw, degrees
p:getHoverObject()       -- the object under their cursor, or nil
p:getSelectedObjects()   -- handles they have selected
p:getHoldingObjects()    -- handles they are currently dragging
p:getHandCount()         -- cards in this player's hand
p:getHandObjects()       -- handles of the cards in their hand
p:getHandPosition()      -- their seat's dealing anchor (Vector)
p:getHandTransform()     -- { position, rotation, forward, right, up }
```

Where a seat *is* — its zone, the way it faces, a point in its own axes — comes from `Table.seat(p:getSeat())`; see [Table plan](/docs/table-plan#from-a-script-the-table-global).

## Messages and dialogs

```lua
p:print("Only you see this.")            -- console line to this player (alias p:broadcast)
p:showInfoDialog("The round is over.")
p:showConfirmDialog("End your turn?", function(ok)
  if ok then Turns.endTurn() end
end)
p:showInputDialog("Bet how much?", "10", function(ok, value)
  if ok then self:setVar("bet", tonumber(value) or 0) end
end)
p:showMemoDialog("Session notes", "", function(ok, text)
  if ok then self:setVar("notes", text) end
end)
p:showOptionsDialog("Pick a class", { "Warrior", "Mage", "Rogue" }, 1,
  function(ok, choice)
    if ok then self:setVar("class", choice) end
  end)
p:showColorDialog(nil, function(ok, colorName)
  if ok then self:setVar("color", colorName) end
end)
p:chooseInHand(function(card)
  if card then p:print("You picked a card.") end
end)
```

Dialog callbacks run once and are dropped if the owning script reloads before the player answers. `showMemoDialog()` accepts multiline text, `showOptionsDialog()` returns the selected string, and `showColorDialog()` returns a name from the seat palette. `chooseInHand()` opens a private pick and passes `nil` on cancel.

## Camera and pings

```lua
p:lookAt({ position = Vector(0, 0, 0), distance = 1.2, pitch = 55, yaw = 90 })
p:setCameraMode("top")        -- "top" | "front" | "side" | "free" | "default"
p:getCameraMode()
p:getCameraModes()            -- supported mode names, including aliases
p:attachCameraToObject({ object = hero, distance = 0.8, pitch = 45 })
p:detachCameraFromObject()
p:ping(0.1, 0, 0.2)           -- a brief ping ring on the table (also accepts a Vector)
```

## Tools

Drive the player's client-side tooling — a script toolbar can switch the native tool for them:

```lua
p:setTool("draw", { mode = "pencil", color = "#3366ff", width = 4 })
p:setTool("")                       -- back to the pointer
p:setToolOptions({ color = "#ff0000" })   -- tweak without switching
p:getToolIds()                         -- supported tool ids
```

Tool ids: `draw`, `zone`, `snap`, `measure`, `marker`, `gizmoMove`, `gizmoRotate`, `gizmoScale`, or `""`/nil for the pointer. Options: draw `mode`/`color`/`width`, gizmo `snap`/`space`, measure `unit` — only the keys you pass change.

## Moderation

Scripts can mute, blindfold, and kick players at the table. The script's author must have Admin or Owner permissions to promote or demote a player.

```lua
p:mute()                                  -- freeze game actions; p:mute(false) restores them
p:getMuted()
p:setBlindfolded(true)                    -- black out their view
p:getBlindfolded()
p:promote()                               -- grant Admin; p:demote() drops manager permissions
p:kick()                                  -- disconnect from the table
```

`mute` drops the player's capability-gated actions server-side without changing their configured caps. `promote`/`demote` adjust the capability set and always preserve the "a manager exists" invariant.

## Turns

`Turns` is the built-in turn-order system. State is server-side; everyone sees the turn indicator. `onPlayerTurn(current, previous)` fires on the Global script when the turn moves.

```lua
Turns.enable(true)          -- start turns (default order: seated players by seat)
Turns.isEnabled()
Turns.current()             -- whose turn it is (player id; 0 = none)
Turns.order()               -- read the current order
Turns.setOrder({3, 1, 2})    -- set a custom list of player IDs
Turns.endTurn()             -- advance (alias Turns.next())
Turns.previous()            -- step back
Turns.getNext()             -- peek forward; Turns.getPrevious() peeks back
Turns.pass()                -- advance, but only while passing is enabled
```

Behaviour flags (get/set pairs):

```lua
Turns.setReverse(true)              -- read with Turns.getReverse()
Turns.setSkipEmpty(true)            -- read with Turns.getSkipEmpty()
Turns.setPassEnabled(true)          -- read with Turns.getPassEnabled()
Turns.setDisableInteractions(true)  -- read with Turns.getDisableInteractions()
```

With interactions disabled out of turn, only the current player can use capability-gated commands. Commands that require no capability remain available.

Enforce turns yourself with the global `onPlayerAction` veto when you need finer rules:

```lua
function onPlayerTurn(cur, prev)
  local p = tw.getPlayer(cur)
  if p then tw.broadcastToAll(p:getDisplayName() .. "'s turn") end
end
function onPlayerAction(player, action, target)
  if player == 0 then return end -- table automation
  local current = Turns.current()
  if Turns.isEnabled() and current ~= 0 and player ~= current then return false end
end
```
