---
title: World reference
description: The tw global and friends — finding and spawning objects, zones, snap points, physics casts, persistent storage, grid, hands, lighting, music, timers, vectors.
order: 33
section: Table scripting
toc: true
---

Everything table-wide lives on the `tw` global, with a few sibling globals for subsystems: `Table`, `Grid`, `Hands`, `Lighting`, `Music`, `Turns`, `Wait`, `JSON`, `Vector`, `Color`. This page covers all of them except the [player handle and Turns](/docs/scripting-players), the [UI builders](/docs/scripting-ui) and `Table` — the table's size, outline, seats and named areas — which has its own page, [Table plan](/docs/table-plan#from-a-script-the-table-global).

`tw.getObject(id)` takes a numeric id and `tw.getObjectFromGUID(guid)` takes a string. Helpers such as `tw.distance`, `tw.group` and `tw.copy` accept handles, numeric ids or GUID strings.

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

`tw.getSpawnTypes()` lists the built-in types supported by `tw.spawnObject`: `die`, `chip`, `coin`, `deck`, `card`, `counter`, `clock`, `note` and `tablet`. An unknown type falls back to a d6. `code` and `faceUp` apply to cards and default to `1` and `false`. Position defaults to `{x=0, y=0.3, z=0}`. A failed spawn returns `nil`.

`tw.spawnTemplate` spawns anything the object **library** holds — custom models, skins, filled bags, whole sets — by template id or gallery name, built exactly as the library window builds it (skin, contents, snap points and the template's script included; a `set` template puts its whole pile down and returns the first piece):

```lua
tw.spawnTemplate("goblin", { position = {x=0.3, y=0.2, z=0} })   -- handle or nil
tw.spawnTemplate({ template = "Leather bag" })                    -- by gallery name
```

`tw.getTemplates()` lists the library as entries with `id`, `name`, `category` and `kind`. Use the `id` for built-ins, whose names may be translation keys.

An object can also be respawned from a **snapshot**:

```lua
local json = template:getJSON()                    -- serialize any live object
tw.spawnObjectJSON({ json = json, position = {x=0.3, y=0.2, z=0} })
tw.spawnObjectData({ data = template:getData() })  -- same, from a Lua table
tw.destroyObject(obj)
```

Snapshots carry kind, skin, contents, physics properties and script data. Omit `position` to use the position in the snapshot. Keep a serialized template in `tw.setTable` (or an infinite bag) and stamp out copies at runtime.

`tw.spawnTablet({position = ..., document = ...})` creates a tablet with an authored document. See the [tablet document example](/docs/scripting-ui#tablets).

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

Use `tw.store` for table-wide values that should survive restarts and travel in exported archives. Use `tw.setTable` for table-wide state that should follow snapshots during Time Machine rollback.

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

Zones from the editor or a [table plan](/docs/table-plan) persist with the table. Their enter and leave events go to the Global script. Find a named area with `Table.area("draw")`, or look up an object's zones with `obj:getZones()`. Editing the zone through its handle updates the shared table.

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
| `owner`, `hidden` | player ID and visibility mode for a [hidden zone](#hidden-zones) |

Zone handle methods:

```lua
zone:id()
zone:getPosition()
zone:setPosition(v)
zone:getScale()
zone:setScale(v)
zone:getRotation()
zone:setRotation(45)     -- yaw degrees; containment follows
zone:getObjects()                              -- handles inside right now
zone:getName()           -- plan area's name; "" for an unnamed zone
zone:getSeat()           -- seat index; -1 for a zone outside the seat ring
zone:setHidden(ownerId, "masked")              -- re-aim the hidden mode later
zone:getOptions()
zone:setOptions(tbl)     -- read/patch layout options
zone:layout()                                  -- force an immediate re-arrange
zone:destroy()
```

### Hidden zones

As an editor, open **Tools → Zone**, then select the zone on the table. In the
**Zone** tab, choose a player under **Owner** and a mode under **Hidden**.
Test the result from the owner's view and a second player's view.

| Mode | Other players see |
| --- | --- |
| **Off** | Normal appearance, subject to any other active visibility rules. |
| **Invisible** | No live object while it is in the zone. |
| **Masked** | A grey silhouette that shows the object's position and shape. Use Invisible when the piece itself should be private. |

The owner is a numeric player ID from the live roster. Choosing **Nobody**
leaves an invisible or masked zone without a viewer who can see through it.
GM and editor roles alone do not bypass the zone's visibility. The usual
explicit hand-access permissions still apply when the hidden zone covers its
owner's protected hand.

An object enters the zone when its position is inside the box on all three
axes, including height. A tagged zone matches objects with at least one of
the listed script tags. As the object moves out, the zone's restriction ends.
Overlapping zones and [per-object visibility rules](/docs/scripting-objects#per-player-visibility)
can keep it hidden. An Invisible restriction takes precedence over Masked.
Pieces keep their physics and can still collide. A hidden zone's owner
controls visibility. A seat's **Hand zone** switch separately controls whether
a drop goes into the player's hand.

In Lua, pass `owner` and `hidden` to `tw.createZone()`. Use `true` or
`"invisible"` for Invisible, `"masked"` or `"hidden"` for Masked, and
`false` for Off. Change an existing zone with
`zone:setHidden(playerId, "invisible")`; pass `false` as the second argument to
turn it off. This example belongs on a controller object outside the zone.

```lua
local privateZone

function onClick(playerId)
  local player = tw.getPlayer(playerId)
  if not player or not player:can("edit") then return end
  if not privateZone then
    privateZone = tw.createZone({
      position = {x = 0, y = 0.15, z = 0},
      scale = {x = 0.5, y = 0.4, z = 0.5},
      owner = playerId,
      hidden = "invisible"
    })
  else
    privateZone:setHidden(playerId, "invisible")
  end
end
```

For a reusable module, assign the owner from the live roster. Reassign it when
the seat changes hands. In the Global script's `onPlayerDisconnect`, reset
`zone:setHidden(0, "invisible")` if the contents should stay private while the
owner is away. Player IDs can be reused. A named [plan area](/docs/table-plan#areas)
can provide the geometry through `Table.area(name)`. Recreate zones made with
`tw.createZone()` when your script loads if they are part of the module setup.
Exports include saved objects inside hidden zones. Review the contents before
sharing an archive. [Table archives](/docs/table-archives)

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

Table-global snap points are absolute positions that attract dropped objects. Within `range` (XZ metres, 0.05 by default) the object snaps to the point and adopts its yaw when one is specified. `tw.setSnapPoints`, `tw.getSnapPoints` and `tw.clearSnapPoints` operate on the shared set of script-created points. Points placed through the table editor are stored separately.

```lua
tw.setSnapPoints({
  { position = {x = 0.25, y = 0.02, z = 0.15} },
  { position = {x = -0.25, y = 0.02, z = 0.15},
    rotation = 90, range = 0.08, tags = {"meeple"} },
})
tw.getSnapPoints()
tw.clearSnapPoints()
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

`obj:playSound` plays a sound at an object's position. `obj:createEffect` attaches an effect that follows the object. See the [objects reference](/docs/scripting-objects#particle-effects-and-sound). Call `tw.getEffectPresets()` for built-in preset keys. `tw.getSounds()` returns uploaded sounds as entries with `name`, `url` and `folder`. Use the entry's `url` as the `asset` for sound or music playback.

### Music — shared and synchronised

One authoritative track for everyone; the server derives playback position from its clock, so late joiners start at the right spot.

```lua
Music.play({ asset = "assets/ambient.ogg", volume = 0.4, loop = true })
Music.pause()
Music.resume()
Music.stop()
Music.seek(30000)          -- milliseconds
Music.setVolume(0.25)
Music.setRate(1.0)

-- Ambience layers over the main track:
Music.layer({ asset = "assets/rain.ogg", loop = true, gain = 0.3 })
Music.setDuck(0.5)         -- reduce the main track while a ducking layer plays
Music.stopLayers()         -- remove all layers
```

`Music.pause("all")` / `Music.resume("layers")` scope the action to the track, the layers or both.

Adjust or stop an individual layer with `Music.setLayer({id = layerId, gain = 0.5})` or `Music.stopLayer(layerId)`. Layer ids are strings generated at runtime, such as `"ly1"`. They are available in the table's music state. `Music.layer` starts playback without returning an id. `Music.getPlaylists()` gives saved playlists as `{id, name, tracks}`, with asset URLs in `tracks`.

## Grid, hands and lighting

```lua
Grid.set({ type = "hex", size = 0.05, color = "#334455", visible = true, snap = true })
Grid.setType("rect")
Grid.setSnapping(true)
Grid.setVisible(false)
Grid.get()

Hands.setEnabled(true)
Hands.isEnabled()
Hands.setHiding("reverse")      -- "default" | "reverse" | "disable"
Hands.getHiding()

Lighting.set({ env = "night", exposure = 0.9,
               sun = { intensity = 2, azimuth = 45, elevation = 30 } })
Lighting.setEnv("studio")       -- "studio" | "soft" | "night"
Lighting.setExposure(1.1)
Lighting.setSun({ color = "#ffe0c0" })
Lighting.get()
```

All three patch only the keys you pass, are server-authoritative and persist with the table.

## Console output

```lua
print("value", 42)          -- browser console, prefixed with the script's object id
tw.log("same thing")
tw.logError("bad state")
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
Wait.stop(id)
Wait.stopAll()   -- scoped to the calling script
```

Timers are dropped when their script reloads — re-arm them in `onLoad`.

## Vector

`Vector(x, y, z)` or `Vector({x=, y=, z=})`; every vector the API returns already has these methods. Operators `+`, `-`, `==` and `*` (scalar or componentwise) work.

```lua
local a = Vector(1, 0, 0) + Vector(0, 0, 1)
a:magnitude()
a:sqrMagnitude()
a:normalized()    -- a copy; a:normalize() mutates in place
a:dot(b)
a:cross(b)
a:distance(b)
a:lerp(b, t)
a:scale(2)
a:copy()
local x, y, z = a:get()
Vector.distance(a, b)
Vector.between(a, b)
```

## Color

```lua
local c = Color(1, 0, 0)          -- r, g, b, a (a defaults to 1)
local palette = {Color.Red, Color.Green, Color.Blue, Color.White, Color.Black, Color.Yellow}
c:lerp(other, t)
c:toHex()    -- "RRGGBBAA"
c:copy()
```

## JSON

```lua
local s = JSON.encode({ name = "deck", cards = {1, 2, 3} })
local t = JSON.decode(s)          -- t.name, t.cards[1]; nil on parse error
```
