# RFC 0003: Workspace Tool API Payloads

- Status: proposed
- Date: 2026-03-10

## Summary

This RFC settles the demo-ready hosted tool API.

It defines:
- exact payloads for `POST /tools`, `GET /tools`, and `GET /tools/{tool}`
- exact payloads for grant creation
- the canonical MCP transport shapes for `stdio` and `streamable_http`
- how hosted workspace registration relates to native MCP tool definitions

For the demo, the hosted workspace tool API is the source of truth. Remote MCP
tool discovery is explicitly out of scope.

## Design Principle

The workspace host owns:
- tool registration
- transport configuration
- credential binding
- grants and approval policy

But the capability surface exposed by an MCP-backed tool should reuse MCP's own
tool definition shape rather than inventing a parallel schema.

So:
- hosted workspace API fields are ours
- the nested MCP `tools` payload should use MCP tool objects directly
- the hosted `tools` payload is the authoritative workspace contract and does
  not require automatic validation against or mirroring from the remote MCP
  server at registration time

For the demo contract, "MCP tool object" means the MCP server tools shape from
the current MCP tools spec, including:
- `name`
- optional `title`
- optional `description`
- `inputSchema`
- optional `outputSchema`
- optional `annotations`

The current MCP spec also allows fields like `icons`, but those are explicitly
out of scope for the demo contract.

## Resource Model

For the demo contract, one workspace tool resource is one connected tool
binding.

Canonical identity:
- `name` is the tool identifier within one workspace

The contract does not introduce a separate opaque `toolId` yet.

## Routes

```text
GET    /tools
POST   /tools
GET    /tools/{tool}
DELETE /tools/{tool}
POST   /tools/{tool}/grants
DELETE /tools/{tool}/grants/{grantId}
```

These routes are relative to the workspace runtime base.

The public API is a workspace contract. An implementation may satisfy that
contract by:

- executing the registered transport directly inside the workspace runtime
- brokering tool execution through a privileged manager while keeping the public
  transport shape stable

The client-visible payloads do not change between those implementation choices.

## Tool Create Request

`POST /tools` must accept:

```json
{
  "name": "github",
  "description": "GitHub repository operations",
  "provider": "alice@acme.com",
  "protocol": "mcp",
  "transport": {
    "type": "streamable_http",
    "url": "https://github-mcp.example.com",
    "headers": {}
  },
  "tools": [
    {
      "name": "repo.read",
      "title": "Read Repository",
      "description": "Read repository metadata and files",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": { "type": "string" },
          "path": { "type": "string" }
        },
        "required": ["repo"],
        "additionalProperties": false
      }
    },
    {
      "name": "pr.create",
      "title": "Create Pull Request",
      "description": "Create a pull request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": { "type": "string" },
          "title": { "type": "string" }
        },
        "required": ["repo", "title"],
        "additionalProperties": false
      }
    }
  ]
}
```

Required fields:
- `name`
- `protocol`
- `transport`

Optional fields:
- `tools`

For the demo:
- `protocol` must be `"mcp"`
- `tools`, when provided, must be an array of MCP tool definition objects
- when `tools` is omitted, tool capabilities are discovered at runtime via the
  MCP transport (the MCP server's `tools/list` is the source of truth)

### MCP tool object shape

Each entry in `tools` should use the MCP tool definition shape directly.

For the demo, supported fields are:
- `name`
- `title`
- `description`
- `inputSchema`
- optional `outputSchema`
- optional `annotations`

Example:

```json
{
  "name": "repo.read",
  "title": "Read Repository",
  "description": "Read repository metadata and files",
  "inputSchema": {
    "type": "object",
    "properties": {
      "repo": { "type": "string" }
    },
    "required": ["repo"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object"
  },
  "annotations": {
    "readOnlyHint": true
  }
}
```

Rules:
- `tools[].name` is required
- `tools[].inputSchema` is required and must be a JSON Schema object
- if `tools[].inputSchema` omits `$schema`, it is interpreted using MCP's
  current default JSON Schema dialect
- additional MCP-defined optional fields may be preserved even if not used by
  the initial demo UI

### Optional hosted fields

Optional create fields:

```json
{
  "credentialRef": "secret://github/alice",
  "config": {}
}
```

Meaning:
- `credentialRef` is an opaque reference for runtime-specific secret lookup
- `config` is an escape hatch for provider-specific non-transport options

The canonical transport definition still lives under `transport`.

Write semantics:
- `POST /tools` accepts the full transport object, including concrete `env` and
  `headers` values

Read semantics:
- `POST /tools` responses and subsequent `GET /tools*` responses must return a
  redacted read model for sensitive transport fields
- `transport.env` and `transport.headers` keep their keys but must not expose
  original values
- implementations may preserve non-sensitive transport fields like `command`,
  `args`, `cwd`, `type`, and `url`

## Transport Union

### MCP stdio

```json
{
  "type": "stdio",
  "command": "uvx",
  "args": ["mcp-server-github"],
  "env": {
    "GITHUB_TOKEN": "${secret://github/alice}"
  }
}
```

Required:
- `type`
- `command`

Optional:
- `args`
- `env`
- `cwd`

The registered transport describes the workspace-visible binding. An
implementation may execute it inside the workspace runtime or may broker it
through a manager. In both cases:

- `cwd`, when relative, resolves from the workspace root
- absolute runtime paths such as `/tools/...` are interpreted relative to the
  workspace runtime filesystem contract
- secret-bearing environment values must not be exposed back to workspace
  clients through tool read responses

Demo-proven example:

```json
{
  "type": "stdio",
  "command": "bun",
  "args": ["/tools/hl7-jira-support/bin/hl7-jira-mcp.js"],
  "cwd": "/tools/hl7-jira-support",
  "env": {
    "HL7_JIRA_DB": "/tools/hl7-jira-support/data/jira-data.db"
  }
}
```

This shape is useful both for workspace-local MCP fixtures and for
manager-brokered MCP servers that rely on manager-published support bundles.

Demo-proven HL7 Jira registration (transport-only, tools discovered via MCP):

```json
{
  "name": "hl7-jira",
  "description": "Search and inspect issues from the real HL7 Jira SQLite snapshot",
  "protocol": "mcp",
  "transport": {
    "type": "stdio",
    "command": "bun",
    "args": ["/tools/hl7-jira-support/bin/hl7-jira-mcp.js"],
    "cwd": "/tools/hl7-jira-support",
    "env": {
      "HL7_JIRA_DB": "/tools/hl7-jira-support/data/jira-data.db"
    }
  }
}
```

With a wildcard grant:

```json
{
  "subject": "agent:*",
  "tools": ["*"],
  "access": "allowed"
}
```

### MCP streamable HTTP

```json
{
  "type": "streamable_http",
  "url": "https://github-mcp.example.com",
  "headers": {
    "Authorization": "Bearer ${secret://github/alice}"
  }
}
```

Required:
- `type`
- `url`

Optional:
- `headers`

The demo contract supports exactly these two MCP transport types.

## Tool Response Shape

`POST /tools` returns the same read shape as `GET /tools/{tool}`.

Important:
- create requests are write-capable and may include concrete `env` or `headers`
  values
- read responses are redacted and must not echo those values back

### Summary shape

`GET /tools` returns a list of summary objects:

```json
[
  {
    "name": "github",
    "description": "GitHub repository operations",
    "provider": "alice@acme.com",
    "protocol": "mcp",
    "transport": {
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": { "redacted": true }
      }
    },
    "tools": [
      {
        "name": "repo.read",
        "title": "Read Repository",
        "description": "Read repository metadata and files",
        "inputSchema": {
          "type": "object"
        }
      },
      {
        "name": "pr.create",
        "title": "Create Pull Request",
        "description": "Create a pull request",
        "inputSchema": {
          "type": "object"
        }
      }
    ],
    "status": "ready",
    "createdAt": "2026-03-10T12:00:00Z"
  }
]
```

### Detail shape

`GET /tools/{tool}` returns the full tool object:

```json
{
  "name": "github",
  "description": "GitHub repository operations",
  "provider": "alice@acme.com",
  "protocol": "mcp",
  "transport": {
    "type": "stdio",
    "command": "uvx",
    "args": ["mcp-server-github"],
    "env": {
      "GITHUB_TOKEN": { "redacted": true }
    }
  },
  "tools": [
    {
      "name": "repo.read",
      "title": "Read Repository",
      "description": "Read repository metadata and files",
      "inputSchema": {
        "type": "object"
      },
      "outputSchema": {
        "type": "object"
      },
      "annotations": {
        "readOnlyHint": true
      }
    }
  ],
  "credentialRef": "secret://github/alice",
  "config": {},
  "status": "ready",
  "createdAt": "2026-03-10T12:00:00Z",
  "grants": [
    {
      "grantId": "g_123",
      "subject": "agent:*",
      "tools": ["repo.read"],
      "access": "allowed",
      "approvers": [],
      "scope": {}
    }
  ],
  "log": []
}
```

Rules:
- responses preserve the hosted fields plus the nested MCP tool definitions
- `status` for the demo may be:
  - `ready`
  - `unreachable`
  - `error`

## Grant Create Request

`POST /tools/{tool}/grants` accepts:

```json
{
  "subject": "agent:*",
  "tools": ["repo.read"],
  "access": "allowed",
  "approvers": [],
  "scope": {}
}
```

Rules:
- `subject` is required
- `tools` must be a non-empty array of tool names — either a subset of the
  registered nested MCP tool names, or `["*"]` to grant access to all tools
  exposed by the MCP server (useful when `tools` was omitted at registration)
- `access` must be one of:
  - `allowed`
  - `approval_required`
- if `access` is `approval_required`, `approvers` must be non-empty

Response shape:

```json
{
  "grantId": "g_123",
  "subject": "agent:*",
  "tools": ["repo.read"],
  "access": "allowed",
  "approvers": [],
  "scope": {},
  "createdAt": "2026-03-10T12:01:00Z"
}
```

`POST /tools/{tool}/grants` returns that grant object directly.

## Demo Guarantees

This RFC defines the demo guarantee as:
- hosted REST registration is canonical
- MCP `stdio` and `streamable_http` are the supported execution transports
- nested MCP tool definitions are represented using MCP-native schema fields
- grants and approval policy are configured through the hosted API

## Non-Goals For This Contract

Explicitly deferred:
- registry sync or remote tool mirroring (though `tools` omission enables
  runtime MCP discovery)
- opaque `toolId` separate from `name`
- secret-management standardization beyond opaque `credentialRef` and transport
  placeholders
