---
title: Table plan
description: The table's coordinate frame, and the plan — a JSON description of the outline, the seats, the named areas and the snap points — that a module author or an AI agent writes instead of drawing; what applying it produces, how it travels with a module, and the Table API scripts read it with.
order: 21
section: Tables
toc: true
---

A game table has a shape, a size, a ring of seats and, usually, a few places that mean something — the draw pile, each player's discard, the board. In the app you draw all of that in the workbench's **Table** tab. The **table plan** is the same thing written down: a small JSON document that names the outline, the seats and the areas, and that the table compiles into exactly what the editor would have made. It exists so a module can be laid out by a person with a text editor or by an AI agent, so a layout can be read back from a script, and so it can be checked before anyone sits down.

This page is the reference for the plan and for the coordinate frame it is written in. If you only want to know where things are from a script, skip to [the Table API](#from-a-script-the-table-global).

## The world frame

Everything on a table is measured in **metres** in one right-handed frame:

- the **origin** is the centre of the table; the felt (the playing surface) is the plane `y = 0`, and `+y` points up;
- `+x` runs to the **right** and `+z` toward the **near edge** — the side the first player sits on and the default camera looks from. Seen from above with the near edge at the bottom of the screen, `x` grows to the right and `z` grows downward, which is also how the workbench's table editor draws it.

```
                  far edge (-z)  ·  seat 1
          +---------------------------------+
          |                                 |
  -x      |               (0, 0)    → +x    |      +x
  seat 2  |                 +               |    seat 3
          |                 ↓ +z            |
          |                                 |
          +---------------------------------+
                  near edge (+z)  ·  seat 0
```

Rotations are about the vertical axis unless said otherwise. Three conventions meet here, and they are not the same number:

| Where | Unit | Meaning |
| --- | --- | --- |
| An object's `rot` in an archive | quaternion `[x, y, z, w]` | its orientation; the Lua API shows it as Euler degrees, YXZ order |
| A zone's `rot` (seats and areas) | degrees | the zone's own frame turned about its centre. Its local `+z` is the side a seat **faces**: `rot: 0` faces `+z` (a seat on the far edge), `90` faces `-x` (the right edge), `180` faces `-z` (the near edge, seat 0's usual place), `270` faces `+x` (the left edge) |
| A snap point's `yaw` | degrees | the orientation a dropped object is turned to, i.e. an object yaw |

The limits below come from the wire format and the physics, not from taste. Positions travel as sixteen-bit integers in tenths of a millimetre, so nothing on a table can be further than about 3.27 m from the centre.

| Limit | Value |
| --- | --- |
| Table span per axis | 0.8 – 6 m |
| Any coordinate | within ±3 m of the centre |
| Seats | 0 – 10 (one colour each: black, red, blue, green, yellow, orange, purple, cyan, pink, white) |
| Rail height | 0.005 – 0.3 m (drawn height only; the invisible wall is always 1.2 m) |
| Outline | up to 64 loops, 2048 points per loop, 8192 in all |
| A seat's footprint | 0.5 × 0.3 m by default, 0.04 – 3 m either way |

A card is 70 mm wide, a hand of them about 0.25 m; a figure's base is about 0.05 m. An object that ends up outside the outline has no floor under it: it falls, and the table puts it back on a free patch of felt.

## The plan

The plan is a JSON object. It lives in an archive as `table.plan` in `game.json` (see [Table archives](/docs/table-archives)), can be sent to a running table as the `tableplan` command, and can be set from a script with `Table.set`. A complete one:

```json
{
  "shape": [
    { "kind": "rect", "w": 2.4, "d": 1.6, "round": 0.05 },
    { "kind": "ellipse", "cx": 0, "cz": 0, "radius": 0.25, "hole": true }
  ],
  "wallHeight": 0.02,
  "seats": { "count": 6, "hand": true },
  "areas": [
    { "name": "draw", "cx": -0.3, "cz": 0.5, "w": 0.12, "d": 0.16, "tags": ["deck"], "snap": true },
    { "name": "discard", "each": "seat", "x": 0, "z": 0.25, "w": 0.1, "d": 0.14,
      "layout": { "spacing": 0.01 } }
  ],
  "snaps": [
    { "x": 0.6, "z": -0.4, "yaw": 90 }
  ]
}
```

Every key is optional. A plan mentions what it wants changed and leaves the rest alone: no `shape`, `width` or `depth` keeps the current outline; no `seats` keeps the current seat ring. `areas` and `snaps`, on the other hand, are the plan's own — they are rebuilt from the plan on every apply, and a plan without them has none.

### The outline

`shape` is a list of primitives laid on the felt. Each is a closed figure; a figure **inside** another cuts a hole (containment is even-odd, so an island inside a hole is felt again). Figures may nest but may not **cross** — an overlap would read as a hole nobody meant, so the plan refuses it and asks for the union as one polygon.

| Key | Meaning |
| --- | --- |
| `kind` | `rect`, `ellipse` (or `circle`), `polygon` |
| `cx`, `cz` | the centre, metres (default `0, 0`) |
| `w`, `d` | full extents along the figure's own `x` and `z` |
| `radius`, `rx`, `rz` | an ellipse's or a regular polygon's radius, instead of `w`/`d` |
| `sides` | a regular polygon's side count, 3 – 24 (default 6); the first vertex points to `-z` |
| `points` | an explicit outline: a list of `[x, z]` pairs, 3 – 2048 of them, relative to `cx, cz` — so a list of world points works as it is |
| `round` | corner radius, metres (rect and polygon; `r` also works on a rect) |
| `rot` | degrees, turned about the centre |
| `hole` | documents that this figure is meant as a hole; nesting decides regardless |

An ellipse is a 64-gon, as in the editor. Instead of `shape`, `width` and `depth` give a plain rectangle centred on the origin. `wallHeight` is the drawn rail height.

### Seats

`seats` decides how many players the table is laid out for and where they sit. Three forms:

- a **number** — that many seats, placed automatically;
- `{ "count": 6, "hand": true }` — the same, with hand capture armed on every seat;
- a **list** of seats placed by hand: `{ "seat": 0, "cx": 0, "cz": 0.53, "w": 0.5, "d": 0.3, "rot": 180, "hand": true, "tags": [] }`. `seat` defaults to the position in the list; `rot` defaults to facing the table centre; `w` and `d` to 0.5 × 0.3 m.

A seat is a rectangle on the felt with its **outer** long edge against the rail. It gives the player everything that answers "where do I sit": the nameplate, the opening camera, the anchor cards are dealt to, and the fan their hand is laid out in. `hand: true` additionally turns it into a **hand zone**: a card the seated player (or the GM) drops on it goes into their hand. Without a hand zone cards can still be dealt to a player, but nothing can be put into a hand by dropping it. Seats carry the seat's colour; the first player to join takes black and is the game master.

Automatic placement follows the editor's own rules: seats are 0.5 × 0.3 m, sit 2 cm off the rail, keep 0.3 m of clear felt between neighbours, go to the **middle of a straight edge** rather than across a corner, and are spread by arc length around a round or oval table. Seat 0 is at the near edge; indices then run around the table in order, so seat distance is table distance and the second player to join sits across from the first. When not every seat fits, the ones that do are placed and the report says so.

### Areas

`areas` are named zones — the same zones the workbench's zone tool makes, with a name a script can ask for. Each:

| Key | Meaning |
| --- | --- |
| `name` | required, unique in the plan; `Table.area("draw")` finds it |
| `cx`, `cz`, `w`, `d`, `rot` | the footprint, like a seat's |
| `y`, `h` | the box's centre height and height (defaults 0.1 and 0.2 m; a zone is a box, so both matter for what it contains) |
| `tags` | only objects carrying one of these count as inside |
| `layout` | `true`, or a table of [layout options](/docs/scripting-world#layout-zones) — `spacing`, `perRow`, `direction`, `alternate`, `facing`, `hspread`, `vspread`, `combine`, `maxPerGroup`, `sort` — to keep the contents tidied |
| `snap` | `true`, or `{ "range": 0.05, "tags": [] }`: also put a snap point at the centre, turned the way the area faces |
| `hidden` | a hidden zone: `true`, `"invisible"` or `"masked"` (the owner is set at play time) |
| `each` | `"seat"`: stamp this area once per seat, see below |

With `each: "seat"` the area is written in the **seat's own axes**: `x` runs to the seated player's right along the rail, `z` ahead of them into the table, both from the seat's centre. One area per seat is created, named `name:seat` — `discard:0`, `discard:1`, … — and turned with the seat, so the same plan lays out a two-player and a six-player table.

### Snap points

`snaps` are table-level snap points: a dropped object within `range` (default 5 cm) is pulled to the point and, when `yaw` is given, turned to it. Each is `{ "x", "z", "yaw", "range", "tags", "each" }`; `each: "seat"` stamps one per seat in seat axes, facing the seat like a dealt card, turned further by `yaw`.

### What applying a plan does

Applying is a single edit, undoable like any other:

1. the outline is compiled and swapped in; objects outside it are pushed back onto the felt;
2. if the plan has `seats`, every seat zone on the table is replaced by the plan's;
3. every area and snap point the plan owns is rebuilt from the plan;
4. the plan text is stored with the table and echoed in the `table` message, the export and the snapshot ring.

The table remembers the **last applied** plan; `Table.plan()` and `table.plan` in an export read it back. `Table.set` and the command's `merge` form patch it — the keys you give replace the stored ones, then the whole merged plan is re-applied — so `Table.set({ seats = 4 })` on the table above keeps the outline and the areas and restamps `discard` for four seats. Drawing the outline by hand in the workbench drops the plan, since it no longer describes the table; editing a single seat or area by hand keeps it (the plan is what you last asked for, the table is what you have). `reset` forgets the plan and removes its areas and snap points; the outline and the seats stay.

The reply of every apply is a report: `{ "ok": true, "warnings": [...], "seats": { "wanted": 6, "placed": 6 }, "areas": 7, "snaps": 2 }`, or `{ "ok": false, "error": "…" }`. Errors are things the table cannot do (a crossing outline, a coordinate past 3 m, a seat index past the palette); warnings are things it did anyway (fewer seats than asked fit, a hand-placed seat hanging over the edge, an area off the felt).

### In an archive and between modules

In `game.json` the plan sits at `table.plan`. An archive that carries the plan and nothing it produced — no `shape.loops`, no seat zones — is compiled when it is loaded, before any script runs. An archive the table exported carries both, and is loaded as it is; the zones and snap points a plan wrote are marked `"plan": true` in `tableMeta`.

When a module is loaded as an addition, its **table block** — outline, size, rail, look and plan — is taken only if the load dialog says the table comes from that module; then the host's seat ring and plan areas go with the host's outline and the module's come in, compiled from its plan if it carries only that. A module whose table is not taken contributes its objects, templates and ordinary zones, never a second ring of seats. So a module that must have its own table ships a plan; a module meant to sit on someone else's table places its things **relative to the seats** from its script (below) and does not.

## From a script: the Table global

Scripts read the table through `Table`, a sibling of `Grid`, `Hands` and `Lighting`:

```lua
Table.get()          -- { width, depth, halfWidth, halfDepth, wallHeight, seatCount, shaped,
                     --   bounds = { minX, maxX, minZ, maxZ } }
Table.shape()        -- { { points = { {x=, z=}, … }, hole = false }, … } ; a rectangle is one loop
Table.contains(v)    -- is the point on the felt? (holes are not); also Table.contains(x, z)
Table.clamp(v, 0.05) -- the nearest point on the felt, 5 cm in from the rail
Table.seatCount()
Table.seat(i)        -- one seat (below); Table.seats() lists them all
Table.area("draw")   -- the zone handle of a named area, or nil; Table.areas() lists { name, seat, zone }
Table.plan()         -- the last applied plan as a table, or nil
Table.set(plan)      -- merge into the stored plan and re-apply; returns the report
Table.replace(plan)  -- swap the plan
Table.reset()
```

`Table.seat(i)` answers for any seat index, with a zone or without one (then the historic edge position):

```lua
local s = Table.seat(0)
s.seat, s.color          -- 0, "black"
s.center                 -- Vector: the seat zone's centre
s.position               -- Vector: the middle of its outer edge, where the player is
s.forward                -- Vector: the direction the player faces, into the table
s.right                  -- Vector: to the player's right along the rail
s.rotation               -- the zone's rot, degrees
s.width, s.depth, s.hand -- the footprint and whether it captures into the hand
s.zone                   -- the zone handle, or nil when the seat has none
s.player                 -- the id of the player sitting there, or nil
s.toWorld({ x = 0, z = 0.25 })   -- a point in the seat's axes as a world Vector (called with a dot)
```

A zone handle gained `zone:getName()` and `zone:getSeat()`, so `obj:getZones()` can tell a seat from an area. Everything else on it — position, scale, rotation, options — works on plan zones as on script zones, and a change made through the handle is shown to every player.

The pattern that makes a module portable is to lay out per player from the seats rather than from fixed coordinates:

```lua
function onLoad()
  for i = 0, Table.seatCount() - 1 do
    local s = Table.seat(i)
    local pile = s.toWorld({ x = 0.2, z = 0.3 })       -- ahead and to the right of each player
    tw.spawnObject({ type = "deck", position = { x = pile.x, y = 0.05, z = pile.z } })
  end
  Table.set({
    areas = {
      { name = "scoring", each = "seat", x = -0.2, z = 0.3, w = 0.1, d = 0.1, tags = { "chip" } },
    },
  })
end
```

## Checking that it fits

Before shipping a module, run the plan through the table (or a script) and read the report. What the table refuses outright: an outline that crosses itself, that reaches past ±3 m, that is under 0.8 m on an axis, or that has fewer than three points; more than ten seats; two seats with the same index; an area without a name. What it warns about and does anyway: fewer seats fit than asked, a hand-placed seat hanging over the rail or closer than 0.3 m to another, an area or snap point off the felt, a per-seat area on a table with no seat zones.

A quick fit checklist for an outline meant for `n` players: the perimeter needs at least `n × 0.8` m of rail; a corner costs about a seat's worth on either side; a round table seats fewer than a rectangle of the same perimeter, because its rim curves away from the corners of a straight seat.

## Without a plan

The plan is a convenience over the archive's own representation, which is documented in [Table archives](/docs/table-archives): the outline as `table.shape.loops`, the seats as zones in `tableMeta.zones` with a `seat` index, `hand` and `rot`, the areas as ordinary zones, the snap points as `tableMeta.snaps`. A tool may write those directly; the table reads them the same way.
