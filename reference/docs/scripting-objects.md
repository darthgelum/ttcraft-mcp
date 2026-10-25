---
title: Objects reference
description: Every method on the tableweb object handle — identity, transform, physics, containers, counters, clocks, tablets, visuals and per-object UI.
order: 32
section: Table scripting
toc: true
---

`self` in an object script, and anything returned by `tw.getObject`, `tw.getObjectFromGUID`, `objectBelow()` and similar calls, is an **object handle**. All methods are colon-called (`obj:getPosition()`).

Conventions used below:

- Positions are in **metres**; the table surface is `y = 0`.
- Rotations are Euler **degrees**, YXZ order.
- Vectors returned by the API are `{x=, y=, z=}` tables with full [Vector math](/docs/scripting-world#vector).
- Setters accept `(x, y, z)` numbers or a `{x=, y=, z=}` table. A partial table (`{y = 0.5}`) patches only the given components of pose and scale setters.
- Where a method takes "an object", a handle, a numeric id or a guid string all work.

## Object kinds

`obj:kind()` returns one of:

| Kind | What it is |
| --- | --- |
| `die` | a die (d6 by default; other face counts exist as templates) |
| `chip` | a poker-style chip |
| `coin` | a two-sided coin |
| `deck` | a stack of cards (a container) |
| `card` | a single card |
| `prop` | a generic object (model, figure, token) |
| `tablet` | a tablet showing a UI document |
| `counter` | a numeric counter |
| `clock` | a stopwatch / countdown timer |
| `note` | an editable text note |

A dead handle (its object was removed) returns `""`.

## Identity and metadata

```lua
obj:id()              -- stable numeric id
obj:guid()            -- string id / alias; defaults to the numeric id
obj:setGuid("deck1")  -- set a custom string id (must be unique)
obj:kind()            -- kind string, see above
obj:getName()         / obj:setName("King")          -- display name ("" default)
obj:getDescription()  / obj:setDescription("...")    -- public blurb
obj:getGMNotes()      / obj:setGMNotes("...")        -- GM-only notes
```

Name, description and GM notes persist with the table snapshot, like tags and vars.

### Per-player visibility

The server filters the broadcast per client, so hiding is authoritative — a hidden object's data never reaches that player's browser.

```lua
obj:setInvisibleTo({2, 3})  -- players 2 and 3 don't see the object at all
obj:setHiddenFrom({2})      -- player 2 sees only an anonymous grey shape
obj:getInvisibleTo()        -- current player-id list; setInvisibleTo({}) clears
obj:getHiddenFrom()
```

## Transform

```lua
obj:getPosition()           -- Vector (alias obj:position())
obj:setPosition(x, y, z)    -- teleport; also accepts {x=, y=, z=}
obj:translate(dx, dy, dz)   -- move by a delta
obj:getRotation()           -- Vector of Euler degrees
obj:setRotation(x, y, z)    / obj:rotate(dx, dy, dz)
obj:getScale()              / obj:setScale(x, y, z)   -- collider + visual scale
obj:getBounds()             -- { center = Vector, size = Vector } (AABB)
obj:getTransformForward()   -- unit basis vectors of the current rotation
obj:getTransformUp()        / obj:getTransformRight()
obj:localToWorld(v)         -- local point -> world (scale, rotation, position applied)
obj:worldToLocal(v)         -- inverse
```

### Smooth movement

Server-side eased glides — use these for animated dealing, tidying or returning pieces:

```lua
obj:setPositionSmooth(pos)            -- glide to pos; (pos, collide, fast) optional flags
obj:setRotationSmooth(rot)            -- eased rotation to Euler degrees
obj:getPositionSmooth()               -- the glide's target Vector, or nil when not gliding
obj:isSmoothMoving()                  -- true while a glide is in progress
```

## Physics

```lua
obj:getVelocity()         / obj:setVelocity(v)
obj:getAngularVelocity()  / obj:setAngularVelocity(w)
obj:addForce(x, y, z)     -- adds to linear velocity (an impulse-style nudge)
obj:addTorque(x, y, z)    -- adds to angular velocity
obj:getUseGravity()       / obj:setUseGravity(false)  -- float in place, still collidable
obj.use_gravity = false   -- field alias for the same toggle
```

### Joints

```lua
obj:jointTo(other, { type = "point" })   -- ball joint at the midpoint (default)
obj:jointTo(other, { type = "fixed" })   -- rigid link
obj:jointTo(other, { type = "hinge", axis = {x=0, y=1, z=0}, point = {x=0, y=0.1, z=0} })
obj:jointTo(other, { type = "spring", min = 0.05, max = 0.3, frequency = 2, damping = 0.5 })
obj:jointTo()             -- no argument: remove ALL of this object's joints
obj:removeJoints()        -- same
obj:getJoints()           -- { {object = handle, type = "hinge"}, ... }
```

For a rigid **weld** of several objects into one assembly, see `tw.group` in the [world reference](/docs/scripting-world#groups-copy-and-paste); `obj:ungroup()` dissolves the welded group this object belongs to.

## Actions and lifecycle

```lua
obj:flip()                -- animated turn-over
obj:roll()                -- toss with an upward impulse and spin (works on any object)
obj:randomize()           -- deck: shuffle; bag: shuffle entries; else: physical toss
obj:setLock(true)         / obj:isLocked()   -- freeze in place
obj:reset()               -- return to the home pose (default position/rotation), at rest
obj:clone()               -- duplicate next to it; returns the new handle
obj:reload()              -- respawn in place: full-fidelity copy (skin, script, guid,
                          -- tags, vars all kept), original removed; returns the new handle
obj:destruct()            -- remove from the table (alias obj:destroy())
```

## Values, counters and clocks

`getValue`/`setValue` are polymorphic over the object kind:

```lua
obj:getValue()
-- counter: its number        clock: its seconds
-- die: resting top face 1..N coin: 1 = heads, 2 = tails
-- anything else: the nearest rotation-value entry (below), or nil
obj:setValue(6)
-- counter: set the number    clock: set the seconds
-- else: turn to the orientation mapped to 6 in the rotation values (no-op without one)
```

Counter-only methods:

```lua
counter:increment()   / counter:decrement()   -- value ± 1
counter:clear()                                -- back to 0
```

Clock-only methods:

```lua
clock:startStopwatch()    -- reset to 0, count up, run
clock:startTimer(90)      -- set 90 s, count down, run
clock:pauseStart()        -- toggle running
clock:isRunning()         / clock:isCountingDown()
clock:clear()             -- 0 and stopped
```

`onCounterChange(value, delta, player)` fires on the counter when its number moves — see [Events](/docs/scripting-events).

### Rotation values

Map orientations to values for custom dice, tokens and markers. `rotation` is Euler degrees, accepted as `{x, y, z}` or `{x=, y=, z=}`; `nil`/`{}` clears the map.

```lua
obj:setRotationValues({
  { value = 1,      rotation = {0, 0, 0} },
  { value = 6,      rotation = {0, 0, 180} },
  { value = "edge", rotation = {90, 0, 0} },
})
obj:getRotationValues()   -- list of { value, rotation = Vector }
obj:getRotationValue()    -- value of the entry nearest the current pose (nil if none)
```

## Appearance

```lua
obj:setColorTint("#ff8800")           -- "#rrggbb" or {r, g, b} in 0..1
obj:getColorTint()                    -- current hex, or nil
obj:highlightOn("#00ff00")            -- transient outline
obj:highlightOn("#00ff00", 3)         -- auto-clears after 3 s
obj:highlightOff()
```

### Material (PBR)

`setMaterial` patches only the keys you pass:

```lua
obj:setMaterial({ metalness = 0.9, roughness = 0.2 })
obj:setMaterial({ transmission = 1, ior = 1.5, thickness = 0.02 })  -- refractive glass
obj:getMaterial()   -- current table, or nil
```

Accepted keys: `metalness`, `roughness`, `envMapIntensity`, `clearcoat`, `clearcoatRoughness`, `tint`, `softTint`, `emissive`, `emissiveIntensity`, `transmission`, `ior`, `thickness`, `attenuationColor`, `attenuationDistance`.

### Particle effects and sound

```lua
local fx = obj:createEffect("fire")        -- attach a following particle effect
obj:createEffect("confetti", { persistent = false })
tw.stopEffect(fx)                          -- stop one effect by id
obj:clearEffects()                         -- stop everything attached to this object

obj:playSound("assets/clack.ogg", { volume = 0.8 })  -- one-shot, positioned at the object
```

## Home pose and drag behaviour

The same per-object properties the Properties dialog exposes:

```lua
-- Home pose (captured at spawn): what obj:reset() returns to.
obj:getDefaultPosition()  / obj:setDefaultPosition(x, y, z)
obj:getDefaultRotation()  / obj:setDefaultRotation(x, y, z)

-- Pickup rotation: with rotateOnGrab on, the object snaps to grabRotation when grabbed.
obj:getGrabRotation()     / obj:setGrabRotation(x, y, z)
obj:getRotateOnGrab()     / obj:setRotateOnGrab(true)

-- Stand a toppled figure back up on pickup WITHOUT turning it (heading kept).
-- Default on for things with an "up"; off for cards, decks, dice, coins.
obj:getUprightOnGrab()    / obj:setUprightOnGrab(false)

-- Drag behaviour:
obj:getCollideWhileDragging() / obj:setCollideWhileDragging(true)  -- default false
obj:getLiftOverObjects()      / obj:setLiftOverObjects(false)      -- default true
obj:getLiftHeight()           / obj:setLiftHeight(0.15)            -- metres; -1 = global

-- Surfaces and hands:
obj:getDrawable()   / obj:setDrawable(true)   -- the drawing tool may draw on it
obj:getHandable()   / obj:setHandable(true)   -- hand zones may hold it
```

## Queries

```lua
obj:distanceTo(other)   -- metres (handle, id or guid); -1 if unresolvable
obj:objectBelow()       -- the object it rests on, or nil
obj:objectAbove()       -- the object resting on it, or nil
obj:heldBy()            -- player id holding it, or nil
obj:isFaceDown()        -- cards/decks: boolean; nil for other kinds
obj:getZones()          -- scripting zones currently containing this object
```

## Tags

Tags are shared metadata every script can see; they persist with the snapshot and drive zone filters, snap-point filters and `tw.getObjectsWithTag`.

```lua
obj:addTag("enemy")     / obj:removeTag("enemy")
obj:hasTag("enemy")     -- boolean
obj:getTags()           -- list of strings
obj:setTags({"enemy", "boss"})   -- replace the whole set
obj:hasAnyTag()
obj:hasMatchingTag(other)        -- any tag in common with another object
```

## Shared data and cross-script calls

Vars hold primitives (number / string / boolean; `nil` erases). Tables carry whole nested structures, stored **by value** — `getTable` returns an independent copy each call, so mutate-then-`setTable` to write back. Both are visible to every script and survive snapshots and rollback.

```lua
obj:setVar("hp", 10)          / obj:getVar("hp")
obj:setTable("cfg", { hp = 10, items = {"sword"} })
obj:getTable("cfg")           -- a fresh copy
obj:setTable("cfg", nil)      -- clear
obj:call("fnName", a, b)      -- call a global function in that object's script
```

> **Persistence and time travel.** Snapshots (and the Time Machine rollback) store a script's **data**: source, enabled flag, name/tags, vars and tables. A live Lua VM can't be frozen, so on restore the source re-runs to rebuild handlers and the saved vars are re-injected. Keep state that must survive a rollback in `setVar`/`setTable` (or `onSave`, see the [overview](/docs/scripting#persisting-state)); a bare global or a closure upvalue won't round-trip.

## Serialization

```lua
obj:getJSON()   -- the object's full snapshot as a JSON string (decks include cards)
obj:getData()   -- the same, decoded to a Lua table
```

Round-trips with `tw.spawnObjectJSON` / `tw.spawnObjectData` — clone an object across saves, stash a "shopping catalogue" of spawnables, or template complex pieces.

## Containers: decks, bags and chests

A container is a **property**, not a kind: a deck is one, and any object can be turned into one (bags, chests). The same methods then apply — a bag's entries are whole objects rather than cards.

```lua
box:count()                  -- entries (alias getQuantity)
box:getObjects()             -- deck: { {index, code, name}, ... }
                             -- bag:  { {index, name, kind, guid}, ... }
box:shuffle()                / box:randomize()
box:putObject(obj)           -- deck: merge (returns the surviving stack);
                             -- bag: swallow the object (returns the bag)
box:takeObject()             -- the top entry; returns its handle
box:takeObject({ index = 0 })              -- by getObjects() index (0 = bottom)
box:takeObject({ name = "Ace of Spades" }) -- first entry with that name
box:takeObject({ top = false })            -- the bottom entry
box:takeObject({ flip = true })            -- spawn face up (decks)
box:takeObject({ position = {x=0.2, y=0.1, z=0}, rotation = {0, 90, 0},
                 smooth = true,            -- glide instead of teleporting
                 callback = function(o) o:highlightOn("#00ff00", 1) end })
```

Deck/card specifics:

```lua
deck:deal(n)                     -- deal n cards onto the table
deck:deal(n, player)             -- ...into that player's grip
deck:dealToHand(player, n)       -- draw n cards (default 1) concealed into a hand
deck:dealToColorWithOffset(offset, flip, player)  -- top card at the player's seat
                                 -- + offset; face up if flip; returns the handle
deck:cut(n)                      -- n cards off the top; returns new handles
deck:split(n)                    -- split into n piles; returns new handles
deck:group()                     -- gather the touching pile into one face-down deck
deck:search(player, function(index, code)   -- private search window for that player
  if index then print("picked entry", index, "code", code) end
end)
card:group()                     -- also works from a loose card: collects its pile
```

Card `code` is `1..52`: `(suit * 13) + rank + 1` with suits clubs/diamonds/hearts/spades and ranks ace, 2..10, J, Q, K.

Bag flags:

```lua
bag:setInfinite(true)     / bag:isInfinite()      -- taking hands out copies
bag:setRandomOrder(true)  / bag:isRandomOrder()   -- unaimed takes draw at random
```

An object that enters a bag is serialized whole — skin, physics, script, vars, guid — and comes back out as the same object. Copies from an infinite bag get fresh guids and names. Container events and vetoes (`tryEnterContainer`, `tryDraw`, `onObjectEnterContainer`, `onObjectLeaveContainer`) are listed in [Events](/docs/scripting-events).

## Per-object snap points

Local coordinates — the points move and rotate with the object (board cells on a board, slots on a mat). A dropped object within `range` (metres, XZ) is pulled to the nearest matching point.

```lua
obj:setSnapPoints({
  { position = {x = 0.2, y = 0, z = 0} },                              -- any object
  { position = {x = -0.2, y = 0, z = 0}, rotation = 90, range = 0.08,
    tags = {"card"} },                                                 -- tag-filtered
})
obj:getSnapPoints()      / obj:clearSnapPoints()
```

Table-global snap points live on `tw.setSnapPoints` — see the [world reference](/docs/scripting-world#snap-points).

## Multistate objects

An object can hold several **states** — alternative appearances (label, tint, model, textures, die type, material). Players cycle them from the context menu; scripts drive and react to them.

```lua
obj:setStates({
  { label = "Untapped", tint = "#ffffff" },
  { label = "Tapped",   tint = "#aa8844" },
})
obj:getStates()        -- { {id, label}, ... }
obj:getStateId()       -- active state (1-based; 0 = none)
obj:setState(2)
obj:shuffleStates()    -- switch to a random state
```

`onStateChange(oldId)` fires when a **player** changes the state; a script-driven `setState` doesn't re-fire it. The `tryStateChange` veto can cancel a player's change.

## Per-object menu items and hotkeys

```lua
-- Right-click menu entries on this object, calling its own script functions:
obj:addContextMenuItem("Reset", "reset")
obj:addContextMenuItem({ label = "Burn", onClick = "burn", icon = "remove",
                         category = "danger", keepOpen = false })
obj:addContextMenuItem({ label = "Flip", command = "flip", icon = "flip" })  -- native command
obj:clearContextMenu()

-- Object-scoped hotkey: fires only while THIS object is hovered or focused.
obj:addHotkey("r", "onR", "Roll me")   -- callback onR(player) runs in this object's script
obj:clearHotkeys()
```

The full menu-item and control vocabulary (sliders, submenus, toggles) is in [Custom UI](/docs/scripting-ui). All contributions are cleared when the script reloads — declare them in `onLoad`.

## Tablet elements

A `tablet` object shows a UI document (pages of labels, values, lists). Scripts address elements by their id:

```lua
tab:setElementText("title", "Round 3")
tab:setElementValue("score", 42)      / tab:getElementValue("score")
tab:setElementTooltip("score", "VP")  / tab:getElementTooltip("score")
tab:setListEntries("log", { "Alice: 3", "Bob: 5" })
tab:addListEntry("log", "Carol: 2")
tab:clearListEntries("log")           / tab:getListEntries("log")
```

Spawn a tablet with a document via `tw.spawnTablet` — see the [world reference](/docs/scripting-world#spawning).
