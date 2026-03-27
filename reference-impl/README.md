# Agentic Workspace Reference Implementation

This directory contains a Bun-based reference implementation for the
workspace/topic API in [RFC 0001](../rfcs/0001-workspace-topic-api-surface.md).

## Components

- `wsmanager.ts` — Public API server. Owns authentication, OAuth flow,
  workspace lifecycle, and WebSocket bridging.
- `wmlet.ts` — Per-workspace runtime inside a Docker container. Internal API
  only; not a public surface.
- `cli.ts` — CLI client for workspaces, queues, and topic event streams.
- `ui.html` — Browser UI served at `/ui`. Single-page app with workspace/topic
  management and live chat.
- `auth.ts` — JWT minting/parsing, actor resolution.
- `protocol.ts` — Shared types and URL helpers.

## Architecture

```text
Browser (ui.html)  /  CLI (cli.ts)
    |
    |  HTTP + WebSocket
    v
wsmanager.ts (:31337)
    |
    |  internal HTTP + internal WebSocket
    v
wmlet.ts (one per workspace Docker container)
    |
    |  ACP over stdio
    v
claude-agent-acp
```

## Key Decisions

### Run-centric protocol

The protocol uses `submit_run` (not `prompt`) as the WebSocket message type.
Each topic has one active run and a queue of pending runs. State is conveyed via
`topic_state`, `run_updated`, `message`, and `text_chunk` events.

### OAuth login via configurable provider

Authentication supports any OAuth 2.0 / OpenID Connect provider (Keycloak,
Google, GitHub, etc.) configured through environment variables. When OAuth is
not configured, the system falls back to unsigned JWTs with a prompted display
name.

The flow:
1. UI redirects to `GET /oauth/login` → provider authorization page
2. Provider redirects back to `GET /oauth/callback?code=...`
3. Manager exchanges code for access token, fetches userinfo, mints a session JWT
4. Redirect to `/ui#token=<jwt>` — UI picks it up and stores in localStorage

Relevant env vars (see `.env.example`):
- `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`
- `OAUTH_AUTHORIZE_URL`, `OAUTH_TOKEN_URL`, `OAUTH_USERINFO_URL`
- `OAUTH_SCOPES` (default: `openid profile email`)

### Keycloak as default identity provider

`docker-compose.yml` includes a Keycloak instance with a pre-configured
`workspace` realm, a confidential `workspace-ui` client, and a default user
`admin/admin`. Realm config is imported from `keycloak-realm.json`.

### Credential provisioning via HTTP (not volume mounts)

Workspace containers do **not** mount host credential files. Instead:
- Manager exposes `GET /internal/token` with raw Claude OAuth credentials
- wmlet calls this endpoint at startup and writes `.credentials.json` locally
- Containers receive `MANAGER_URL` env var pointing back to the manager

This avoids host filesystem coupling and works in remote/CI environments.

### Container-as-workspace with Docker labels

Each workspace runs in a Docker container named `agrp-ws-{name}` with labels:
- `agrp=workspace` — identifies the container as a workspace
- `agrp.workspace={name}` — workspace name
- `agrp.namespace={namespace}` — namespace
- `agrp.owner.id={sub}` — owner's identity (from JWT `sub` claim)
- `agrp.owner.name={displayName}` — owner's display name

Labels survive container restarts and are queryable via `docker ps --filter`.
The `/health` endpoint returns container info including owner.

### Stale container cleanup

Before `docker run`, the manager runs `docker rm -f` on the target container
name. This prevents "name conflict" errors from stopped leftover containers.

### Files API mapping

The manager exposes a simplified files API that maps to wmlet's internal routes:
- `PUT /files?path=X` → `PUT /internal/files/content?path=X` (write)
- `GET /files?path=X&content=true` → `GET /internal/files/content?path=X` (read content)
- `GET /files?path=X` → `GET /internal/files?path=X` (file info)
- `DELETE /files?path=X` → `DELETE /internal/files?path=X` (delete)

### Streaming text chunks

wmlet broadcasts `text_chunk` events with incremental assistant text as it
arrives from the ACP runtime. The UI uses these for live streaming display.

## Quick Start

```bash
# Start Keycloak (identity provider)
docker compose up keycloak -d

# Build the runtime image
docker build -t agrp-wmlet .

# Start the manager (reads .env for OAuth config)
bun run wsmanager.ts

# Open browser
open http://localhost:31337/ui
```

Or run everything in Docker:

```bash
docker compose up -d
```

## Testing

```bash
# Integration tests (requires running manager + Docker)
bun test wmlet.test.ts

# Smoke test
bun run test.ts
```

## CLI

```text
bun run ws list
bun run ws create <name> [topics...]
bun run ws delete <name>
bun run ws topics <name>
bun run ws queue <name> <topic>
bun run ws connect <name> [topic]
bun run ws health
```

## Current Limitations

- `inject` is exposed but rejected — the ACP runtime does not support mid-run
  append.
- Managed tool CRUD is manager-side state only; not wired into runtime tool
  execution.
- The file API is a lightweight reference, not a hardened storage service.
