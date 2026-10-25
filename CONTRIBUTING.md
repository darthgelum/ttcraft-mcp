# Developing TTCraft MCP

Requires Node.js 22+. Clone this repository, run `npm ci`, then `npm run build`.
`node dist/index.js setup` prints client configuration for this checkout.

## Develop and verify

```sh
npm test
npm audit --omit=dev
npm pack
```

Tests cover MCP discovery/resources/prompts, device sign-in and credential storage,
binary state, request serialization, source conflicts, Lua compile failures,
blueprint reuse and locking, partial batch failures, chunked uploads, archives,
token handling, disconnects and timeout recovery. CI is configured for Node 22 on
Windows and Linux.

Optional integration against a real compiled C++ backend:

```sh
npm run test:native -- /absolute/path/to/tableweb-server /absolute/path/to/tableweb
```

This copies the sample game to a new temporary directory, uses isolated ports
19077/19078, and tests Lua compilation, repeated blueprint builds, positions and
locks, an image upload, a named snapshot and archive export/import. It does not
exercise production browser approval or production permissions. Override the
isolated base port with `TTCRAFT_TEST_PORT`; live development ports are refused.

Refresh the bundled backend/manual reference after API changes:

```sh
npm run sync-reference -- /path/to/tableweb /path/to/ttcraft/resources/docs
```

The reference and protocol schema are shipped with the package; sibling projects
are not needed at runtime. The decoder currently supports object-record protocols
9–13, with an explicit gate for newer versions; native smoke coverage uses v13.
`reference/snapshot.json` records the generation date and protocol source hash.

MIT © TTCraft.
