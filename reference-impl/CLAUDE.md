---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Setup from scratch

```sh
cd reference-impl
bun run setup          # install deps, download vendor JS, build CSS + datastar
cp .env.example .env   # configure OAuth (optional)
docker compose up -d   # start Keycloak (optional, for OAuth)
docker build -t agrp-wmlet .  # build workspace container image
```

## Development

Start dev server in tmux (two panes: server + CSS watcher):

```sh
# Build CSS first
bun run css:build

# Start tmux session with server + CSS watcher
tmux new-session -d -s ws-dev -n dev 'bun --watch wsmanager.ts'
tmux split-window -v -t ws-dev:0 'bun run css:watch'
tmux select-layout -t ws-dev:0 even-vertical

# Attach to see output
tmux attach -t ws-dev
```

Or run in foreground (no tmux):

```sh
bun dev
```

Other commands:
- `bun run css:build` — rebuild CSS once
- `bun run css:watch` — watch CSS changes
- `bun run dev:manager` — run wsmanager with --watch (no CSS)

Dev server runs on `http://localhost:31337` (or `$PORT`).

## CSS / Tailwind

Tailwind CSS v4 with `@tailwindcss/typography` plugin, same setup as health-samurai.

- `ui/tailwind.css` — Tailwind entrypoint (imports, plugin, source globs, custom `.md-preview` styles)
- `public/styles/main.css` — generated CSS (served by wsmanager at `/styles/main.css`)
- Do NOT use Tailwind CDN script. Always use the built CSS file.
- Run `bun run css:build` after changing `ui/tailwind.css` or adding new Tailwind classes.

## UI Architecture

Server-side rendered HTML with htmx + Datastar. No SPA, no React on client.

- `ui/jsx-runtime.ts` — custom JSX runtime that renders to HTML strings (not React)
- `ui/layout.tsx` — shared page shell: `<link>` to `/styles/main.css`, htmx, Datastar
- `ui/workspaces.tsx` — workspace list, create dialog
- `ui/topics.tsx` — topic list within a workspace
- `ui/topic.tsx` — topic detail with runs, chat, artifacts
- `ui/files.tsx` — file browser with Shiki syntax highlighting, server-side Mermaid, Tailwind prose
- `ui/datastar.ts` — helper for emitting Datastar SSE events (merge-fragments, merge-signals, etc.)
- `tsconfig.json` has `"jsx": "react-jsx"` and `"jsxImportSource": "./ui"` for the custom runtime

### Markdown preview (files.tsx)

- `Bun.markdown` converts md → HTML
- Shiki (`github-light` theme) highlights code blocks server-side
- `beautiful-mermaid` renders mermaid diagrams to SVG server-side
- Tailwind Typography `.prose` + custom `.md-preview` class for styling

### Static assets

`wsmanager.ts` serves `public/` at `/styles/*`, `/js/*`, `/webfonts/*`, `/assets/*`.

### Console panel (topic.tsx)

Bottom of main pane, collapsible, two tabs:
- **Logs** — SSE stream from wmlet (`/logs/stream`), live container output
- **Shell** — execute commands in workspace dir via `/exec` API

When Claude not authenticated, Console auto-opens with "Get token" button + token input field.

### UI routes in `wsmanager.ts`

- `/ui` — workspaces list
- `/ui/:workspace` — topics for a workspace, file browser, console
- `/ui/:workspace/:topic` — topic detail (runs, chat), console
- `/htmx/*` — htmx partial endpoints (return HTML fragments)
- `/api/render-md` — server-side markdown rendering (Shiki + Mermaid)
- `/api/users?q=` — user directory search (Keycloak)

## Docker Architecture

Each docker workspace runs as a non-root user with sudo.

### Container structure
```
/app/                     — wmlet + dependencies (read-only mounts in dev)
/home/<username>/         — user home dir
/home/<username>/.claude/ — Claude credentials (PERSISTED via volume)
/home/<username>/workspace/ — workspace files (PERSISTED via volume)
```

### Host data layout
```
data/workspaces/<name>/
├── workspace/            — mounted to /home/<user>/workspace
├── .claude-auth/         — mounted to /home/<user>/.claude (credentials persist here)
└── ...
```

### User creation
- `docker-entrypoint.sh` creates user from `WS_USER` env var (derived from owner displayName)
- User gets sudo without password
- `WORKSPACE_DIR` defaults to `/home/<user>/workspace`

### Port allocation
Random 5-digit port (10000-59999) for each workspace, verified free before use.

## Authentication

### Platform auth (Keycloak OAuth)
- `OAUTH_*` env vars configure Keycloak integration
- Cookie `ws-token` holds JWT after OAuth login
- In non-OAuth mode, `LOCAL_ACTOR` fallback allows unauthenticated UI access

### Claude auth (per-workspace)
- NEVER suggest using `ANTHROPIC_API_KEY`. NEVER mount host credentials into containers.
- This is a multi-user system: each user authenticates Claude independently in their workspace.
- Users run `claude setup-token` locally to get a long-lived `sk-ant-oat01-*` token (1 year).
- Token is pasted into Console UI → saved to `~/.claude/.credentials.json` on persistent volume.
- Token survives container restarts.
- API: `POST /…/auth/token` sets token, `GET /…/auth/status` checks auth state.

### Workspace access control
- Each workspace has `members[]` array. Owner is first member (role: "owner").
- If members exist, only members can access workspace (API, UI, WebSocket).
- If no members (legacy/empty), workspace is open access.
- `POST /…/members` — invite (owner only), `DELETE /…/members/:id` — remove (owner only).

## Persistence

Workspaces are persisted in `data/workspaces.json` (atomic writes via temp+rename).
- Saved after every create/delete operation
- Restored at server startup (after server starts listening to avoid race conditions)
- Docker containers and local wmlet processes are re-launched from persisted data

## Testing

- `bun test tests/` — run all tests (171 tests)
- `tests/unit.test.ts` — auth, protocol, files, persistence (98 tests)
- `tests/wmlet-unit.test.ts` — wmlet pure functions (66 tests)
- `tests/api.test.ts` — integration tests against running server (7 tests)
