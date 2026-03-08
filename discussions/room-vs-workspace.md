# Discussion: Room vs Workspace — One Entity or Two?

**Date:** 2026-03-08
**Status:** Open
**Authors:** Nikolai Ryzhikov, Claude

---

The current AGRP RFC defines Room (switching node: ASP connections, routing, fan-out, mandate signing, approval enforcement, audit) and Workspace (collaboration unit: identity, membership, environment, agents, channels, policies, lifecycle) as separate abstractions with a strict 1:1 relationship. On paper the split is clean — Room "enforces", Workspace "defines" — but in practice Room cannot function without continuous access to Workspace state. It needs membership for fan-out, policies for approvals and mandates, and resource configuration for proxying. The two abstractions are operationally inseparable: they are created together, destroyed together, and share the same people, roles, and policy data in two representations.

The main arguments for keeping them separate are future N:M flexibility (no concrete use case exists today), separation of concerns (conceptually distinct but operationally coupled), and recursive composition ("Room joins Room"). Each has a straightforward counter: premature separation adds complexity for hypothetical benefit; tightly coupled components deployed separately create more problems than they solve; and "Workspace A links to Workspace B" is semantically identical to "Room A joins Room B" but easier to explain. Industry confirms this — Devin, GitHub Copilot, Cursor, Factory, and Replit all expose a single workspace/session concept without a separate switching node abstraction.

**Recommendation: merge Room into Workspace.** Switching behavior (routing, forwarding, fan-out) becomes an internal capability of Workspace, not a separate spec-level resource. Nothing else changes — ASP protocol, message envelopes, routing model, approval flow, mandates, multi-hop relay, and federation all work identically with Workspace as the sole abstraction. The term "Room" can still appear in implementation and architecture discussions as the name for the switching subsystem. Implementations may still separate switching, policy, and lifecycle into internal modules — the question is about the spec-level abstraction, not implementation architecture.
