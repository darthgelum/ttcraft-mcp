---
title: Flat image tokens
description: Create solid two-sided tokens from images, edit their contour, material and thickness, and use the native token API.
order: 23
section: Workbench
toc: true
---

# Flat image tokens

A token is a flat, solid, two-sided piece without a stand, holder or gizmo.
Workbench: Add → Token, then the Token section of the preview. The same image
form is available on its Textures tab. Existing chips and pawn bases are unchanged.

The front defines the contour. The back can copy the front, mirror it, or use an
independent image. Both sides use the same physical shape and top edge. Width
and height are millimetres before the object's ordinary scale; thickness defaults
to 2 mm and is clamped to 0.8–20 mm. Use the standard material editor for paper,
plastic, metal, roughness and clear coat. Edge colour is separate; material tint
affects the edge without staining printed faces.

Shapes: rectangle, circle/oval, or front-image alpha. Alpha threshold and smoothing
control the generated contour. Concavities and holes are represented by a compound
of convex parts. Excess complexity is reported, never silently replaced by a box
or convex hull. Workbench derives and saves the outline together with the settings.

## Native API / MCP

Tokens use the ordinary `prop` physics kind with a `token` property, like `pawn`.
The spawn command also accepts `kind: "token"` as a convenience alias. Runtime
records still identify them as `prop`; read `props.token` for their semantic type.

```json
{
  "type": "spawn",
  "kind": "token",
  "p": [0, 0.01, 0],
  "token": {
    "front": "library/assets/front.png",
    "back": "library/assets/back.png",
    "back_mode": "image",
    "shape": "circle",
    "width_mm": 32,
    "height_mm": 32,
    "thickness_mm": 2,
    "edge_color": "#e2d6bf"
  },
  "roughness": 0.8,
  "metalness": 0,
  "tint": "#ffffff"
}
```

`back_mode`: `copy`, `mirror`, `image`. An unused back path is retained when
switching modes. The standard material fields remain on the object/template,
not inside the token blob. Object scale multiplies the authored dimensions.

Edit an instance with a partial patch; omitted image paths and settings survive:

```json
{"type":"tokenset","id":12,"token":{"thickness_mm":3,"back_mode":"mirror"}}
```

Requires Edit. Success: `tokenresult {id, ok:true, requestId?}`. Invalid settings
return the standard correlated error without changing the object. ID, GUID,
rotation, lock, script, material and scale survive a geometry change. The bottom
surface is retained while thickness changes. Gravity defaults on at creation;
explicit physics settings continue to use the normal properties API.

In MCP use `objects_spawn` with `spec.kind: "token"`, or `table_command` with
`tokenset` after `command_describe`. MCP resolves object GUIDs in the usual way.
The library, bags, snapshots and game archives carry both images and the outline.

## Authoring an alpha contour through the API

The native server does not decode image pixels. For `shape: "alpha"`, supply the
geometry prepared from the front alpha (Workbench does this automatically):

```json
{
  "shape":"alpha",
  "outline": {
    "outers":[[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]],
    "holes":[[]],
    "pieces":[[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]]
  }
}
```

Coordinates are normalized to the source rectangle: x across, y up, in
[-0.5, 0.5]. `holes[i]` belongs to `outers[i]`. `pieces` is a convex partition
of the filled area, excluding holes. Limits: 512 outline vertices, 64 convex
parts, 32 vertices per part. Degenerate, non-finite, out-of-range or nonconvex
parts are rejected. The server derives metric collider dimensions from this
record on spawn, edit, clone and restore; a separate caller-supplied collider
cannot override token geometry. Increase `detail_mm` to simplify an overly
complex outline; `threshold` is in [0.05,0.95].
