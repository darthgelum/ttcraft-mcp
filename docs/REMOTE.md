# Hosted MCP with OAuth

The `serve-http` entrypoint hosts the existing tools through the official SDK's
Streamable HTTP transport. The stdio entrypoint is unchanged. No shared account
token is configured for the gateway; it refuses `TTCRAFT_TOKEN`.

## Trust boundaries

1. TTCraft serves RFC 8414 authorization metadata and RFC 9728 protected-resource
   metadata. `/oauth/authorize` uses the existing browser login and explicit
   session/CSRF-bound approval. Authorization Code + S256 PKCE is mandatory.
2. Public clients can register exact redirects through `/oauth/register`.
   Codex and Claude published client metadata documents are supported through a
   strict HTTPS URL allowlist, without redirects. Other clients use DCR.
3. Access tokens last 10 minutes; grants expire after 90 days. Rotating refresh
   tokens detect replay and revoke the entire grant. OAuth token values are stored
   only as SHA-256 digests. Each grant's separate upstream developer credential is
   encrypted using Laravel's APP_KEY and linked to the existing DevToken revoke UI.
4. The gateway exchanges an external access token over a confidential internal
   introspection endpoint. External OAuth tokens are never passed to developer
   APIs or table WebSockets. The dedicated gateway secret is not a table service
   secret and is never supplied to an MCP client.
5. Every HTTP call authenticates. MCP sessions are bound to both user and grant;
   refreshing a token preserves that binding. Every tool rechecks its identity;
   table reads and commands recheck Manage table and native caps. Permission
   removal disposes cached table sessions. System-wide roles add no local rights.
6. File arguments accept only `/workspace/` paths, resolved to an account directory.
   Traversal, symlinks, special files and host absolute paths are rejected.
   File staging has a 64 MiB file ceiling, 1 MiB chunks and 256 MiB workspace budget.
   Remote exports have a 64 MiB ceiling; use the browser or stdio for larger ones.
   Module publication's temporary spool uses the container's bounded `/tmp`.

At most five sessions per account and 100 per process are active. Idle sessions
expire after 15 minutes; table WebSockets are disposed. HTTP bodies are limited
to 2 MiB. Tools do not automatically retry table mutations.

## Configuration

On TTCraft (Laravel), set `MCP_ENABLED=true`, `MCP_RESOURCE_URL=https://ttcraft.net/mcp`
and a newly generated `MCP_GATEWAY_SECRET` of at least 32 random characters. Run
the normal additive migrations. Keep APP_KEY stable; it protects internal grant
credentials. Disabling the feature removes OAuth routes.

Build the gateway with `docker build -t ttcraft-mcp:local .`. Load it into the
cluster runtime using the deployment's existing `load_image` helper. Configure:

```ini
TTCRAFT_URL=https://ttcraft.net
MCP_RESOURCE_URL=https://ttcraft.net/mcp
MCP_INTROSPECTION_URL=http://ttcraft-web:8000/internal/mcp/introspect
MCP_DATA_DIR=/data
HOST=0.0.0.0
PORT=8090
```

Inject `MCP_GATEWAY_SECRET` from the same Kubernetes Secret into the app and
gateway. Do not put its value in source control, command arguments or logs.
The `/internal/mcp/*` namespace is blocked on the public reverse proxy.

The platform repo includes `deploy/k8s/linux/mcp.yaml`. Prepare durable host
storage/PV with its existing `prepare_host_volumes` helper **before** applying
the PVC; otherwise minikube may allocate ephemeral `/tmp` storage. The process
runs as UID 1000 without a Kubernetes service-account token, with a read-only
root filesystem. One replica owns sessions; use a shared/session-aware design
before adding replicas. Restarting the gateway requires MCP reconnect, never a
game-table restart.

Route only `/mcp` to the gateway. OAuth endpoints and metadata go to Laravel.
The supplied Caddy stanza streams responses without buffering. Reload Caddy
gracefully when possible so existing table WebSockets stay connected.

The platform's Apache image also includes an exact `/mcp` proxy fallback,
enabled by its entrypoint only for the web role with `MCP_ENABLED=true`. This
allows a rollout without reloading the shared Caddy process while players are
seated. The next planned Caddy deployment can install the direct route. Until
then the internal introspection URL is still protected by its dedicated secret;
the public Caddy deny rule adds a second boundary once installed.

## Verification

`npm test` includes real SDK stdio and HTTP clients against isolated TTCraft
fixtures, identity/session separation, token rejection, file isolation, existing
script tools, and revocation of cached table reads. The platform's
`McpOAuthTest` uses a dedicated test database and covers consent, PKCE, callback
binding, client identities, code/refresh replay, resource binding and revocation.
Never run database-refresh tests against the live database.

Public smoke checks must verify the `/mcp` 401 challenge, discovery JSON, the
OAuth metadata, and a gateway readiness probe. User authorization remains an
interactive browser action. The first live connection should list tools/tables
and inspect state; do not import, reset or mutate an arbitrary active table.
