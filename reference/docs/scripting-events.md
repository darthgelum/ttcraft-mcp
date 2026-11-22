---
title: Events and veto hooks
description: Every event an object or Global script can handle, every try-hook that can cancel a player action, and the exact rules for when each fires.
order: 31
section: Table scripting
toc: true
---

Register handlers by defining a global function with the event's `on`-name. Object scripts can also use `self:on("event", fn)`. In every section below, `player` is a numeric player id and `0` means the server itself triggered the action. See [registering handlers](/docs/scripting#registering-handlers).

Most events observe an action after it happens. `onDestroy` and `onPlayerDisconnect` run during teardown, while the object or player is still available. [Veto hooks](#veto-hooks) run before the action and can cancel it.

## Object events

| Handler | Fires |
| --- | --- |
| `onUpdate(dt)` | every server frame (~60 Hz); `dt` in seconds |
| `onFixedUpdate(dt)` | immediately after `onUpdate`, same cadence |
| `onClick(player)` | a tap — press and release without dragging |
| `onDrag(player)` (alias `onPickUp`) | the object is grabbed; fires on each member of a carried stack or group |
| `onDrop(player)` | the object is released (after drop-snapping and hand capture) |
| `onLoad(saved)` | the script (re)compiles (`saved` is `""`), or is restored from a snapshot **if it defines `onSave`** (`saved` is the last saved string) — see [persistence](/docs/scripting#onsave--onload) |
| `onSave()` → string | state capture: every automatic snapshot, table save and export — fires continuously during play |
| `onFlip(player)` | the object is flipped over |
| `onRotate(player)` | rotated or aligned (align / rotate left / right / 180°) |
| `onSetpose(player)` | position/rotation/scale set via the gizmo |
| `onFlick(player)` (alias `onObjectFlick`) | the object is flicked or thrown with the throw command |
| `onHover(player)` (alias `onObjectHover`) | a player's cursor comes to rest over the object (enter only) |
| `onPeek(player)` (alias `onObjectPeek`) | a player peeks at the object (Alt-hover a card) |
| `onNumberTyped(player, number, alt)` (alias `onObjectNumberTyped`) | a player types a number while hovering the object |
| `onCollisionEnter(other)` | another object starts overlapping (axis-aligned bounding boxes, tested per frame only for objects with a collision handler) |
| `onCollisionStay(other)` | keeps overlapping, each frame |
| `onCollisionExit(other)` | stops overlapping |
| `onSpawn(player)` | the spawn command or a library template created the object and its script is live. This also covers Lua `tw.spawnTemplate`, with player id `0` |
| `onDestroy(player)` | the object is deleted by a player (delete command / cut). **Not** fired by script `destroy()`, container puts, or Time Machine rollback |
| `onLock(player)` / `onUnlock(player)` | the object is locked / unlocked |
| `onGroup(player)` / `onUngroup(player)` | the object is welded into / released from a rigid group (fires on every member) |
| `onNoteEdit(player)` | this note's text was edited |
| `onRandomize(player)` | the object is tossed (R key) — any kind, not just dice |
| `onStateChange(oldId)` | a **player** switches the multistate; script `setState` doesn't re-fire it |
| `onCounterChange(value, delta, player)` | this object's number moved — a counter object's ±/reset or any object's counter mixin; `value` is the new number, `delta` the signed change |

### Deck, card and container events

| Handler | Fires on | When |
| --- | --- | --- |
| `onShuffle(player)` | the deck / container | it is shuffled (including zone-randomize) |
| `onDraw(card, player)` | the deck | a card is taken, revealed, pulled or dealt. The source deck must still exist after the take. |
| `onMerge(player)` | the **surviving** stack | another stack was merged onto it |
| `onGather(deck, player)` | each consumed stack | Gather created the resulting `deck`. Use the argument to refer to the new object. |
| `onSpread(player)` | the consumed deck | its cards were queued for the fan. They arrive on the table over the next few seconds. |
| `onEnterHand(owner)` | the object | it joins a hand from the table, a deal, or Lua. The argument is the hand owner. |
| `onLeaveHand(owner)` | the object | it is picked up, played out, or released when its owner disconnects. The argument is the former owner. |
| `onObjectEnterContainer(obj, player)` | the container / deck | `obj` was put or merged into it |
| `onObjectLeaveContainer(obj, player)` | the container / deck | `obj` was taken, drawn or tipped out of it |

### Zone events

Zone events fire on the script that created a Lua zone. For zones from the editor or a table plan, the Global script receives them. Movement is observed in the simulation, so the same hooks see physical motion and scripted placement.

| Handler | Fires |
| --- | --- |
| `onObjectEnterZone(zone, obj)` | an object's centre enters the zone |
| `onObjectLeaveZone(zone, obj)` | it leaves |
| `onGroupSort(zone, objects)` → list | a layout zone with `sort = "custom"` asks you to reorder; return the reordered list |

## Veto hooks

Veto hooks run *before* an action. **Return `false` to cancel it.** Any other return (`true`, `nil`, nothing), no handler, or a handler error allows the action — a broken script never locks the table (the error still disables the script).

Per-object hooks:

| Hook | Cancels |
| --- | --- |
| `tryGrab(player)` | picking the object up (asked per carried stack/group member) |
| `tryFlip(player)` | flipping it |
| `tryFlick(player)` | flicking it |
| `tryRotate(player)` | rotating / aligning it |
| `trySetpose(player)` | setting pose/scale via the gizmo |
| `tryDraw(player)` | drawing, revealing, pulling or taking from this deck/container (one question: "may this player take from this") |
| `tryEnterHand(player)` | taking this card into a hand (`player` = the prospective owner) |
| `tryMerge(other, player)` | merging `other` onto this stack (fires on the target) |
| `tryEnterContainer(other, player)` | putting `other` into this container (fires on the container) |
| `tryRemove(player)` | a player deleting the object (script `destroy()` and rollback bypass it) |
| `tryStateChange(player)` | a player switching the multistate |

```lua
-- allow pickup only for a player with Play capability while it is unlocked
function tryGrab(player)
  local p = tw.getPlayer(player)
  return p ~= nil and p:can("play") and not self:isLocked()
end
```

## Global script events

The [Global script](/docs/scripting#the-global-script) has no `self`; it receives table-wide events:

| Handler | Fires |
| --- | --- |
| `onLoad()` | the Global script (re)compiles, and once at server start |
| `onUpdate(dt)` / `onFixedUpdate(dt)` | every server frame |
| `onPlayerConnect(player)` | a player joins (after their state sync) |
| `onPlayerDisconnect(player)` | a player leaves (still in the roster when it fires) |
| `onPlayerChangeColor(player)` | a player's seat color changed |
| `onPlayerChangeCaps(player)` | a player's capabilities changed |
| `onPlayerTurn(current, previous)` | the turn moved (`previous` is 0 for the first turn) — see [Turns](/docs/scripting-players#turns) |
| `onObjectEnterHand(object, owner)` | an object joined a hand, including cards without a script |
| `onObjectLeaveHand(object, owner)` | an object left a hand during play or player disconnect |

Archive and Time Machine restores reconstruct hands without replaying gameplay events. Deck operations started by Lua or a signed authoring tool report actor `0` in the deck hooks. Hand hooks always report the owner.

### Global veto hooks

| Hook | Cancels |
| --- | --- |
| `trySpawn(params, player)` | a player spawning objects. `params` = `{kind, dieType, template, x, y, z}`; one spawned *set* is vetoed as one action |
| `onPlayerAction(player, action, target)` | a capability-gated command that participates in the veto system. `action` is the command name and `target` is the object handle or nil |

```lua
-- table rules: at most 6 dice, and nobody acts out of turn
function trySpawn(params, player)
  if params.kind ~= "die" then return end
  local count = 0
  for _, object in ipairs(tw.getObjects()) do
    if object:kind() == "die" then count = count + 1 end
  end
  if count >= 6 then return false end
end
function onPlayerAction(player, action, target)
  if player == 0 then return end -- table automation
  if Turns.isEnabled() and player ~= Turns.current() then return false end
end
```

`onPlayerAction` runs before the matching object-level `try*` hook. The `action` strings are the wire command names; the gameplay ones you'll typically gate are:

`spawn, grab, release, throw, toss, flick, flip, align, rotl, rotr, rot180, setpose, lock, remove, group, ungroup, clipcut, clippaste, click, shuffle, cut, split, draw, reveal, pull, merge, gather, spread, hand, unhand, state, counteradd, countersub, counterreset, counterset, clockstart, clockreset, clockadd, clocksub, clockmode, notetext, setprops, setscript, music, lighting, savetable, resettable`

Not consulted for: the per-frame `move` while dragging, editing the table script itself (`setglobalscript` — an over-eager veto can never lock you out of fixing it), passive viewing (`peek`, `view`, previews), dialog replies, and the table-editor tooling (zones, drawings, snap points, decals and similar). Muted players and out-of-turn players (with turn interactions disabled) are already frozen before your veto runs.

## Ordering and identity notes

- Per frame, each script runs its timers, then `onUpdate`, then `onFixedUpdate`, then collision events; zones are processed after all scripts.
- The Global script is processed first each frame; the system script last.
- `onObjectMenu` is reserved for the privileged system script that builds the base right-click menu — defining it in your scripts has no effect. Add entries with `obj:addContextMenuItem` instead.
