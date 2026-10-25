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
  print(p:getName(), p:getColor(), p:getSeat())
end
```

## Identity and capabilities

```lua
p:id()           -- numeric player id
p:getName()      -- display name
p:getColor()     -- seat color name ("black" = GM)
p:getSeat()      -- seat index
p:isHost()       -- true for a table manager (Owner/Admin)
p:getCaps()      -- list of capability names
p:can("play")    -- capability check: "play" | "edit" | "admin" | "owner"
                 -- (implications applied: an admin can everything a player can)
p:changeColor("blue")   -- move the player to another seat color; false if taken
```

Capabilities are the rule-enforcement primitive: combine `p:can(...)` with [veto hooks](/docs/scripting-events#veto-hooks) to decide who may do what.

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
p:showMemoDialog("Session notes", "", function(ok, text) ... end)   -- multi-line
p:showOptionsDialog("Pick a class", { "Warrior", "Mage", "Rogue" }, 1,
  function(ok, choice) ... end)                                     -- choice = the string
p:showColorDialog(function(ok, colorName) ... end)                  -- seat palette
p:chooseInHand(function(card) ... end)   -- private pick from their own hand (nil = cancel)
```

Dialog callbacks are **one-shot**: they fire once, and are dropped if the owning script reloads before the player answers.

## Camera and pings

```lua
p:lookAt({ position = Vector(0, 0, 0), distance = 1.2, pitch = 55, yaw = 90 })
p:setCameraMode("top")        -- "top" | "front" | "side" | "free" | "default"
p:getCameraMode()
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
```

Tool ids: `draw`, `zone`, `snap`, `measure`, `marker`, `gizmoMove`, `gizmoRotate`, `gizmoScale`, or `""`/nil for the pointer. Options: draw `mode`/`color`/`width`, gizmo `snap`/`space`, measure `unit` — only the keys you pass change.

## Moderation

Moderation is trusted: scripts are authored by whoever controls the table, so these take effect from any script.

```lua
p:mute()             / p:mute(false)      -- freeze / unfreeze their game actions
p:getMuted()
p:setBlindfolded(true)                    -- black out their view
p:getBlindfolded()
p:promote()          / p:demote()         -- raise to / drop from table manager
p:kick()                                  -- disconnect from the table
```

`mute` drops the player's capability-gated actions server-side without changing their configured caps. `promote`/`demote` adjust the capability set and always preserve the "a manager exists" invariant.

## Turns

`Turns` is the built-in turn-order system. State is server-side; everyone sees the turn indicator. `onPlayerTurn(current, previous)` fires on the Global script when the turn moves.

```lua
Turns.enable(true)          -- start turns (default order: seated players by seat)
Turns.isEnabled()
Turns.current()             -- whose turn it is (player id; 0 = none)
Turns.order()               / Turns.setOrder({3, 1, 2})
Turns.endTurn()             -- advance (alias Turns.next())
Turns.previous()            -- step back
Turns.getNext()             / Turns.getPrevious()   -- peek without moving
Turns.pass()                -- advance, but only while passing is enabled
```

Behaviour flags (get/set pairs):

```lua
Turns.setReverse(true)              / Turns.getReverse()
Turns.setSkipEmpty(true)            / Turns.getSkipEmpty()            -- skip empty seats
Turns.setPassEnabled(true)          / Turns.getPassEnabled()
Turns.setDisableInteractions(true)  / Turns.getDisableInteractions()  -- only the current
                                    -- player may act while enabled
```

Enforce turns yourself with the global `onPlayerAction` veto when you need finer rules:

```lua
function onPlayerTurn(cur, prev)
  tw.broadcastToAll(tw.getPlayer(cur):getName() .. "'s turn")
end
function onPlayerAction(player, action, target)
  if Turns.isEnabled() and player ~= Turns.current() then return false end
end
```
