---
title: Build tables with an AI agent
description: Install TTCraft MCP for Claude Code, Codex and other local MCP clients. Sign in, build a table and watch the result live in your browser.
order: 36
section: Table scripting
toc: true
---

**TTCraft MCP connects your AI assistant to a live TTCraft table.** Ask it to
build a game, arrange pieces, make cards, add assets, write Lua or inspect a broken
script. Keep the table open in your browser to see its work as it happens.

It works with **Claude Code, Codex and other clients that run local MCP servers**.
You need Node.js 22 or newer, a TTCraft account, and a running table in a room
where you have **Manage table** permission. An account's normal table permissions
still apply. The VS Code extension and a GitHub token are not required.

TTCraft MCP is free and open source. Find source code, release downloads and issue
reports in the [GitHub repository](https://github.com/darthgelum/ttcraft-mcp).

## Let your assistant set it up

Copy this message into your assistant:

> Set up TTCraft MCP using https://ttcraft.net/docs/mcp-setup.md . Install it on
> this computer and configure this client, preserving my existing MCP servers.
> Verify that the tools load, help me sign in through the browser, then list my
> running tables. Ask me which table to use before changing anything.

The [agent setup guide](/docs/mcp-setup) includes the release URL, commands,
configuration formats and checks. The assistant can do the installation; you
approve the TTCraft login in your browser. A client may need to restart or reload
MCP before it can use a newly added server.

Prefer doing it yourself? Follow the three steps below.

## 1. Install

Install [Node.js LTS](https://nodejs.org/en/download) if needed, then open a terminal:

```sh
node --version
npm install --global https://ttcraft.net/downloads/ttcraft-mcp-0.1.2.tgz
ttcraft-mcp setup
```

The first command must report **v22 or newer**. The last command prints commands
for your computer, including the actual paths to Node.js and the installed MCP.
It does not change client settings or sign you in.

On Windows, if PowerShell blocks `npm.ps1` or `ttcraft-mcp.ps1`, use `npm.cmd` and
`ttcraft-mcp.cmd` instead. Do not change the system execution policy.

This release is distributed directly by TTCraft as a versioned npm archive.
Use the full URL above; the unqualified npm registry name `ttcraft-mcp` is not
the distribution channel. The [SHA-256 file](/downloads/ttcraft-mcp-0.1.2.tgz.sha256)
is available for download verification.

### Install without administrator access

If global npm installation fails with a permission error, install into a folder
you own. Administrator access is unnecessary.

**Windows PowerShell:**

```powershell
$mcpDir = Join-Path $HOME '.ttcraft-tools'
npm.cmd install --prefix "$mcpDir" https://ttcraft.net/downloads/ttcraft-mcp-0.1.2.tgz
node "$mcpDir/node_modules/ttcraft-mcp/dist/index.js" setup
```

**macOS or Linux:**

```sh
npm install --prefix "$HOME/.ttcraft-tools" https://ttcraft.net/downloads/ttcraft-mcp-0.1.2.tgz
node "$HOME/.ttcraft-tools/node_modules/ttcraft-mcp/dist/index.js" setup
```

Use the configuration printed by that copy of `setup`.

## 2. Connect your assistant

### Claude Code

Copy and run the **Claude Code** command printed by `ttcraft-mcp setup`.
It adds the server to your user configuration. Restart Claude Code or reload
MCP, then use `/mcp` to check that **ttcraft** is connected.

The printed command has this shape; use the actual paths from your output:

```sh
claude mcp add --transport stdio --scope user ttcraft -- "/absolute/path/to/node" "/absolute/path/to/ttcraft-mcp/dist/index.js"
```

See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp)
for client settings and project scopes.

### Codex

Copy and run the **Codex** command printed by `ttcraft-mcp setup`:

```sh
codex mcp add ttcraft -- "/absolute/path/to/node" "/absolute/path/to/ttcraft-mcp/dist/index.js"
```

Restart Codex or reload its MCP servers. `codex mcp list` should list **ttcraft**.
For manual configuration, `setup` also prints a `[mcp_servers.ttcraft]` TOML
section, including a five-minute tool timeout for large transfers.

### VS Code, Cursor, Claude Desktop and other clients

Run `ttcraft-mcp setup --json` to get the paths and JSON configuration. Most clients
accept the `mcpServers` object. VS Code uses the `vscode` output's **servers** object
in `.vscode/mcp.json`. Merge the entry into existing settings, then start or reload
the server through the client's MCP controls.

Choose **stdio** as the transport. The command is the absolute Node.js executable;
its argument is the absolute `dist/index.js` path. This also avoids Windows
`.cmd` launcher problems. No MCP server address or OAuth client secret is needed.
This release runs locally; it cannot be added as a remote HTTP connector to a
web-only chat client. VS Code's format is described in its
[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## 3. Sign in and choose a table

Open your game room on [TTCraft](https://ttcraft.net), start its table, then ask:

> Sign in to TTCraft and show my running tables. Connect to the table I select.

The assistant calls `auth_begin` and gives you a TTCraft approval link and a short
code. Open that link, sign in if necessary, and approve the device. The assistant
then checks `auth_poll` and lists tables. **Your password stays in the browser.**

You can also sign in from the terminal with `ttcraft-mcp login`, then restart or
reconnect the assistant's MCP server so it reads the saved credential.

Keep the table tab open. MCP connects as a separate tool session for your account:
it does not take your seat, change your player colour or disconnect the browser.
Several agents can connect, although coordinating edits to the same object or
script is still your responsibility.

## What to ask it to do

Give the assistant a concrete goal and any visual or gameplay constraints:

> Inspect this table first. Add a central draw deck, discard zone and four player
> areas. Reuse existing pieces, and show me the plan before applying it.

> Read the Global Lua script and the dice scripts. Find why scoring does not
> update, fix it, compile it and inspect the console for errors.

> Make a repeatable blueprint for a six-player setup. Run a dry run first, apply
> it, then check that applying it again does not create duplicate pieces.

> Export a backup to a local ZIP before changing the table layout.

The server provides **40 MCP tools** and a searchable reference for **144 native
table commands**. The assistant discovers exact arguments from tool schemas.

| Task | Tools to start with |
| --- | --- |
| Connect and inspect | `auth_status`, `tables_list`, `table_connect`, `state_read`, `objects_list` |
| Build and arrange | `commands_search`, `command_describe`, `command_run`, `blueprint_apply` |
| Lua scripts and errors | `objects_list`, `script_read`, `script_write`, `console_read` |
| Templates and media | `library_list`, `asset_upload`, `assets_list` |
| Backups and modules | `archives_export`, `archives_import`, `modules_import` |
| Publish a module | `modules_options`, `modules_list`, `modules_publish` |
| Built-in documentation | `docs_search`, `docs_read` |

Changes affect the shared table. Archive import replaces the current world;
module import adds content. Export a backup before a large or destructive change.
An assistant should inspect the state after an uncertain timeout before deciding
what to do next, because automatically repeating a creation could duplicate it.

Module publication supports listing text, a cover and up to twelve screenshots.
Use a dry run first; publishing does not change the source table. A local clean
package can be published instead of the live snapshot. After an uncertain network
result, inspect `modules_list` before retrying.

For table behaviour and Lua, see [scripting](/docs/scripting),
[table plans](/docs/table-plan) and [archives](/docs/table-archives).

## Troubleshooting

| What you see | What to do |
| --- | --- |
| No TTCraft tools after installation | Add the MCP entry to the client you are actually using, then reload MCP or restart it. Running `setup` alone only prints configuration. |
| Node or the launcher is not found | Reopen the terminal after installing Node. Use the absolute executable and script paths printed by `setup`. |
| Global installation says permission denied | Use the private-folder installation above. |
| Signed out | Call `auth_begin`, approve the browser code, then `auth_poll`. Do not paste access tokens into chat. |
| Table missing from the list | Start the room's table and check your **Manage table** permission. Practice/tutorial tables are excluded. |
| MCP requests a table update or safe restart | The running instance predates tool sessions. Save it, update its server and restart the table through the room controls. MCP refuses before opening a connection, preserving the browser session. |
| A tool times out | Reconnect and inspect the current state before retrying a mutation. For large transfers, use a longer client tool timeout. |
| Works locally, fails over SSH or in a container | Install and configure MCP where the client actually runs. Login storage and local file paths belong to that machine and OS user. Use `auth_begin` with `open_browser: false` and open the link on your own computer. |

## Update or remove

Install the versioned package listed in this guide again, then reload MCP.
If you moved the installation folder or Node.js executable, rerun `setup` and
update the configured paths. An existing MCP process keeps its old version until
it is restarted.

To disconnect, remove the **ttcraft** entry from your client's MCP settings.
For a global installation, run `npm uninstall --global ttcraft-mcp`. A private
installation can be removed with `npm uninstall --prefix <your-folder> ttcraft-mcp`.

`ttcraft-mcp logout` removes the saved local login. Revoke **TTCraft MCP** in
TTCraft **Settings → Security** to invalidate the device's access. Credentials
are stored under `~/.ttcraft-mcp`, encrypted with Windows DPAPI on Windows and
restricted to the current OS user on macOS/Linux. They are not written into
client configuration. Browser login and MCP login can be revoked independently.
