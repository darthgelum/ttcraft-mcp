# Publish a module

Start with `modules_options` for current categories, asset labels, languages and limits.
Connect explicitly to a table you may manage. `modules_publish` accepts an absolute
`package_path`, `cover_path`, up to twelve `screenshot_paths`, and a `listing`:

```json
{
  "table_id": 19,
  "package_path": "C:/modules/clean-table.zip",
  "cover_path": "C:/modules/cover.png",
  "screenshot_paths": ["C:/modules/table.png", "C:/modules/sheet.png"],
  "listing": {
    "title": "Six Investigators & Keeper",
    "description": "A prepared investigation table with scripted character sheets.",
    "type": "game",
    "categories": ["Role-playing Games"],
    "assets": ["Scripting", "Dice", "Tables"],
    "languages": ["en"],
    "players": [7],
    "tags": ["CoC 7e"]
  },
  "dry_run": true
}
```

The default dry run validates local files and listing values and shows what will
be submitted. Set `dry_run=false` within the user's authorization to create the
public catalog listing. The response includes the module ID, public URL, edit URL,
cover and screenshot count. The live table is never replaced or cleared.

Omitting `package_path` exports the connected table, including hidden contents and
saved character state. For a starter module, prepare a clean archive separately.
Local packages may embed assets under `blobs/`; the server verifies their hashes
and formats and pins every required asset before publication. Missing asset bytes
are rejected rather than creating a broken module.

Media uploads stream from disk. Covers are limited to 5 MB; each screenshot to
10 MB. PNG, JPEG, WebP and GIF are supported. Publishing uses the same quotas,
archive validation, media store and table-management permission as the site.

Publication is sent once. A network failure may leave the result unknown; inspect
`modules_list` before trying again. It lists only the signed-in author's modules,
including unlisted ones. Tokens and browser cookies are never returned by tools.
