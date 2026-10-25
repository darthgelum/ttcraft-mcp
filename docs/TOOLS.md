# Tools and workflows

## Tools

| Area | Tools |
| --- | --- |
| Account | `auth_status`, `auth_begin`, `auth_poll`, `auth_logout` |
| Connections | `tables_list`, `table_connect`, `table_reconnect`, `table_disconnect`, `connections_status` |
| Inspection | `state_read`, `objects_list`, `object_read` |
| Objects | `objects_spawn`, `objects_patch`, `objects_move`, `objects_lock`, `objects_remove` |
| Table layout | `table_plan_apply` |
| Library | `library_list`, `library_save` |
| Lua | `script_read`, `script_write`, `console_read` |
| Events | `events_read` |
| Native API | `commands_search`, `command_describe`, `table_command`, `batch_execute` |
| Repeatable builds | `blueprint_apply` |
| Files | `assets_list`, `asset_upload`, `archives_export`, `archives_import`, `modules_import` |
| Saving | `table_save` |
| Offline reference | `docs_search`, `docs_read` |

Resources expose `ttcraft://guide` and `ttcraft://docs/{slug}`. The `build-table`
and `debug-table` MCP prompts provide starting workflows. All tools work without
prompts/resources if the client only supports MCP tools.

The searchable native catalog covers cards/decks, containers, tablets and their
documents, UI callbacks, object menus, physics, drawings, decals, snap points,
materials, effects, lighting, audio, players, edit leases and time-machine undo.
Search a domain, read its command description, then pass the protocol fields to
`table_command`. These commands use the same server permission checks as the
browser. Chat/direct-message and transport commands are deliberately excluded.

Native field lists are discovery hints extracted from the backend, not complete
validation schemas. `command_describe` includes the reference handler; the manual
documents the public scripting/layout APIs. The bundled snapshot may include
commands newer than your deployed table. There is no server capability-discovery
endpoint; an unavailable command can time out rather than be silently reported
as successful.

## Build a table

> Build a four-player table with a draw pile, discard area, score tokens and a
> rules note. Upload these card images, add Lua for setup, and check the console.

The intended workflow is inspect → read the relevant manual → upload resources →
preview a blueprint → apply → inspect objects and console. A complete starter is
[examples/four-player-table.json](examples/four-player-table.json).

Call `blueprint_apply` with that JSON as `blueprint`. Its default `dry_run: true`
validates the document and previews identities without changing the table. Use
`dry_run: false` to build. Preserve the same blueprint `id` and each item's `key`
when updating it.

- `plan` describes the outline, seats, areas and snaps in TTCraft's table-plan
  format. Coordinates are **metres**, `y` up, `+x` right, `+z` toward the near edge.
- `templates` creates or updates library definitions. `$key` refers to a template
  declared in this blueprint; an ordinary template value is an existing library id.
- `objects` tracks created instances by stable **GUID** in the local build index.
  Reapplying updates poses, names, `properties`, scripts and lock state. `spec` is
  the **creation** definition; subsequent property changes belong in `properties`.
- Blueprint template instances are independent clones, carrying the template's
  appearance/script at creation. They do not have live template linkage. Native
  linked-instance and multi-object set spawning is available via `objects_spawn`
  or `table_command`.
- Object `rotation` is a quaternion `[x,y,z,w]`; `scale` is `[x,y,z]`. Other native
  commands can use different rotation conventions—read their help.
- `global_script` is installed last. Omitted objects are preserved. Removed items
  are deleted only through explicit object tools/native commands.

Build indexes live in `~/.ttcraft-mcp/builds` and are scoped to origin, table id and
blueprint id. Keep that directory to preserve repeated-build identities. Different
machines/config directories do not share indexes and can create separate objects.
Simultaneous builds of one blueprint are blocked by a process lock. After a hard
process crash, inspect the `.lock` owner PID and remove the stale lock only when
that process is gone.

Before a creation, the build persists a pending marker. If a connection or process
dies, it tries to recover the matching marker on the next run. If the outcome
cannot be established, it reports the pending operation and index path instead of
creating another object. Blueprint/batch workflows are sequential, **not atomic**;
on failure they report completed steps. Back up with `archives_export` when needed.

## Work on Lua as local files

`script_read` reads Global, a GUID-addressed object, or a library template. It
returns source and a SHA-256; use `output_path` to create a local file without
overwriting an existing file. The agent can edit it using its normal file tools.

`script_write` accepts `code` or `file_path`, plus optional `expected_sha256`.
The hash check catches a source change before writing. It is a client-side check,
not an atomic server compare-and-swap; another editor could still race it.
Compilation failures return MCP `isError` and leave the previous script running.
Use `console_read` with the previous cursor to inspect new runtime errors.

There is no arbitrary Lua eval tool. Use proper Global/object/template scripts and
the actual TTCraft API from `docs_search`, rather than assuming another tabletop's
Lua API or temporarily replacing Global just to execute a helper.

## Files, saves and operation results

Uploads use the browser's `/blob.*` staging API in bounded chunks, checking the
authoritative offset before retrying a lost chunk. File paths must be absolute.
`asset_upload` returns `library/assets/...` for use in object/template definitions.
Exports stream to disk, refuse accidental overwrites and verify the ZIP signature.
Full imports replace live objects; additive `modules_import` keeps the existing
world and supports per-package layout/global-script choices. Both reconnect after
success. The server's archive importer validates the actual archive contents.

`table_save` writes a named snapshot to the **table server database**. This is not
the site's account save-slot API. `archives_export` is the portable backup path.
This release does not add account save management, publishing or table start/stop
endpoints to TTCraft's dev API.

Some native operations have a direct reply, such as `scriptresult`, `libresult` or
`tableplanresult`. Others have **no success acknowledgement**. For those, an echo
barrier proves the server processed the command stream; the result is explicitly
`processed_unverified`. Inspect current objects/state/events to verify the effect.
Spawn results contain observed new objects and can include simultaneous spawns
from other players. Blueprints use unique recovery markers for their own creations.

Commands are serialized per table because many replies have no request id. After
a request timeout, the connection closes to prevent a late reply from satisfying
a later request. Reconnect and inspect before retrying; no mutation is replayed
automatically. Events/logs are bounded, cursor based and report truncation. Large
manual, source and state reads support pagination.

