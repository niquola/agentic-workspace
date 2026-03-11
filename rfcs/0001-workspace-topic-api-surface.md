# RFC 0001: Workspace Topic API Surface

- Status: draft
- Date: 2026-03-11

## 1. Scope

This document defines the clean public API for:

- namespaced workspaces
- topic-based collaborative agent work
- active and queued runs within a topic
- topic event streaming
- queue mutation
- inject and interrupt operations
- a minimal tool inventory and managed MCP tool surface
- a provisional workspace file profile
- namespace lifecycle events

It is intentionally opinionated. It describes the public contract that
independent implementations should share. It does not preserve historical alias
routes, helper endpoints, or implementation-specific runtime details.

In particular, this document does not standardize:

- `/acp/...` compatibility routes
- `/workspaces/...` compatibility routes
- internal runtime routes such as `/ws/...`
- manager-local helper APIs such as `/apis/v1/local-tools`
- deployment topology, broker design, environment variables, or filesystem
  layout

## 2. Core Model

The public hierarchy is:

```text
namespace -> workspace -> topic
```

The canonical REST base is:

```text
/apis/v1/namespaces/{namespace}/...
```

The canonical WebSocket endpoints live under the same hierarchy:

```text
wss://.../apis/v1/namespaces/{namespace}/...
```

A topic has two kinds of state:

- durable transcript history
- current runtime state

Current runtime state is defined as:

- zero or one active `run`
- an ordered queue of future runs

A prompt submission creates a run. If the topic is idle, that run may start
immediately. If the topic is already executing, the new run is queued.

A run may receive additional injected user input while it is active. Injection
does not create a second concurrent run. It appends input to the active run.

Queued work is therefore a queue of future runs, not a queue of arbitrary
messages.

Defined run states are:

- `queued`
- `running`
- `completed`
- `cancelled`
- `failed`

At most one run may be `running` in a topic at any moment.

## 3. Common Rules

- JSON timestamps use RFC3339 UTC.
- `eventId`, `runId`, `injectId`, `toolCallId`, `grantId`, and `logId` are
  opaque strings.
- Clients MUST ignore unknown fields.
- Topic WebSockets use a custom JSON message protocol. They are not JSON-RPC.
- `runId`, `injectId`, and `toolCallId` are server-assigned.
- Clients do not provide `submittedBy`, `interruptedBy`, or other attribution
  fields.
- Current topic state and replayed history are distinct protocol concepts.
- Current topic state is authoritative for what is happening now.
- Replay is historical only. It MUST NOT redefine current execution state.

## 4. Authentication And Actor Identity

This API assumes bearer JWTs.

HTTP requests carry the token in:

```text
Authorization: Bearer <jwt>
```

WebSocket clients authenticate by sending:

```json
{ "type": "authenticate", "token": "<jwt>" }
```

as the first client message on the socket.

For public contract purposes:

- `sub` identifies the caller and is required
- `name` is the preferred display name
- implementations MAY also fall back to `preferred_username` or `email`

Servers derive actor identity from the JWT. Clients do not define actor
identity through custom headers, cookies, or self-reported participant fields.

The checked-in demo profile currently accepts unsigned JWTs (`alg: none`) so
the browser demo and smoke tests can run without key management. Real
deployments SHOULD validate signatures and standard JWT claims.

## 5. Workspaces

### 5.1 GET `/apis/v1/namespaces/{namespace}/workspaces`

Returns workspace summaries.

Example:

```json
[
  {
    "id": "payments-debug.acme@shelleymanager",
    "namespace": "acme",
    "name": "payments-debug",
    "status": "running",
    "createdAt": "2026-03-11T12:00:00Z"
  }
]
```

### 5.2 POST `/apis/v1/namespaces/{namespace}/workspaces`

Creates a workspace.

Example request:

```json
{
  "name": "payments-debug",
  "template": "acme-rpm-ig",
  "topics": [
    { "name": "general" },
    { "name": "debug-timeout" }
  ]
}
```

Rules:

- `name` is required
- `template` is optional
- `topics` is optional
- topic names in the create request are pre-created before the workspace is
  returned
- duplicate workspace names return `409 Conflict`

### 5.3 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}`

Returns a workspace record plus topic summaries.

Example:

```json
{
  "id": "payments-debug.acme@shelleymanager",
  "namespace": "acme",
  "name": "payments-debug",
  "status": "running",
  "createdAt": "2026-03-11T12:00:00Z",
  "topics": [
    {
      "name": "general",
      "activeRun": {
        "runId": "r_123",
        "state": "running",
        "interruptible": true,
        "submittedBy": {
          "id": "user_123",
          "displayName": "Alice Example"
        }
      },
      "queuedCount": 2,
      "createdAt": "2026-03-11T12:05:00Z",
      "events": "wss://relay.example.com/apis/v1/namespaces/acme/workspaces/payments-debug/topics/general/events"
    }
  ]
}
```

Implementations MAY include additional workspace metadata. That metadata is not
part of the interoperable base contract unless another RFC standardizes it.

### 5.4 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}`

Deletes a workspace.

Example:

```json
{
  "name": "payments-debug",
  "status": "deleted"
}
```

### 5.5 Workspace Patch

This document does not standardize:

```text
PATCH /apis/v1/namespaces/{namespace}/workspaces/{workspace}
```

Specific deployments may expose patch semantics, but no cross-implementation
shape is committed here.

## 6. Topics

### 6.1 Topic Summary And Topic State

A `TopicSummary` is the compact shape used in workspace detail and topic lists.

Example:

```json
{
  "name": "debug-timeout",
  "activeRun": {
    "runId": "r_123",
    "state": "running",
    "interruptible": true,
    "submittedBy": {
      "id": "user_123",
      "displayName": "Alice Example"
    }
  },
  "queuedCount": 2,
  "createdAt": "2026-03-11T12:05:00Z",
  "events": "wss://relay.example.com/apis/v1/namespaces/acme/workspaces/payments-debug/topics/debug-timeout/events"
}
```

A `TopicState` is the full current state shape used by `GET topic` and by the
topic WebSocket bootstrap.

Example:

```json
{
  "name": "debug-timeout",
  "activeRun": {
    "runId": "r_123",
    "state": "running",
    "interruptible": true,
    "submittedBy": {
      "id": "user_123",
      "displayName": "Alice Example"
    }
  },
  "queue": [
    {
      "runId": "r_124",
      "state": "queued",
      "text": "Search HL7 Jira for precedent.",
      "position": 1,
      "submittedBy": {
        "id": "user_456",
        "displayName": "Bob Example"
      }
    }
  ],
  "createdAt": "2026-03-11T12:05:00Z",
  "events": "wss://relay.example.com/apis/v1/namespaces/acme/workspaces/payments-debug/topics/debug-timeout/events"
}
```

Rules:

- `activeRun` is absent or null when the topic is idle
- `queue` contains future runs only
- `queue` does not include the active run

### 6.2 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics`

Returns topic summaries for the workspace.

### 6.3 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics`

Creates a topic.

Example request:

```json
{ "name": "debug-timeout" }
```

Example response:

```json
{
  "name": "debug-timeout",
  "queuedCount": 0,
  "createdAt": "2026-03-11T12:05:00Z",
  "events": "wss://relay.example.com/apis/v1/namespaces/acme/workspaces/payments-debug/topics/debug-timeout/events"
}
```

Creating an already-active topic returns `409 Conflict`.

### 6.4 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}`

Returns the current `TopicState`.

This is the canonical REST read for current topic runtime state after refresh
or reconnect.

### 6.5 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}`

Archives a topic.

Example:

```json
{
  "name": "debug-timeout",
  "status": "archived"
}
```

If a topic is later recreated with the same name, prior transcript history may
be restored.

## 7. Topic Event Stream

### 7.1 GET `wss://.../apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/events`

This is the live participation channel for a single topic.

The client MUST send `authenticate` as its first message.

Example:

```json
{
  "type": "authenticate",
  "token": "<jwt>"
}
```

On successful authentication, the server sends:

1. `authenticated`
2. `connected`
3. current `topic_state`
4. optional replayed historical events
5. live events

Example authentication acknowledgement:

```json
{
  "type": "authenticated",
  "actor": {
    "id": "user_123",
    "displayName": "Alice Example"
  }
}
```

Example connection acknowledgement:

```json
{
  "type": "connected",
  "topic": "debug-timeout",
  "protocolVersion": "workspace-topic-v1",
  "replay": true
}
```

Rules:

- `topic_state` is the authoritative current topic state
- replayed transcript and lifecycle events are historical only
- replay MUST NOT cause clients to infer that a currently running run is idle
- servers MAY send a fresh `topic_state` whenever the current active run or
  queue changes
- `GET topic` and websocket `topic_state` are two views of the same underlying
  state

### 7.2 Server Message: `topic_state`

`topic_state` is the authoritative machine-state message for current topic
execution and queue state.

Example:

```json
{
  "type": "topic_state",
  "activeRun": {
    "runId": "r_123",
    "state": "running",
    "interruptible": true,
    "submittedBy": {
      "id": "user_123",
      "displayName": "Alice Example"
    }
  },
  "queue": [
    {
      "runId": "r_124",
      "state": "queued",
      "text": "Search HL7 Jira for precedent.",
      "position": 1,
      "submittedBy": {
        "id": "user_456",
        "displayName": "Bob Example"
      }
    }
  ]
}
```

Clients MUST use `topic_state` to understand current execution and queue state.

### 7.3 Client Message: `prompt`

Path:

```text
wss://.../apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/events
```

Example:

```json
{
  "type": "prompt",
  "data": "Please debug the timeout."
}
```

Rules:

- `data` is required
- clients do not send `runId`
- `position: 0` MAY be used to place the new run at the front of the queue
- without `position`, new work appends after any active run and queued work
- the server decides whether the new run begins immediately or is queued

### 7.4 Server Message: `run_updated`

`run_updated` is the authoritative lifecycle event for an individual run.

Example queued run:

```json
{
  "type": "run_updated",
  "runId": "r_124",
  "state": "queued",
  "text": "Please debug the timeout.",
  "position": 1,
  "submittedBy": {
    "id": "user_123",
    "displayName": "Alice Example"
  }
}
```

Example running run:

```json
{
  "type": "run_updated",
  "runId": "r_124",
  "state": "running",
  "submittedBy": {
    "id": "user_123",
    "displayName": "Alice Example"
  }
}
```

Example cancelled run:

```json
{
  "type": "run_updated",
  "runId": "r_124",
  "state": "cancelled",
  "reason": "Wrong approach.",
  "interruptedBy": {
    "id": "user_456",
    "displayName": "Bob Example"
  }
}
```

Rules:

- the first `run_updated` for a submitted prompt is its acceptance into topic
  processing
- the first state for a new run is either `queued` or `running`
- `queued -> running -> terminal` is the normal lifecycle
- queued-run edits and queue-position changes are reflected by later
  `run_updated` events for the same `runId`
- terminal states are `completed`, `cancelled`, and `failed`
- once a run reaches a terminal state, it does not return to a non-terminal
  state
- if `topic_state.activeRun` is present, it MUST refer to the unique run whose
  latest lifecycle state is `running`
- when current queue shape changes, the server SHOULD also send a fresh
  `topic_state`

### 7.5 Server Message: `message`

`message` carries durable transcript events.

Example user message:

```json
{
  "type": "message",
  "runId": "r_124",
  "role": "user",
  "text": "Please debug the timeout.",
  "submittedBy": {
    "id": "user_123",
    "displayName": "Alice Example"
  }
}
```

Example assistant message:

```json
{
  "type": "message",
  "runId": "r_124",
  "role": "assistant",
  "text": "I found the issue..."
}
```

Rules:

- for this profile, transcript message content is plain text
- `message` events may be replayed
- replayed `message` events are history, not current runtime state

### 7.6 Tool And Approval Messages

Tool call:

```json
{
  "type": "tool_call",
  "runId": "r_124",
  "toolCallId": "call_123",
  "title": "workspace_github",
  "tool": "workspace_github",
  "status": "pending"
}
```

Tool update:

```json
{
  "type": "tool_update",
  "runId": "r_124",
  "toolCallId": "call_123",
  "status": "completed",
  "data": "Pull request created"
}
```

Approval request:

```json
{
  "type": "approval_request",
  "runId": "r_124",
  "toolCallId": "call_123",
  "tool": "github",
  "action": "repo.push",
  "data": "{\"repo\":\"acme/demo\",\"branch\":\"fix-timeout\"}",
  "approvers": ["alice@example.com"]
}
```

Client response:

```json
{
  "type": "approval_response",
  "toolCallId": "call_123",
  "approved": true
}
```

Rules:

- tool and approval activity belongs to a run
- approval is keyed by `toolCallId`
- the approving actor is derived from the authenticated connection

### 7.7 Client Message: `inject`

Path:

```text
wss://.../apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/events
```

Example:

```json
{
  "type": "inject",
  "data": "Also check the retry path."
}
```

Server status:

```json
{
  "type": "inject_status",
  "injectId": "inj_123",
  "runId": "r_124",
  "status": "accepted"
}
```

Defined inject status values:

- `accepted`
- `rejected`

Rules:

- inject is valid only when there is an active run
- successful inject appends user input to the active run
- inject does not create a second run

### 7.8 Client Message: `interrupt`

Path:

```text
wss://.../apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/events
```

Example:

```json
{
  "type": "interrupt",
  "reason": "Wrong approach."
}
```

Server acknowledgement:

```json
{
  "type": "interrupt_status",
  "runId": "r_124",
  "status": "accepted"
}
```

Defined interrupt status values:

- `accepted`
- `rejected`

Rules:

- interrupt applies to the active run
- successful interrupt requests are eventually reflected by terminal
  `run_updated` for that run
- terminal run state, not the interrupt acknowledgement, is authoritative

### 7.9 Error Messages

Example:

```json
{ "type": "error", "data": "no active run" }
```

`error` is for protocol-level rejection or failure. It is not the authoritative
representation of current topic state.

## 8. Queue Mutation REST API

Current queue state is available from:

- `GET /apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}`
- websocket `topic_state`

The queue mutation surface operates on queued runs, not on the active run.

### 8.1 PATCH `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/queue/{runId}`

Updates a queued run owned by the caller.

Example request:

```json
{ "data": "Search HL7 Jira for precedent and summarize the result." }
```

Success returns the updated `TopicState`.

### 8.2 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/queue/{runId}`

Deletes a queued run owned by the caller.

Success returns `204 No Content`.

### 8.3 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/queue/{runId}/move`

Moves a queued run owned by the caller.

Example request:

```json
{ "direction": "top" }
```

Defined move directions:

- `up`
- `down`
- `top`
- `bottom`

Success returns the updated `TopicState`.

### 8.4 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/queue:clear-mine`

Clears queued runs owned by the caller.

Example response:

```json
{
  "removed": ["r_121", "r_122"]
}
```

Queue mutation rules:

- only the submitting participant may update, move, or delete a queued run
- only queued runs may be mutated through this API
- `404 Not Found` means the topic or run does not exist
- `403 Forbidden` means the caller does not own that queued run
- `409 Conflict` means the run is no longer queued or movable

## 9. Inject And Interrupt REST API

### 9.1 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/inject`

Injects a user message into the active run.

Example request:

```json
{ "data": "Also check the retry path." }
```

Example success:

```json
{
  "runId": "r_124",
  "status": "accepted"
}
```

If no run is active, the endpoint returns `409 Conflict`.

### 9.2 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/topics/{topic}/interrupt`

Requests interruption of the active run.

Example request:

```json
{ "reason": "Wrong approach." }
```

Example success:

```json
{
  "runId": "r_124",
  "status": "accepted"
}
```

If no run is active, the endpoint returns `409 Conflict`.

## 10. Tools

### 10.1 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools`

Returns the tools enabled for the workspace.

Example:

```json
[
  {
    "kind": "local",
    "name": "fhir-validator",
    "description": "Validate FHIR artifacts"
  },
  {
    "kind": "mcp",
    "name": "github",
    "description": "GitHub repository operations"
  }
]
```

This is the public tool inventory surface.

This document does not define how local runtime tools are selected or managed.
It commits only to their appearance in the inventory when they are enabled.

### 10.2 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools`

Registers a managed MCP tool.

Example request:

```json
{
  "name": "github",
  "description": "GitHub repository operations",
  "provider": "alice@example.com",
  "protocol": "mcp",
  "transport": {
    "type": "streamable_http",
    "url": "https://github-mcp.example.com",
    "headers": {
      "Authorization": "Bearer secret"
    }
  }
}
```

Rules:

- `name` is required
- `protocol` defaults to `mcp`
- `transport` is required
- for MCP, clients ordinarily omit a `tools` array
- when omitted, the server may discover callable actions through MCP discovery

### 10.3 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools/{tool}`

Returns a managed tool resource.

### 10.4 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools/{tool}`

Disconnects a managed tool from the workspace.

### 10.5 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools/{tool}/grants`

Adds a grant for a managed tool.

Example request:

```json
{
  "subject": "agent:*",
  "tools": ["repo.read"],
  "access": "approval_required",
  "approvers": ["alice@example.com"],
  "scope": { "repo": "acme/demo" }
}
```

Defined access values:

- `allowed`
- `approval_required`
- `denied`

### 10.6 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/tools/{tool}/grants/{grantId}`

Removes a grant.

Approval outcomes are visible both on the topic event stream and in the managed
tool log.

## 11. File API

The current Shelley-backed profile exposes a provisional workspace file surface
at:

```text
/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files
/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/content
/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/directories
/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/move
```

This profile is part of the current API surface, but it is not yet considered
as settled as the workspace, topic, and run model.

All file paths are workspace-relative. Absolute paths, backslashes, and
traversal segments such as `..` are invalid.

### 11.1 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files?path={relative-path}`

Returns JSON metadata for the addressed file or directory. Directory responses
also include their direct child entries.

### 11.2 GET `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/content?path={relative-path}`

Reads the addressed file and returns raw file content.

### 11.3 PUT `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/content?path={relative-path}`

Writes raw request content to the addressed file path.

### 11.4 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/directories?path={relative-path}`

Creates a directory.

### 11.5 POST `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files/move`

Moves or renames a file or directory.

Example request:

```json
{
  "from": "docs/note.txt",
  "to": "docs/archive/note.txt"
}
```

### 11.6 DELETE `/apis/v1/namespaces/{namespace}/workspaces/{workspace}/files?path={relative-path}[&recursive=true]`

Deletes the addressed file or directory.

## 12. Namespace Event Stream

### 12.1 GET `wss://.../apis/v1/namespaces/{namespace}/events`

This is the namespace-scoped lifecycle stream.

Example connection acknowledgement:

```json
{
  "type": "connected",
  "protocolVersion": "workspace-manager-v1",
  "namespace": "acme",
  "replay": true
}
```

After authentication and connection acknowledgement, the server replays current
workspaces as `workspace_created` events.

### 12.2 Event Types

Workspace created:

```json
{
  "type": "workspace_created",
  "workspace": {
    "name": "payments-debug",
    "status": "running",
    "createdAt": "2026-03-11T12:00:00Z",
    "topics": [
      { "name": "general" },
      { "name": "debug-timeout" }
    ]
  }
}
```

Workspace deleted:

```json
{
  "type": "workspace_deleted",
  "workspace": {
    "name": "payments-debug"
  }
}
```

Topic created:

```json
{
  "type": "topic_created",
  "workspace": "payments-debug",
  "topic": {
    "name": "debug-timeout"
  }
}
```

Topic deleted:

```json
{
  "type": "topic_deleted",
  "workspace": "payments-debug",
  "topic": {
    "name": "debug-timeout"
  }
}
```

This stream is read-only. The protocol does not yet define event-id resume.

## 13. Explicitly Not Part Of The Contract

This document does not commit to:

- route aliases such as `/acp/...` or `/workspaces/...`
- internal runtime `/ws/...` routes
- client-supplied run IDs or inject IDs
- client-supplied participant IDs in custom headers or cookies
- JSON-RPC over the topic WebSocket
- a standalone approval resource
- manager-local tool selection or provisioning APIs
- internal host-to-runtime transport details
- deployment topology or process boundaries
- suspend, resume, clone, commit, snapshot, or rollback APIs
- operational endpoints such as `/health`
