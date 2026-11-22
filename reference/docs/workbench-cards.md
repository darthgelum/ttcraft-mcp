---
title: Cards and atlases
description: Standard card formats, precise atlas slicing and individual card backs in Workbench and the native API.
order: 22
section: Workbench
toc: true
---

# Card formats

Card and deck size is still the ordinary per-axis `scale`: presets are a
convenience, not a separate format identity. Free resizing remains available.
Existing tables and templates keep their sizes until a preset is applied.

The shared preset catalogue is `protocol/card_formats.mjs`; generated C++ and
TypeScript copies keep scripts, native commands and the UI consistent.
Dimensions are physical trim sizes in millimetres, excluding print bleed:

| Key | Width × height |
|---|---|
| poker | 63.5 × 88.9 |
| euro-poker | 63 × 88 |
| bridge | 57.15 × 88.9 |
| mini | 44.45 × 63.5 |
| tarot | 69.85 × 120.65 |
| square | 88.9 × 88.9 |
| large | 88.9 × 146.05 |

These are common printer stock sizes, not universal names: manufacturers offer
variants. The inch-based sizes use exact inch-to-mm conversion from
[MakePlayingCards' trim-size guide](https://www.makeplayingcards.com/pops/faq-photo.html);
the Euro poker variant follows [The Game Crafter's 63 × 88 mm listing](https://www.thegamecrafter.com/make/products?query=foil).

The format picker is in live card/deck properties and template properties. It
shows the current dimensions, recognizes a known preset or displays Custom, and
can swap width and height. Applying a preset preserves thickness (Y scale),
artwork and the rest of the object properties.

For MCP, call `table_command` with `command: "cardformat"` and
`arguments: {id, format: "poker", landscape: false}`. Use the current runtime
object ID from `object_read`. The command requires Edit permission and an
unlocked card or deck. Its reply is `cardformatresult {id, ok}`. From an object's
Lua script, `self:setCardFormat("tarot", true)` returns a boolean. Library and
archive records store the resulting `props.scale`.

Merging and gathering compare actual X/Z dimensions, including free resizing,
with only a tiny floating-point tolerance. Different dimensions cannot form a
deck. Automatic nearby gathering ignores incompatible cards; explicitly selecting
a mixed-size group refuses the operation without consuming any cards. Matching
cards retain their scale through dealing, cut/split, normalization, merge/gather,
spread and container extraction. Hand/search previews follow the actual aspect.

## Artwork and corner rounding

The Workbench's card editor accepts individual files or an atlas. Pixel crop
sizes, quarter-turn source rotation and local grid corrections apply to the
artwork. Set the physical dimensions in **Properties**.

Use **Corner rounding** in the editor's **Preview** section to match the
outline of your artwork. The control accepts 0–50% of the nominal card width.
Choose 0% for square corners. The native and archive value is the fraction
`cardRadius`, so 5% is `0.05`. This changes the rendered outline while keeping
the preset dimensions.

Use one shared `back` or a `backs` array indexed like `faces`. In the editor,
choose the per-card back mode for a double-sided deck, then check the pairs
before saving. Each card's
face, back and name are remapped together when stacks with different art tables
are combined, including operations invoked from Lua. A stack can contain up to
255 distinct indexed variants; an overflowing combination is refused before
consuming cards. An atlas template also retains `cardAtlas` source paths, rotation,
grid and generated-image order for reopening; those source references travel
with the game export. The editor waits for a correlated `libresult` before closing.
