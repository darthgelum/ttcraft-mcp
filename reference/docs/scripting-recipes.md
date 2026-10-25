---
title: Scripting recipes
description: Complete worked examples — dealers, scoring zones, custom dice, turn rules, hidden information and templated spawning.
order: 36
section: Table scripting
toc: true
---

Copy-paste starting points. Each recipe is a complete script for the object named in its title (or the Global script where said).

## A deal button

Attach to any object sitting next to a deck; clicking it deals one card to the clicking player.

```lua
function onClick(player)
  local deck = self:objectBelow()
  if deck and deck:kind() == "deck" then
    deck:dealToHand(player, 1)
  end
end
```

## Roll everything, announce the total

Global script: a ribbon button rolls every die, then a condition-timer waits for them to settle and announces the sum.

```lua
function onLoad()
  tw.ribbon.addItem("table", "Dice", { button = "Roll all", icon = "dice", onClick = "rollAll" })
end

function rollAll(player)
  local dice = {}
  for _, o in ipairs(tw.getObjects()) do
    if o:kind() == "die" then o:roll(); dice[#dice + 1] = o end
  end
  if #dice == 0 then return end

  Wait.condition(function()
    local sum = 0
    for _, d in ipairs(dice) do sum = sum + (d:getValue() or 0) end
    tw.broadcastToAll("Rolled " .. sum)
  end, function()
    for _, d in ipairs(dice) do
      if d:getValue() == nil then return false end   -- still tumbling
    end
    return true
  end, 10)   -- give up after 10 s
end
```

## A scoring zone

Global script: anything tagged `vp` dropped into the zone updates a counter named `score`.

```lua
function onLoad()
  tw.createZone({ position = {x = 0.6, y = 0.1, z = 0.4},
                  scale = {x = 0.3, y = 0.3, z = 0.3}, tags = {"vp"} })
end

local function refresh(zone)
  local counter = tw.getObjectFromGUID("score")
  if counter then counter:setValue(#zone:getObjects()) end
end

function onObjectEnterZone(zone, obj) refresh(zone) end
function onObjectLeaveZone(zone, obj) refresh(zone) end
```

## A custom d3 from any object

Rotation values turn any prop into a die; `randomize` (the R key) tosses it.

```lua
function onLoad()
  self:setRotationValues({
    { value = 1, rotation = {0, 0, 0} },
    { value = 2, rotation = {90, 0, 0} },
    { value = 3, rotation = {0, 0, 90} },
  })
end

function onRandomize(player)
  Wait.condition(function()
    tw.broadcastToAll("It landed on " .. tostring(self:getRotationValue()))
  end, function() return self:getValue() ~= nil end, 8)
end
```

## House rules: turn order enforced

Global script: only the current player may act, except managers; flipping the score counter is always forbidden.

```lua
function onLoad()
  Turns.enable(true)
end

function onPlayerTurn(cur, prev)
  local p = tw.getPlayer(cur)
  if p then tw.broadcastToAll(p:getName() .. "'s turn") end
end

function onPlayerAction(player, action, target)
  local p = tw.getPlayer(player)
  if p and p:isHost() then return end            -- managers bypass the rules
  if target and target:guid() == "score" then return false end
  if Turns.isEnabled() and player ~= Turns.current() then return false end
end
```

## Owner-only pieces

Object script: only the player recorded in the `owner` var may pick it up or flip it.

```lua
local function isOwner(player)
  return self:getVar("owner") == nil or self:getVar("owner") == player
end

function tryGrab(player) return isOwner(player) end
function tryFlip(player) return isOwner(player) end

function onDrop(player)
  if self:getVar("owner") == nil then
    self:setVar("owner", player)     -- first to place it claims it
  end
end
```

## Templated spawning

Serialize a fully dressed object once, stamp copies later — the snapshot keeps the skin, script and contents.

```lua
-- On the template object, e.g. from its context menu:
function onLoad()
  self:addContextMenuItem("Save as template", "save")
  tw.addHotkey("g", "spawnOne", "Spawn goblin")
end

function save(player)
  tw.store("goblin", self:getJSON())
  tw.getPlayer(player):print("Template saved.")
end

function spawnOne(player)
  local json = tw.get("goblin")
  if json then
    local p = tw.getPlayer(player):getPointerPosition() or Vector(0, 0.3, 0)
    tw.spawnObjectJSON({ json = json, position = {x = p.x, y = 0.3, z = p.z} })
  end
end
```

## Hidden information

A GM screen: objects the GM drops into the hidden zone are visible only to them; everyone else sees silhouettes.

```lua
-- Global script. Player 1 is the GM here; use p:can("admin") to find one dynamically.
function onLoad()
  tw.createZone({ position = {x = -0.7, y = 0.1, z = 0}, scale = {x = 0.4, y = 0.3, z = 0.4},
                  owner = 1, hidden = "masked" })
end
```

Per-object visibility works without zones too:

```lua
card:setInvisibleTo({2, 3})   -- players 2 and 3 don't see it at all
card:setHiddenFrom({2})       -- player 2 sees an anonymous grey shape
```

## A tidy discard pile

A layout zone that melds dropped cards into one face-up deck.

```lua
function onLoad()
  tw.createZone({ position = {x = 0.45, y = 0.1, z = -0.2},
                  scale = {x = 0.25, y = 0.3, z = 0.35}, tags = {"card"},
                  layout = { combine = true, facing = "up" } })
end
```
