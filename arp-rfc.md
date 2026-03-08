# Agent Relay Protocol (ARP)
## RFC Draft — Switching Fabric and Workspace Infrastructure for Agent Meshes

**Status:** Draft  
**Intended Status:** Informational  
**Date:** March 2026  
**Working Group:** Agent-Relay-Protocol / itbaron-draft  
**Author:** Aleksei Kudriashov <akud.soft@gmail.com>

---

## Abstract

This document specifies the Agent Relay Protocol (ARP), a switching fabric and workspace infrastructure for autonomous agent meshes. ARP defines how agents, humans, and client bridges connect to Workspaces; how Rooms relay messages between participants; how a Control Plane manages topology, workspace lifecycle, and routing state; and how inter-Room communication enables multi-hop meshes.

ARP operates at the **communication and infrastructure layer** — below the semantics of agent collaboration (A2A) and above the mechanics of tool access (MCP) and editor integration (ACP). It provides the managed topology, workspace lifecycle, and message routing that these protocols do not address.

ARP is to agent meshes what a telephone switching network is to voice communication: a universal, topology-agnostic fabric that routes messages between participants without knowledge of their content.

---

## Status of This Memo

This document is a working draft for discussion within the Agent Relay Protocol project. It describes a proposed architecture and protocol surface for agent meshes and should not yet be treated as a stable standard.

Sections listed in [13. Open Questions](#13-open-questions) are intentionally unresolved and remain part of the draft scope.

## Copyright Notice

Copyright (c) 2026 Aleksei Kudriashov <akud.soft@gmail.com>

---

## 1. Problem Statement

AI agents increasingly operate in multi-agent, multi-human systems. Several protocols have emerged to address different layers of the agentic stack, most now maturing under open governance. However, none define a **switching fabric** — a managed infrastructure where agents and humans are organized into workspaces, connected by routable topology, with lifecycle management, audit, and multi-client access.

### 1.1 Protocol Landscape (March 2026)

| Protocol | Governed By | Scope | What It Solves |
|---|---|---|---|
| **MCP** (Model Context Protocol) | AAIF / Linux Foundation (Anthropic, Nov 2024) | Agent ↔ Tools/Data | Standardized access to external tools, data sources, and resources via JSON-RPC. 10,000+ published servers, 97M+ monthly SDK downloads. |
| **ACP** (Agent Client Protocol) | Zed Industries + JetBrains | Editor ↔ Agent | Editor-to-coding-agent communication via JSON-RPC over stdio. Analogous to LSP for AI agents. Session management, streaming, file system access, terminal operations. |
| **A2A** (Agent2Agent Protocol) | Linux Foundation (Google, Apr 2025; v0.3 Jul 2025) | Agent ↔ Agent | Peer-to-peer agent collaboration via HTTP/SSE/JSON-RPC/gRPC. Agent Cards for capability discovery, task lifecycle, multimodal negotiation. 150+ supporting organizations. |
| **AGENTS.md** | AAIF / Linux Foundation (OpenAI, Aug 2025) | Agent ↔ Repository | Project-specific instructions for coding agents. 60,000+ open-source projects. |

### 1.2 The Gap

None of these protocols address:

- **Managed topology** — how agents are grouped into workspaces with shared environments, routed across Rooms, connected via a control plane
- **Multi-client access** — how the same workspace is accessed simultaneously from a terminal, a messaging app, and an IDE
- **Workspace lifecycle** — how a collaborative unit (code + agent + humans) is created, suspended, resumed, and audited
- **Multi-hop relay** — how a message traverses multiple Rooms without hardcoded addressing
- **Broadcast and fan-out** — how an agent's response reaches all human participants in a workspace

MCP connects agents to tools. ACP connects editors to agents. A2A enables agent-to-agent collaboration. **ARP provides the infrastructure mesh beneath all of them.**

### 1.3 Position in the Agentic Stack

```
┌─────────────────────────────────────────────────┐
│  Application Layer                              │
│  (Agent business logic, task orchestration)      │
├─────────────────────────────────────────────────┤
│  A2A — Agent-to-agent collaboration             │
│  (Task lifecycle, Agent Cards, negotiation)      │
├─────────────────────────────────────────────────┤
│  ARP — Switching Fabric + Workspaces            │
│  (Rooms, routing, lifecycle, audit)  ◄── THIS   │
├─────────────────────────────────────────────────┤
│  ASP — ARP Session Protocol                     │
│  (JSON-RPC sessions, envelopes, heartbeat)       │
├─────────────────────────────────────────────────┤
│  Transport (gRPC / WebSocket / TCP)             │
├─────────────────────────────────────────────────┤
│  MCP — Tool & Data Access    (orthogonal)       │
│  ACP — Editor Integration    (orthogonal)       │
└─────────────────────────────────────────────────┘
```

---

## 2. Core Concepts

### 2.1 Agent

An autonomous process that connects to a Room via an ASP session. Agents do not know mesh topology — they know only their local Room. An agent is addressed by logical name within the mesh; resolution is handled by the Room and Control Plane.

An agent is instantiated with a **harness** — a configuration bundle specifying the model, provider, tools, skills, and behavioral constraints. The harness is opaque to the protocol; ARP treats it as metadata stored in the Control Plane and passed to the Runtime Lifecycle Manager at spawn time.

Agents may independently maintain MCP connections to tool servers and A2A connections for peer collaboration. ARP is concerned only with routing, not with what agents do with the messages they receive.

### 2.2 Room

A Room is a process or pod that acts as a **switching node** in the mesh. It is the fundamental routing unit of the ARP fabric. A Room:

- Accepts ASP connections from agents, humans, client bridges, and peer Rooms
- Maintains a local routing table pushed by the Control Plane
- Forwards messages to local participants or to peer Rooms
- Broadcasts messages within a workspace according to fan-out rules
- Persists messages to an append-only audit log
- Is itself an ASP participant — it can join other Rooms as a peer

This last property is the key architectural insight: **Room-to-Room communication uses the same ASP protocol as any other participant connection**. There is no separate inter-Room protocol. A Room joins another Room exactly as an external agent would, enabling recursive composition.

### 2.3 Workspace

A Workspace is the primary user-facing abstraction in ARP. It is a **managed collaboration unit** that bundles:

- **A Room** — the underlying switching node
- **An Environment** — filesystem, cloned repositories, runtime
- **Agents** — one or more, each with a harness and model configuration
- **Members** — humans with roles (owner, admin, member) and permissions
- **Channels** — bindings to external systems (Telegram threads, Slack channels, etc.) via client bridges
- **Audit log** — append-only record of all messages, approvals, and operations

A Workspace has a hierarchical identifier: `{namespace}/{name}` (e.g., `myns/myproject`). Workspaces are managed by the Control Plane and have a defined lifecycle: `creating → running → suspended → running → terminated`.

The relationship between Workspace and Room: a Workspace always has exactly one Room. The Room handles switching; the Workspace provides identity, state, and lifecycle. Multiple Workspaces may run on the same physical infrastructure but their Rooms are logically isolated.

### 2.4 Client Bridge

A Client Bridge is an ASP participant that translates between an external protocol and ASP. From the Room's perspective, a bridge is just another participant — the Room does not know or care that it is backed by Telegram, Slack, or any other system.

Examples:

| Bridge | External Protocol | ASP Role |
|---|---|---|
| Telegram Bridge | Telegram Bot API (thread-bound) | `bridge` |
| Slack Bridge | Slack Events API (channel-bound) | `bridge` |
| CLI Client | Native ASP over WebSocket | `human` (direct, no bridge needed) |
| IDE / File Mount | FUSE + ASP sidecar | `bridge` |

A bridge registers with the Room using role `bridge` and declares metadata about the external channel it represents. Messages flowing through a bridge carry the original author's identity, not the bridge's.

### 2.5 Control Plane

The Control Plane is a Raft-replicated cluster responsible for:

- **Workspace lifecycle** — create, suspend, resume, terminate workspaces
- **Topology management** — tracking all Rooms, agents, bridges, and inter-Room links
- **Routing state distribution** — pushing routing tables to Rooms via xDS-style streaming
- **Agent lifecycle** — managing spawn/terminate via the Runtime Lifecycle Manager
- **Membership and authorization** — enforcing who can join, approve, or administer a workspace
- **Cluster federation** — managing inter-cluster links for mesh-of-meshes

The Control Plane is **not** in the data path. It configures routing state, but message forwarding happens directly between Rooms. If the Control Plane becomes temporarily unavailable, Rooms continue forwarding using their last known routing state — providing **fault tolerance by design**.

### 2.6 Runtime Lifecycle Manager (RLM)

An abstraction over execution environments (Kubernetes, native-fork, serverless, etc.) that the Control Plane uses to:

- Spawn and terminate agents (with harness configuration)
- Provision and destroy environments (filesystem, repo clone)
- Suspend and resume environment state

The RLM is pluggable — the protocol is agnostic to the underlying runtime. The RLM connects to Rooms as an ASP participant with role `rlm`.

---

## 3. Architecture

### 3.1 Layered Model

ARP defines three planes:

| Plane | Components | Analogy |
|---|---|---|
| **Orchestration Plane** | Control Plane (Raft) | k8s API Server + etcd |
| **Switching Fabric** | Rooms + ASP relay + Bridges | kube-proxy + CNI |
| **Runtime Plane** | RLM (k8s, fork, etc.) + Environments | kubelet + container runtime |

### 3.2 Workspace Topology (Single Workspace)

A typical workspace with CLI, Telegram, and a single agent:

```
                    [Control Plane]
                         |
                   manage lifecycle
                         |
  [CLI] ── ASP ──→ [  Room  ] ←── ASP ── [Agent: claude]
                      ↑    ↑
                     ASP   ASP
                      |     |
          [Telegram Bridge] [File Mount Bridge]
                  |                  |
          [Telegram Bot API]    [FUSE → ~/relay/ns/proj]
```

All five connections (CLI, Agent, Telegram Bridge, File Mount Bridge, Control Plane) are ASP sessions. The Room treats them uniformly. When the agent writes a message, the Room fans it out to CLI and both bridges. When a human types in the Telegram thread, the bridge forwards it as an ASP message attributed to that human.

### 3.3 Multi-Room Topology

Across multiple workspaces and Rooms, the mesh topology is a **configuration**, not code. The Control Plane defines which Rooms connect to which. Any topology can be expressed: hub-and-spoke, tree, ring, full mesh, or hierarchical.

```
[Control Plane (Raft cluster)]
         |
   push routing tables
         |
   +------+------+
   |             |
[Room A]      [Room B]
  ws: myns/    ws: myns/
  myproject    infra
  |    \      /    |
[ag1] [ag2]-[ag3] [ag4]
```

### 3.4 Routing Table Distribution (xDS Model)

When an agent is spawned in Room B, the Control Plane:

1. Updates global state (Raft-committed)
2. Streams routing table update to all affected Rooms via persistent gRPC/WebSocket
3. Rooms update their local forwarding table atomically

Rooms forward messages autonomously using their local table. If the Control Plane becomes temporarily unavailable, Rooms continue forwarding with their last known state.

---

## 4. ARP Session Protocol (ASP)

### 4.1 Design Principles

ASP is ARP's native session protocol. It is a bidirectional JSON-RPC 2.0 protocol that runs over gRPC, WebSocket, or raw TCP. ASP is purpose-built for Room-based switching with:

- **Connection initialization** with capability negotiation
- **Session multiplexing** — multiple logical sessions over one connection
- **Envelope-based messaging** with source/destination addressing
- **Broadcast and fan-out** — addressing groups of participants by role
- **Streaming notifications** for routing table updates and session events
- **Heartbeat and liveness** detection

ASP borrows design principles from ACP (JSON-RPC 2.0, capability negotiation, streaming updates) and A2A (HTTP/gRPC transport, structured task messages), but is purpose-built for relay semantics. Neither ACP nor A2A support multi-hop forwarding, routing tables, or Room-based switching.

### 4.2 Connection Lifecycle

```
Participant                          Room
    |                                  |
    |─── asp/initialize ─────────────→|
    |    { protocolVersion,            |
    |      role,                       |
    |      participantInfo,            |
    |      capabilities,               |
    |      workspace }                 |
    |                                  |
    |←── InitializeResponse ──────────|
    |    { roomInfo,                   |
    |      capabilities,               |
    |      members,                    |
    |      routingSnapshot }           |
    |                                  |
    |─── asp/ready ──────────────────→|
    |                                  |
    |⇐⇒  Bidirectional messaging  ⇐⇒ |
```

The `role` field indicates participant type:

| Role | Description |
|---|---|
| `agent` | Autonomous AI agent |
| `human` | Human user (direct CLI/WebSocket connection) |
| `bridge` | Client bridge translating an external protocol |
| `room` | Peer Room (inter-Room link) |
| `rlm` | Runtime Lifecycle Manager |

Rooms treat all roles uniformly for message forwarding. The role is metadata for fan-out rules, observability, and authorization policy — not routing.

### 4.3 Message Envelope

All messages routed through ARP use a common envelope:

```json
{
  "jsonrpc": "2.0",
  "method": "asp/message",
  "params": {
    "id": "msg-uuid-001",
    "from": "itbaron",
    "to": "claude",
    "workspace": "myns/myproject",
    "type": "text",
    "ttl": 8,
    "payload": {
      "text": "add zod schemas for all endpoints"
    }
  }
}
```

Fields:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique message identifier (UUID) |
| `from` | yes | Sender identity (agent name, human username, bridge ID) |
| `to` | yes | Destination: agent name, `*` for broadcast, `role:human` for role-based fan-out |
| `workspace` | yes | Workspace identifier (`namespace/name`) |
| `type` | yes | Message type (see §4.4) |
| `ttl` | yes | Time-to-live, decremented at each Room hop. Dropped at 0. |
| `payload` | yes | Opaque to ARP. Application-level content. |

### 4.4 Message Types

| Type | Direction | Description |
|---|---|---|
| `text` | any → any | Plain text or markdown message |
| `tool_call` | agent → room | Agent proposes a tool operation (fs.write, shell.execute, git.commit, etc.) |
| `tool_result` | any → any | Result of an executed tool call |
| `approval_request` | agent → role:human | Request for human approval with risk level and action description |
| `approval_response` | human → agent | Approve or deny, with approver identity |
| `session_event` | room → all | Participant joined, left, or changed status |
| `routing_update` | cp → room | Routing table push (Control Plane to Room only) |

The `payload` field carries type-specific content. ARP routes all types identically — the type field exists for client rendering and policy enforcement, not for routing decisions.

### 4.5 Broadcast and Fan-out

A Room implements the following fan-out rules:

- **`to: "agent-name"`** — deliver to the named participant (local or forward to peer Room via routing table)
- **`to: "*"`** — deliver to all participants in the workspace
- **`to: "role:human"`** — deliver to all participants with role `human` or `bridge` (bridges represent human channels)
- **`to: "role:agent"`** — deliver to all participants with role `agent`

Default behavior: when an agent sends a `text` message without an explicit `to`, the Room defaults to `role:human` — the message fans out to all human participants and bridges. This is how a single agent response appears in both CLI and Telegram simultaneously.

When a human sends a message, the Room delivers it to all agents in the workspace. This enables multi-agent workspaces where multiple agents observe the conversation.

### 4.6 Approval Flow

Tool operations follow a structured approval flow routed through the Room:

```
Agent                    Room                    Humans
  |                        |                        |
  |─ approval_request ───→|                        |
  |  { action: "shell",   |─ fan-out to ──────────→|
  |    command: "bun test",|  role:human             |
  |    risk: "low" }       |                        |
  |                        |                        |
  |                        |←── approval_response ──|
  |                        |    { approved: true,    |
  |←── approval_response ──|      approver: "itbaron" }
  |    (routed back)       |                        |
  |                        |                        |
  |─ tool_result ────────→|─ fan-out to ──────────→|
  |  { status: "success" } |  role:human             |
```

The Room enforces workspace-level approval policy:

- **Who can approve** — based on member roles (owner, admin)
- **What requires approval** — based on risk classification
- **How many approvals** — single approver or quorum (configurable per workspace)

The approval policy is workspace metadata managed by the Control Plane. The Room enforces it; the agent proposes operations without knowledge of the policy.

---

## 5. Workspace Lifecycle

### 5.1 State Machine

```
           create
    ┌────────────────┐
    │                ▼
    │           ┌─────────┐
    │           │ Creating │
    │           └────┬─────┘
    │                │ environment ready, agent connected
    │                ▼
    │           ┌─────────┐   suspend    ┌───────────┐
    │           │ Running  │────────────→│ Suspended  │
    │           └────┬─────┘             └─────┬──────┘
    │                │                   resume│
    │                │         ┌───────────────┘
    │                │         ▼
    │                │    ┌─────────┐
    │                │    │ Running  │
    │                │    └────┬─────┘
    │                │         │
    │           terminate      │ terminate
    │                │         │
    │                ▼         ▼
    │           ┌──────────────────┐
    └──────────│   Terminated     │
               └──────────────────┘
```

### 5.2 Create

```bash
$ relay workspace create myns/myproject \
    -h claude -m opus-4.5 \
    -u me \
    -r github.com/myorg/myproject
```

The Control Plane:

1. Allocates workspace identity `myns/myproject`
2. Instructs the RLM to provision an environment (clone repo, install dependencies)
3. Spawns a Room for the workspace
4. Instructs the RLM to spawn the agent with the specified harness and model
5. Registers the creator as `owner`
6. Updates routing tables

### 5.3 Suspend and Resume

Suspending a workspace preserves the environment state (filesystem, agent context) but releases compute resources. The Room is terminated, the agent process is stopped, but the environment snapshot and audit log persist in the Control Plane.

Resuming restores the environment, spawns a new Room, reconnects the agent (which may reload context from the audit log), and re-establishes channel bindings.

### 5.4 Channels

A workspace can have multiple channel bindings, each backed by a client bridge:

```bash
$ relay workspace myns/myproject connect \
    -p telegram -b mybot -t myproject-thread
```

The Control Plane:

1. Registers the channel binding (Telegram bot `mybot`, thread `myproject-thread`)
2. Spawns or configures a Telegram Bridge process
3. The bridge opens an ASP session to the workspace's Room
4. Messages in the Telegram thread flow bidirectionally through the bridge

A workspace can have multiple channels simultaneously. Each channel binding maps a specific external resource (thread, channel, room) to the workspace. The binding is 1:1 — one external thread maps to exactly one workspace.

---

## 6. Control Plane State Model

The Control Plane maintains the following state (Raft-replicated):

```yaml
cluster:
  name: health-samurai
  endpoint: relay.health-samurai.io

workspaces:
  myns/myproject:
    status: running
    room: room-7a3f
    environment:
      repo: github.com/myorg/myproject
      path: /workspace
      status: ready
    agents:
      claude:
        harness: claude
        model: opus-4.5
        status: active
        capabilities: [code, test, deploy]
    members:
      itbaron:
        role: owner
        joined: "2026-03-08T14:00:00Z"
      it-baron:
        role: admin
        joined: "2026-03-08T14:10:00Z"
    channels:
      telegram:
        bridge: telegram-bridge-01
        bot: mybot
        thread: myproject-thread
        status: connected
    approval_policy:
      risk_low: auto
      risk_medium: any_admin
      risk_high: any_admin
      risk_critical: owner

rooms:
  room-7a3f:
    endpoint: "10.0.0.1:7000"
    workspace: myns/myproject
    status: healthy
    participants:
      - { name: claude, role: agent }
      - { name: itbaron, role: human }
      - { name: it-baron, role: human, via: telegram }
      - { name: telegram-bridge-01, role: bridge }

routes:
  room-7a3f:
    claude: local
    itbaron: local
    it-baron: local (via telegram-bridge-01)

links: {}
```

For multi-workspace meshes, the state extends with inter-Room links and cross-workspace routing:

```yaml
rooms:
  room-7a3f:
    workspace: myns/myproject
  room-9b2c:
    workspace: myns/infra

links:
  room-7a3f <-> room-9b2c:
    status: established

routes:
  room-7a3f:
    claude: local
    infra-agent: via room-9b2c
  room-9b2c:
    infra-agent: local
    claude: via room-7a3f
```

---

## 7. Agent Addressing

Agents and participants are addressed by logical name. Resolution is handled by the Room using its local routing table.

### 7.1 Addressing Schemes

| Form | Example | Usage |
|---|---|---|
| **Simple** | `claude` | Resolved by local Room, forwarded if not local |
| **Workspace-qualified** | `myns/infra/infra-agent` | Route to a specific agent in a specific workspace |
| **Role-based** | `role:human` | Fan-out to all participants matching the role |
| **Broadcast** | `*` | Fan-out to all participants in the workspace |

Agents always use the simple form. Workspace-qualified addressing is used by infrastructure components and for cross-workspace communication. Role-based and broadcast addressing are used for fan-out within a workspace.

Simple names are valid only when they are unique within the routing domain. If the Control Plane detects a collision, Rooms must require the workspace-qualified form for deterministic delivery.

### 7.2 Cross-Workspace Addressing

When agent `claude` in `myns/myproject` needs to reach `infra-agent` in `myns/infra`:

1. Claude sends: `{ to: "infra-agent", payload: ... }`
2. Room A looks up routing table: `infra-agent → via room-9b2c`
3. Room A forwards via its ASP session with Room B
4. Room B delivers locally to `infra-agent`

The agent does not need to know the workspace-qualified form. The Control Plane pre-provisions the routing table so that simple names resolve across Room boundaries when inter-workspace links are configured.

---

## 8. Audit Log

Every Room writes messages to an append-only audit log persisted by the Control Plane. The log captures:

| Field | Description |
|---|---|
| `timestamp` | Message receipt time |
| `workspace` | Workspace identifier |
| `from` | Sender identity |
| `to` | Destination (including fan-out targets) |
| `type` | Message type |
| `payload_hash` | Hash of payload (or full payload, configurable) |
| `approval` | Approver identity and decision, if applicable |

The log is queryable via the Control Plane API:

```bash
$ relay workspace myns/myproject log

14:01  itbaron    "review the project, what's the stack"
14:02  claude     Analyzed structure, 4 packages
14:05  itbaron    "add zod schemas for all endpoints"
14:12  claude     fs.write schemas.ts, validate.ts (approved by: itbaron)
14:12  claude     ✓ bun test — 53/53 (approved by: itbaron)
14:30  it-baron   "add rate limiting to POST endpoints"
14:35  claude     fs.write rate-limit.ts (approved by: it-baron)
15:01  itbaron    "deploy to staging"
15:02  claude     ✓ fly deploy (approved by: it-baron)
15:10  itbaron    "commit and create a PR"
15:11  claude     ✓ PR #28 created (approved by: itbaron)
```

The audit log also serves as context recovery for agent reconnection after workspace resume — the agent can replay the log to restore conversational state.

---

## 9. Room-to-Room Communication

### 9.1 Rooms as ASP Participants

The defining property of ARP is that **a Room is an ASP participant**. Room B joins Room A exactly as any other participant would. From Room A's perspective, there is no difference between a human user, an external agent, a peer Room, or the RLM. All are participants with ASP sessions. This unification eliminates the need for a separate inter-Room protocol and enables recursive composition.

### 9.2 Message Forwarding Flow

When `claude` in Room A sends a message to `infra-agent` in Room B:

```
1. claude sends:    { to: "infra-agent", payload: ... }
2. Room A looks up local routing table
3. Table says:      infra-agent → Room B
4. Room A forwards via its ASP session with Room B:
   { from: "claude", to: "infra-agent",
     workspace: "myns/myproject",
     roomSrc: "room-7a3f", ttl: 7, payload: ... }
5. Room B receives and delivers to infra-agent as a local ASP message
```

The envelope carries `roomSrc` for traceability. Agents interact only with their local Room via standard ASP.

### 9.3 Inter-Room Link Lifecycle

Inter-Room links are provisioned by the Control Plane **before** traffic flows (pre-provisioned routing). The Control Plane:

1. Determines required Room-to-Room links based on agent placement
2. Instructs Room B to open an ASP session to Room A
3. Pushes routing entries to both Rooms
4. Monitors link health and re-provisions on failure

---

## 10. Mesh of Meshes (Federation)

Because Rooms are ASP participants, the same model extends to federation across clusters and organizations.

### 10.1 Intra-Organization Federation

Multiple clusters within the same organization are federated by linking boundary Rooms. The Control Planes remain independent; only the boundary Rooms are bridged.

```
[Cluster: health-samurai]         [Cluster: personal]
  [CP-A]                            [CP-B]
    |                                  |
  [Room A1] ←── ASP ──→ [Room B1]  [Room B2]
    ag1  ag2               ag3     ag4  ag5
```

### 10.2 Cross-Organization Federation via A2A

For cross-organization federation where the peer may not run ARP, boundary Rooms can expose A2A-compatible endpoints. The Room acts as a reverse proxy, translating between A2A HTTP discovery / task management and ASP:

```
External A2A Client
    |
    |── GET /.well-known/agent.json ──→  Boundary Room
    |                                      |
    |←── Agent Card (proxied) ─────────────|
    |                                      |
    |── POST /tasks (A2A) ───────────────→ Boundary Room
    |                                      |
    |                           Wraps in ASP envelope, routes internally
    |                                      |
    |←── A2A Response (proxied) ───────────|
```

This allows ARP-hosted agents to participate in the broader A2A ecosystem without requiring external systems to adopt ARP.

---

## 11. Relationship to Kubernetes

ARP is intentionally analogous to Kubernetes but for agent communication rather than container orchestration:

| Kubernetes | ARP | Key Difference |
|---|---|---|
| Namespace | Namespace | Identical concept |
| Deployment | Workspace | Workspace includes environment, members, channels |
| Pod | Agent | Agent has session state, harness, model config |
| Node | Room | Room is an active message forwarder, not a passive host |
| etcd (Raft) | CP state (Raft) | Identical model |
| kube-proxy | Room routing table | Room routes ASP envelopes, not TCP packets |
| CNI | Inter-Room ASP | Fabric is semantic (JSON-RPC), not network-layer |
| kubelet | RLM | RLM is pluggable (k8s, fork, serverless) |
| NetworkPolicy | Approval policy | Policy enforced per-workspace with human-in-the-loop |

The critical difference: Kubernetes delegates networking to CNI and treats it as transparent infrastructure. ARP treats the **communication fabric as the primary primitive**. The network is not transparent — it is the product.

---

## 12. Relationship to the Agentic AI Foundation (AAIF)

The AAIF, launched in December 2025 under the Linux Foundation by Anthropic, Block, and OpenAI (with support from Google, Microsoft, AWS, and others), provides neutral governance for foundational agentic AI projects including MCP, goose, and AGENTS.md. Google's A2A protocol is separately governed under the Linux Foundation.

ARP is designed to be **compatible with and complementary to** these protocols:

- **MCP:** Agents within an ARP workspace freely use MCP to access tools and data. The Room does not interfere with MCP connections. An MCP server can be co-located with the workspace environment for shared tool access.
- **A2A:** Boundary Rooms expose A2A-compatible endpoints for interoperability. A2A messages between mesh-hosted agents are transparently relayed through the ARP fabric.
- **AGENTS.md:** Agent configuration (including AGENTS.md conventions) is orthogonal to ARP. The RLM may use AGENTS.md to configure spawned agents.
- **ACP:** Agents that are ACP-compatible coding agents (e.g., Claude Code, Gemini CLI) can be spawned inside a workspace and connected to an editor via an ACP bridge. The bridge translates ACP's stdio JSON-RPC into ASP sessions.

ARP does not seek to replace any of these protocols. It provides the managed infrastructure mesh beneath them.

---

## 13. Open Questions

The following topics require further specification:

- **Multicast / capability-based routing:** How does a Room forward to all agents with a given capability across workspaces? Should this leverage A2A skill-based discovery?
- **Agent identity migration:** An agent moves between Rooms while preserving session state and A2A Agent Card continuity.
- **Authorization model:** Full specification of approval policies, mandate propagation across Room hops, and integration with enterprise IAM. (Separate RFC.)
- **ASP formal specification:** Complete JSON-RPC method catalog, error codes, capability negotiation schema, and wire format.
- **Observability:** Integration with OpenTelemetry for distributed tracing across Room hops. A2A v0.3 already supports OTLP — ARP should align.
- **Environment specification:** How environments are defined, provisioned, snapshotted, and restored by the RLM. Container image format, volume mounts, secrets management.
- **Context recovery:** How agents restore conversational state from the audit log after workspace resume. Maximum context window considerations.
- **Backpressure and flow control:** Behavior when a Room's forwarding queue is full; interaction with A2A long-running task semantics.
- **Addressing URI scheme:** Formalize the `namespace/workspace/agent` scheme; consider alignment with A2A Agent Card endpoint conventions.
- **Cross-workspace envelope scope:** Clarify whether the `workspace` field identifies the source workspace, the destination workspace, or both via separate fields when a message traverses Room boundaries.
- **Multi-agent workspaces:** Coordination patterns when a workspace has multiple agents (routing between them, turn-taking, delegation).

---

## 14. Out of Scope

The following are explicitly **not** part of this RFC:

- Agent business logic or task delegation protocols (use A2A)
- Agent-to-tool integration (use MCP)
- Editor-to-agent integration (use ACP)
- Specific ASP message payload formats beyond the envelope
- Agent harness specification (opaque to the protocol)
- UI/UX for approval buttons, message rendering, or thread display
- Billing, metering, or quota management

---

## Author's Address

Aleksei Kudriashov  
Email: akud.soft@gmail.com

---

*Agent Relay Protocol - RFC Draft - March 2026*
