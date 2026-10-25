---
title: Table archives
description: How a table is saved, downloaded and loaded — the archive format (game.json, manifest.json, blobs by SHA-256), save slots, modules, how assets get onto a table, and why saves from other tabletops are not accepted.
order: 20
section: Tables
toc: true
---

A game table is a live world on a server. Everything about it — the objects and where they lie, decks and their cards, zones, drawings, the library of templates, the Global script, every object's script — can be frozen into a **table archive**: a `.zip` that the table writes and reads. Autosaves, save slots, downloads, published modules and the file you load from your computer are all this one format.

This page is the reference for that format. Read it if you want to keep a table outside TTCraft, move one between sites, generate one with a tool, or understand why a file you have was refused.

## Where archives come from and go

On the room page, the table's menu offers:

- **Saves…** — named save slots kept on the site. A slot is an archive; loading one replaces what is on the table.
- **Download table…** — the *full* archive: the table's state plus every file it uses, ready to load anywhere. On a big table this takes a while; the download starts when it is ready.
- **Load from file…** — boots the table (or joins it, if it is running) and offers a file picker. The archive is verified on the table server and its objects **replace** whatever was on the table; the library, effects and gallery are merged in.
- **Publish as a module** — from inside the table. A module's package is the same archive; other rooms add it to their tables as an *addition* (fresh object ids, the library merged, the Global script adopted only if the table has none).

The table also autosaves continuously; a closed table reopens from its last state.

## The archive

A table archive is a zip with two required entries and two optional ones:

| Entry | Required | Contents |
| --- | --- | --- |
| `game.json` | yes | The whole state of the table (below). `"format"` must be `"tableweb"` and `"objects"` must be present. |
| `manifest.json` | yes | The files the state refers to, by hash: `{"format": "tableweb-manifest", "version": 1, "blobs": [{"hash", "ext", "bundle", "model", "size"}]}`. Its presence marks a current-format archive; an archive without it is refused. |
| `blobs/<sha256>.<ext>` | no | The bytes of each file the manifest names. Present in a **Download table…** archive; absent from autosaves, slots and modules, which only *name* their files because the site already stores them. |
| `thumbs/t<hex>.png` | no | Cached previews of library items. Derived data; safe to omit. |

The smallest valid archive is therefore two files:

```json
// game.json
{ "format": "tableweb", "objects": [] }
// manifest.json
{ "format": "tableweb-manifest", "version": 1, "blobs": [] }
```

Loading it gives an empty table of default size. Anything the archive does not mention keeps a default; anything malformed is reported with a reason (*not a valid zip archive*, *archive has no game.json*, *not a tableweb game export*, *this archive predates the file store*).

## game.json

The top level is an object with these keys. All are optional except `format` and `objects`.

| Key | What it holds |
| --- | --- |
| `name` | The table's display name |
| `table` | Geometry and look: `halfWidth`, `halfDepth`, `wallHeight`, `seats`, an optional `shape` (the outline as loops of `[x, z]`), `surfaceTexture`, `wallTexture`, `lighting`, `surface`, and an optional `plan` — the [table plan](/docs/table-plan) the table was built from |
| `objects` | Every object on the table — the records described next. Containers nest their contents inside their own record |
| `tableMeta` | The table layer: `zones` (a zone with a `seat` index is a player's seat; one with a `name` is a plan area), `snaps` (snap points), `drawings`, `decals`, `stamps`, `fonts`, `sounds`, `playlists`, sound banks and folders. The coordinate frame and the seat fields are on the [Table plan](/docs/table-plan) page |
| `library` | The workbench templates: each with `id`, `name`, `category`, `kind`, the visual fields, an optional `script` (Lua source as a string) and the same `props` an object has |
| `effects` | Authored visual effects: `{id, name, category, spec}` |
| `globalScript` | The Global script — Lua source as a string |
| `globalData` | The Global script's `tw.setTable` store |
| `scriptKv` | The `tw.store` key/value store |
| `assets`, `assetFolders` | The gallery: which files are shown where (`{path, kind, name, folder}`) |
| `policy`, `hands`, `turns`, `handSeats`, `joints` | Table rules: who may spawn and lock, hand settings, the turn system's settings, seat assignments of hand objects, physical joints between objects |

Per-player things — camera, settings, seat colours — are not part of an archive.

### An object

Each entry in `objects` is the same record `obj:getJSON()` returns in a script and `tw.spawnObjectJSON` accepts, so the quickest way to learn a kind's shape is to spawn one in the app and print it. The common part:

```json
{
  "id": 17, "kind": "die", "guid": "5f0c…",
  "pos": [0.12, 0.05, -0.3],
  "rot": [0, 0, 0, 1],
  "lin": [0, 0, 0], "ang": [0, 0, 0],
  "sleeping": true, "locked": false,
  "props": { "scale": [1, 1, 1], "mass": 0.02, "friction": 0.9, "restitution": 0,
             "collide": true, "lift": true, "liftHeight": 0.05, "rotateOnGrab": false,
             "upright": false, "drawable": false, "handable": false, "useGravity": true,
             "grab": [0, 0, 0], "defPos": [0, 0, 0], "defRot": [0, 0, 0] },
  "visual": { "type": "die", "name": "", "dieType": "d6", "textures": {}, "model": "", "hull": [] },
  "script": { "source": "function onLoad() end", "enabled": true, "saved": "",
              "name": "", "description": "", "gmNotes": "", "tags": [],
              "vars": {}, "tables": {}, "rotationValues": [], "snaps": [] }
}
```

- `kind` is one of the spawnable kinds (`die`, `deck`, `card`, `chip`, `coin`, `tablet`, `counter`, `clock`, `note`, and `prop` for a custom model); `tw.getSpawnTypes()` lists the ones a script may spawn directly.
- `pos` is metres with the table surface at `y = 0`; `rot` is a quaternion `[x, y, z, w]`.
- `id` is the object's runtime id and is kept when an archive is *loaded*; a *module* gets fresh ids. `guid` is the stable identity that scripts, saves and snapshots key on.
- Kind-specific fields sit at the top level: `cards` (a deck's cards), `code` (a card), `value` (a counter), `seconds`/`running`/`down` (a clock), `contents` (a container's items — full object records, recursively), `group` (rigid-group membership).
- `visual` carries how the object looks: `type`, `name` (its label), `textures` (a map of slot → path), `model`, `hull` (a prop's collider points), `modelRotation`, `back`/`faces`/`names` (a custom deck), `state`/`states` (multi-state objects), a `tablet` document, and material scalars.
- `script` is the object's script *state*, not just its source: `source`, whether it is `enabled`, the `saved` string from `onSave`, the per-object `vars` and `tables`, and the contributions a script declares (`snaps`, `rotationValues`). Only the fields you give are read; a bare `{"source": "…"}` is enough for a new script.

## Files and hashes

An archive never points at a URL. Every texture, model, image, sound, font or PDF is referred to by the **SHA-256 of its bytes**, in one of two path shapes:

```
library/assets/<sha256>.<ext>            a single file
library/assets/b<sha256>/<model.ext>     a model bundle (a zip of model + textures); the hash is the zip's
```

Built-in content uses the app's own paths (`models/…`, `textures/…`, `assets/…`). Any other value — `http://…`, `data:`, a `//host` — is dropped when the archive is read, and the object renders without it. There is no way to make a table fetch something from the web.

`manifest.json` lists every hash the state uses. When an archive is loaded, the server checks each one against the site's file store:

- **known** — the store already has those bytes; the archive's copy, if any, is ignored;
- **new** — the bytes must be in `blobs/`; they are hashed as they are read, and stored only if the hash matches the name (*imported*), otherwise refused (*rejected*);
- **absent** — named but neither stored nor carried: the object shows as blank (*missing*);
- **blocked** — refused by moderation.

The load reports counts for each class; a clean load says nothing. Accepted file types: `png jpg jpeg svg webp gif bmp` for images, `glb gltf fbx obj mtl zip` for models, `woff2 woff ttf otf` for fonts, `mp3 ogg wav flac m4a` for sounds, and `pdf`.

## Getting assets onto a table

Files reach a table through the table itself: the **workbench** (upload a model, a texture, an image, a PDF) hashes them, stores them, and puts them in the gallery, from where objects and templates use them. That is the only upload path — there is none from scripts and none on the site outside the table.

To bring a set of files in at once, build an archive: put the bytes under `blobs/`, name them by hash in `manifest.json`, reference them from objects or from `assets` (the gallery) in `game.json`, and **Load from file…**. Files the store already holds need no bytes, only their entry in the manifest.

## Building an archive by hand

It is possible, and a tool or an AI agent can do it. Three rules make it painless:

1. **Start from a real export.** Build one object of each kind you need in the app, download the table, and use its `game.json` as the template. The app is the reference for the format, and its records carry every field with a sensible value.
2. **Describe the table as a plan.** Put a [table plan](/docs/table-plan) at `table.plan` — the outline as a few primitives, the seat count, the named areas — instead of writing loops and seat zones by hand. An archive that carries only the plan is compiled into all of that when it loads.
3. **Name files by hash, carry them under `blobs/`.** Compute the SHA-256 of each file, name the entry `blobs/<hash>.<ext>`, list `{"hash", "ext", "bundle": false, "model": "", "size"}` in the manifest, and reference `library/assets/<hash>.<ext>` from the object. For a model bundle, zip the model with its textures, hash the *zip*, store it as `blobs/<hash>.zip` with `"bundle": true, "ext": "zip", "model": "<file inside>"`, and reference `library/assets/b<hash>/<model file>`.

Scripts go in as source strings: `globalScript` for the table, `objects[].script.source` for an object, `library[].script` for a template. They must be written against the [TTCraft scripting API](/docs/scripting) — see below for what that means for saves from other tabletops. The [VS Code extension](/docs/vscode) is the comfortable way to edit them once the table is up.

Loading replaces the objects on the table; the rest is merged. Load into an empty table when in doubt.

## Saves from other tabletops

TTCraft does **not** read Tabletop Simulator saves or Workshop mods, nor any other tabletop's format. The reasons are structural, not a missing button:

- **Assets by URL.** A TTS object names its mesh and textures by URL and the client downloads them. TTCraft names files by content hash and never fetches URLs, so every asset has to be brought in as bytes.
- **A different object model.** Kinds, physics properties, decks and card faces, containers, states and snap points do not map one to one.
- **A different scripting API.** The Lua API is deliberately familiar if you have scripted for TTS — many names match — but it is not the same surface, and there is no XML UI: table UI is declared from Lua ([Custom UI](/docs/scripting-ui)). A TTS Global script will not run unchanged.

What works is a conversion: download the assets you have the rights to, build the objects — in the app or as an archive by the rules above — and port the scripts against the [scripting reference](/docs/scripting). An archive assembled this way loads like any other.
