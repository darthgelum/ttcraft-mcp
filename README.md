<p align="center"><img src="media/logo.png" width="600" alt="TTCraft"></p>

<p align="center"><b>Build your <a href="https://ttcraft.net">TTCraft</a> game tables with an AI assistant.</b><br>Arrange pieces, make cards, upload assets and write Lua — while you watch the result in your browser.</p>

<p align="center"><a href="https://ttcraft.net/docs/mcp">User guide</a> · <a href="https://ttcraft.net/docs/mcp-setup.md">Agent setup instructions</a> · <a href="https://github.com/darthgelum/ttcraft-mcp/releases">Downloads</a> · <a href="https://github.com/darthgelum/ttcraft-mcp/issues">Report an issue</a></p>

## What you get

- 🎲 **Build a whole table.** Create and arrange objects, work with cards and templates, define player areas, zones and snaps.
- 🤖 **Use your preferred assistant.** Claude Code, Codex, Cursor, VS Code and other clients that support local MCP servers.
- 🖥️ **Watch it work.** Keep the table open in your browser. MCP works alongside your player session without taking your seat or disconnecting the tab.
- 📜 **Write and debug Lua.** Let the assistant read scripts, edit local files, compile changes and inspect the console.
- 🎨 **Bring your assets.** Upload images, models, audio, fonts and PDFs for use in templates and objects.
- 🧩 **Repeat a setup.** Blueprints update tracked objects instead of making another copy of every piece.
- 💾 **Keep a backup.** Export a portable table archive before a large change, or add content from module archives.
- 📚 **Give the agent the actual manual.** The package includes TTCraft documentation and a searchable command reference.

## The easiest way to start

Give your assistant this message:

> Set up TTCraft MCP using https://ttcraft.net/docs/mcp-setup.md . Install it on this computer and configure this client, preserving my existing MCP servers. Verify that the tools load, help me sign in through the browser, then list my running tables. Ask me which table to use before changing anything.

The assistant handles installation and configuration. You approve the TTCraft
login in your browser and choose the table. Your client may need a restart to
load the new tools. The [complete guide](https://ttcraft.net/docs/mcp) explains
each step.

## Install it yourself

You need **Node.js 22 or newer**, a TTCraft account and a client that can launch
local MCP servers. Get [Node.js LTS](https://nodejs.org/en/download) if needed.
No VS Code extension or GitHub token is required.

```sh
npm install --global https://ttcraft.net/downloads/ttcraft-mcp-0.1.2.tgz
ttcraft-mcp setup
```

Copy the **Claude Code** or **Codex** command printed by `setup`, run it and
reload MCP or restart the client. The commands contain the correct absolute
paths for your computer. For other clients, use the JSON configuration printed
by `setup`; VS Code's `servers` format is included in `setup --json`.
Running `setup` alone does not change settings.

On Windows, use `npm.cmd` and `ttcraft-mcp.cmd` if PowerShell blocks `.ps1`
launchers. If global installation needs administrator access, follow the
[private-folder installation](https://ttcraft.net/docs/mcp#install-without-administrator-access).
The release is served directly by TTCraft as a versioned archive; do not
substitute an unqualified npm registry package name.

## Sign in and open a table

1. **Start the table** from its room on [ttcraft.net](https://ttcraft.net). You need **Manage table** permission; owners and moderators normally have it.
2. **Ask your assistant to sign in.** It gives you a TTCraft approval link and short code. Approve in the browser, then tell the assistant you are ready. Your password stays in the browser.
3. **Choose your table** from the list the assistant retrieves. It inspects the existing state before making changes.
4. **Keep the browser tab open** and describe what you want to build.

You can also use `ttcraft-mcp login` in a terminal. Reconnect an already-running
MCP server afterward so it reads the saved credential.

## Things to try

> Inspect my table. Add a draw pile, a discard area and four player areas. Reuse existing pieces and show me the plan first.

> Find why scoring does not update. Read the Global and dice scripts, fix them, compile and check the console.

> Create a repeatable six-player setup. Dry-run it, apply it and verify that a second application does not duplicate pieces.

> Export a backup to a ZIP before changing the layout.

The assistant has **37 tools** and a reference for **144 native commands**.
Describe the result you want without learning tool names. Details are in
[tools and workflows](docs/TOOLS.md), [Lua scripting](https://ttcraft.net/docs/scripting)
and [table plans](https://ttcraft.net/docs/table-plan).

## Good to know

- **Changes affect the shared table.** Export a backup before a large replacement. Archive import replaces the world; module import adds content.
- **Your permissions still apply.** MCP follows your account permissions and table rules.
- **Tables must be running.** Start them from the room page. Practice/tutorial tables are excluded.
- **Browser and agents coexist.** Several agents can connect; coordinate edits to the same scripts or objects. Older instances need a saved restart onto a server with tool-session support. MCP refuses them before connecting.
- **Local clients only.** This is a stdio server, not an HTTP connector for web-only chats. Over SSH or in a container, install it where the assistant runs.
- **Login can be revoked.** Use TTCraft **Settings → Security** to revoke the device. `ttcraft-mcp logout` removes the local credential.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Tools do not appear | Run the client command printed by `setup`, then reload MCP or restart the client. |
| Launcher not found | Reopen the terminal after installing Node. Use the absolute paths from `setup`. |
| Empty table list | Start the table and check **Manage table** permission. |
| Signed out | Ask the assistant to start browser sign-in and wait for approval. |
| Table needs an update | Save and restart it after the server upgrade. Do not bypass the compatibility check. |
| Operation timed out | Reconnect and inspect the result before repeating a change. |

More help: [full guide](https://ttcraft.net/docs/mcp) · [report an issue](https://github.com/darthgelum/ttcraft-mcp/issues).

## Update or remove

Install the version listed in the guide again, then reload MCP. If the installation
path changed, rerun `setup` and update the client configuration.

To remove it, delete **ttcraft** from your client's MCP settings and run
`npm uninstall --global ttcraft-mcp` for a global installation. Revoke its device
in TTCraft settings if you also want to end account access.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for builds, tests and backend integration.
Bug reports and ideas are welcome in [Issues](https://github.com/darthgelum/ttcraft-mcp/issues).

MIT © TTCraft.
