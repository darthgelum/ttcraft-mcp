---
title: World reference
description: The tw global and friends — finding and spawning objects, zones, snap points, physics casts, persistent storage, grid, hands, lighting, music, timers, vectors.
order: 33
section: Table scripting
toc: true
---

Everything table-wide lives on the `tw` global, with a few sibling globals for subsystems: `Table`, `Grid`, `Hands`, `Lighting`, `Music`, `Turns`, `Wait`, `JSON`, `Vector`, `Color`. This page covers all of them except the [player handle and Turns](/docs/scripting-players), the [UI builders](/docs/scripting-ui) and `Table` — the table's size, outline, seats and named areas — which has its own page, [Table plan](/docs/table-plan#from-a-script-the-table-global).

Anywhere a function takes an object you may pass a handle, a numeric id or a guid string.

## Finding objects

```lua
tw.getObject(id)                     -- handle or nil (numeric id)
tw.getObjectFromGUID("deck1")        -- by string id / alias
tw.getObjects()                      -- every object on the table
tw.getObjectsWithTag("die")          -- objects carrying a tag
tw.getObjectsWithAnyTags({"a", "b"}) -- at least one of the tags
tw.getObjectsWithAllTags({"a", "b"}) -- all of the tags
tw.distance(a, b)                    -- metres between two objects; -1 if missing
```

## Spawning

```lua
tw.spawnObject({ type = "die", position = {x=0, y=0.3, z=0} })       -- returns the handle
tw.spawnObject({ type = "card", code = 14, faceUp = true })           -- ace of diamonds
tw.spawnObject({ type = "deck" })                                     -- full 52-card deck
```

`type` is one of `die`, `chip`, `coin`, `deck`, `card`, `counter`, `clock`, `note`, `tablet` (an unknown string falls back to a d6 die). `code` and `faceUp` apply to cards; position defaults to `{0, 0.3, 0}`.

`tw.spawnTemplate` spawns anything the object **library** holds — custom models, skins, filled bags, whole sets — by template id or gallery name, built exactly as the library window builds it (skin, contents, snap points and the template's script included; a `set` template puts its whole pile down and returns the first piece):

```lua
tw.spawnTemplate("goblin", { position = {x=0.3, y=0.2, z=0} })   -- handle or nil
tw.spawnTemplate({ template = "Leather bag" })                    -- by gallery name
```

And anything that exists (or existed) on the table can be respawned from a **snapshot**:

```lua
local json = template:getJSON()                    -- serialize any live object
tw.spawnObjectJSON({ json = json, position = {x=0.3, y=0.2, z=0} })
tw.spawnObjectData({ data = template:getData() })  -- same, from a Lua table
tw.spawnTablet({ position = {x=0, y=0.1, z=0}, document = { ... } })  -- tablet + UI document
tw.destroyObject(obj)
```

Snapshots carry everything: kind, skin, contents, physics properties, script with its vars. Keep a serialized template in `tw.setTable` (or an infinite bag) and stamp out copies at runtime.

## Groups, copy and paste

```lua
tw.group({a, b, c})        -- weld objects into one rigid assembly; returns group id (0 = none)
tw.ungroup(obj)            -- dissolve the group obj belongs to
tw.copy({a, b})            -- clipboard snapshot (full fidelity, offsets kept)
tw.paste({ position = {x=0, y=0.3, z=0} })  -- fresh copies at position + each offset; handles
```

`clone` / `reload` / `copy` / `paste` are full clones: kind, contents, transform, physics, the visual skin and the script with its data. Copying a welded group pastes a re-welded group.

## Physics casts

```lua
tw.cast({ origin = {x=0, y=1, z=0}, direction = {x=0, y=-1, z=0} })          -- ray
tw.cast({ shape = "sphere", origin = p, size = 0.1 })                        -- radius
tw.cast({ shape = "box", origin = p, size = {x=0.4, y=0.2, z=0.4} })         -- full size
```

Returns a list of hits `{ object, point, distance }`, sorted nearest first (empty if nothing). The ray reports every object it crosses within `maxDistance` (default 100 m). Sphere and box are real collider-vs-shape overlap tests; for them `point` is the object's centre.

```lua
-- what is directly below me?
local p = self:getPosition()
for _, hit in ipairs(tw.cast({ origin = {x=p.x, y=p.y + 1, z=p.z}, direction = {x=0, y=-1, z=0} })) do
  print("hit:", hit.object:kind(), hit.distance)
end
```

## Persistent storage

Table-wide state, stored in the table's database — survives restarts, saves and rollbacks:

```lua
tw.store("round", 3)              -- values round-trip through JSON, tables included
tw.get("round")                   -- 3 (nil if absent)
tw.del("round")

tw.setTable("scores", { alice = 10, bob = 7 })   -- whole-table shared state
tw.getTable("scores")             -- an independent copy; setTable again to write back
tw.setTable("scores", nil)        -- clear
```

Per-object equivalents (`obj:setVar`, `obj:setTable`) live on the [object handle](/docs/scripting-objects#shared-data-and-cross-script-calls).

## Zones

A **scripting zone** is an invisible box the engine tracks every frame. Enter/leave events fire on the script that created it. Zones are ephemeral — recreate them in `onLoad`.

The zones the table editor or a [table plan](/docs/table-plan) made are different: they persist with the table, fire no events, and are reached by name with `Table.area("draw")` (or through `obj:getZones()`). Their handles work the same way, and a change made through one is shown to every player.

```lua
function onLoad()
  discard = tw.createZone({ position = {x=0, y=0.1, z=0}, scale = {x=0.4, y=0.4, z=0.4} })
end
function onObjectEnterZone(zone, obj)
  print(obj:kind(), "entered;", #zone:getObjects(), "inside")
end
function onObjectLeaveZone(zone, obj) print(obj:kind(), "left") end
```

`tw.createZone` options:

| Key | Meaning |
| --- | --- |
| `position`, `scale` | box centre and **full** size (metres) |
| `tags` | list of tag names — only matching objects are tracked |
| `layout` | a table of layout options — makes it a layout zone (below) |
| `owner`, `hidden` | hidden zone: contents visible only to `owner`; `hidden = true` hides them from others entirely, `"masked"` shows grey silhouettes |

Zone handle methods:

```lua
zone:id()
zone:getPosition()  / zone:setPosition(v)
zone:getScale()     / zone:setScale(v)
zone:getRotation()  / zone:setRotation(45)     -- yaw degrees; containment follows
zone:getObjects()                              -- handles inside right now
zone:getName()      / zone:getSeat()           -- a plan area's name (""), a seat zone's seat (-1)
zone:setHidden(ownerId, "masked")              -- re-aim the hidden mode later
zone:getOptions()   / zone:setOptions(tbl)     -- read/patch layout options
zone:layout()                                  -- force an immediate re-arrange
zone:destroy()
```

### Layout zones

With a `layout` table the zone keeps its contained (un-held) objects arranged automatically — drop cards in and they tidy into a row.

```lua
tw.createZone({ position = {x=0, y=0.1, z=-0.5}, scale = {x=1, y=0.3, z=0.3},
                tags = {"card"},
                layout = { spacing = 0.09, perRow = 0, alternate = false } })
```

Layout options (any subset; setting one implies `layout = true`):

| Key | Meaning |
| --- | --- |
| `spacing` | gap between cells, metres |
| `perRow` | columns along X; `0` = a single row |
| `direction` | `"right"`, `"left"`, `"forward"`, `"back"` — growth direction |
| `alternate` | snake rows (boolean) |
| `facing` | `"keep"`, `"up"`, `"down"` — force orientation on entry |
| `hspread`, `vspread` | per-axis spacing overrides, metres |
| `combine` | meld loose cards into decks |
| `maxPerGroup` | split melded decks into piles of at most N |
| `sort` | `"none"`, `"name"`, `"value"`, `"custom"` — custom calls your `groupSort(zone, objects)` which returns the reordered list |

## Snap points

Table-global snap points: absolute positions a *dropped* object is pulled to. Applied by the server on release — within `range` (XZ metres) the object jumps to the point and adopts its yaw. Ephemeral like zones — declare in `onLoad`.

```lua
tw.setSnapPoints({
  { position = {x = 0.25, y = 0.02, z = 0.15} },
  { position = {x = -0.25, y = 0.02, z = 0.15},
    rotation = 90, range = 0.08, tags = {"meeple"} },
})
tw.getSnapPoints()    / tw.clearSnapPoints()
```

Per-object (object-relative) snap points exist too — `obj:setSnapPoints` in the [objects reference](/docs/scripting-objects#per-object-snap-points).

## Effects and sound

```lua
local id = tw.effect({ preset = "confetti", position = {x=0, y=0.2, z=0} })
tw.stopEffect(id)

tw.playSound({ asset = "assets/bell.ogg", position = {x=1, y=0, z=-2},
               volume = 0.6, rate = 1.2 })       -- one-shot, spatialised
tw.playSound({ asset = "assets/ding.ogg" })      -- non-spatial
```

`obj:playSound` and `obj:createEffect` attach to an object instead — see the [objects reference](/docs/scripting-objects#particle-effects-and-sound). Sound assets live in the object library; paths are relative (`assets/clack.ogg`).

### Music — shared and synchronised

One authoritative track for everyone; the server derives playback position from its clock, so late joiners start at the right spot.

```lua
Music.play({ asset = "assets/ambient.ogg", volume = 0.4, loop = true })
Music.pause()   / Music.resume()   / Music.stop()
Music.seek(30000)          -- milliseconds
Music.setVolume(0.25)      / Music.setRate(1.0)

-- Ambience layers over the main track:
Music.layer({ asset = "assets/rain.ogg", loop = true, gain = 0.3 })
Music.setLayer({ id = 1, gain = 0.5, playing = true })
Music.stopLayer(1)         / Music.stopLayers()
Music.setDuck(0.5)         -- lower layers while the main track plays
```

`Music.pause("all")` / `Music.resume("layers")` scope the action to the track, the layers or both.

## Grid, hands and lighting

```lua
Grid.set({ type = "hex", size = 0.05, color = "#334455", visible = true, snap = true })
Grid.setType("rect")  / Grid.setSnapping(true) / Grid.setVisible(false)
Grid.get()

Hands.setEnabled(true)          / Hands.isEnabled()
Hands.setHiding("reverse")      -- "default" | "reverse" | "disable"
Hands.getHiding()

Lighting.set({ env = "night", exposure = 0.9,
               sun = { intensity = 2, azimuth = 45, elevation = 30 } })
Lighting.setEnv("studio")       -- "studio" | "soft" | "night"
Lighting.setExposure(1.1)       / Lighting.setSun({ color = "#ffe0c0" })
Lighting.get()
```

All three patch only the keys you pass, are server-authoritative and persist with the table.

## Console output

```lua
print("value", 42)          -- browser console, prefixed with the script's object id
tw.log("same thing")        / tw.logError("bad state")
tw.broadcastToAll("Go!")    -- a line to every player (alias tw.printToAll)
tw.printToColor("psst", 2)  -- a line to player 2 (alias tw.broadcastToColor)
```

Note the argument order of `printToColor`: message first, player second.

```lua
tw.stringColorToRGB("red")  -- seat-palette name -> {r=, g=, b=} in 0..1
```

## Wait — timers

```lua
Wait.time(fn, seconds)             -- run fn once after a delay
Wait.time(fn, seconds, reps)       -- repeat reps times (reps < 0 = forever)
Wait.frames(fn, n)                 -- run fn after n server frames
Wait.condition(fn, cond)           -- run fn when cond() first returns true
Wait.condition(fn, cond, timeout, onTimeout)
local id = Wait.time(fn, 5)
Wait.stop(id)                      / Wait.stopAll()   -- scoped to the calling script
```

Timers are dropped when their script reloads — re-arm them in `onLoad`.

## Vector

`Vector(x, y, z)` or `Vector({x=, y=, z=})`; every vector the API returns already has these methods. Operators `+`, `-`, `==` and `*` (scalar or componentwise) work.

```lua
local a = Vector(1, 0, 0) + Vector(0, 0, 1)
a:magnitude()     / a:sqrMagnitude()
a:normalized()    -- a copy; a:normalize() mutates in place
a:dot(b)          / a:cross(b)
a:distance(b)     / a:lerp(b, t)
a:scale(2)        / a:copy()
local x, y, z = a:get()
Vector.distance(a, b)   / Vector.between(a, b)
```

## Color

```lua
local c = Color(1, 0, 0)          -- r, g, b, a (a defaults to 1)
Color.Red  Color.Green  Color.Blue  Color.White  Color.Black  Color.Yellow
c:lerp(other, t)   / c:toHex()    -- "RRGGBBAA"
c:copy()
```

## JSON

```lua
local s = JSON.encode({ name = "deck", cards = {1, 2, 3} })
local t = JSON.decode(s)          -- t.name, t.cards[1]; nil on parse error
```
