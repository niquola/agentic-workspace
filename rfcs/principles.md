# Protocol Principles

- Status: draft
- Date: 2026-03-11

This document records the principles that should guide the evolution of this
protocol. It is intentionally more general than any individual RFC.

## Interoperability First

The purpose of a protocol is to let independent implementations work together.
The standard should therefore describe only what parties must share in order to
interoperate reliably.

Anything that is not required for interoperability should be treated with
skepticism before it is added to the core contract.

## Semantics Before Mechanism

The protocol should define behavior, meaning, and invariants. It should not
define internal machinery unless that machinery is itself part of the public
contract.

Different implementations should be free to realize the same semantics through
different internal architectures.

## One Canonical Story

A good protocol should feel like it was designed deliberately.

There should be one clear vocabulary, one clear model, and one clear way to
understand the surface. Historical accidents, aliases, transitional spellings,
and local quirks should not be elevated into the standard merely because they
exist somewhere in code.

## Orthogonality

Public concepts should be cleanly separated. Each concept should have one job.

When a design starts using one field, identifier, or message for several
different purposes, the model becomes harder to understand and harder to
implement consistently. Orthogonality is not aesthetic polish; it is a
precondition for correctness.

## Restraint

A protocol should standardize as little as it can, while still fully defining
the shared behavior that matters.

It is usually better to leave something unspecified than to standardize it
prematurely in a way that freezes an incidental design choice.

## Extension Without Confusion

Implementations will always need room for additional behavior. The right answer
is not to overload the core model, but to make extension possible without
making the base contract ambiguous.

A client that understands the base protocol should still be able to interoperate
even in the presence of implementation-specific additions.

## Authority Belongs To The Server

Where the protocol involves identity, attribution, or access control, the
authoritative meaning should come from authenticated server-side judgment, not
from client self-description.

Clients may request actions. They should not be asked to define the facts that
the server is supposed to be deciding.

## Reference Implementations Inform, But Do Not Rule

Implementations are valuable because they reveal real design pressure. They are
evidence. They are not the standard.

The job of the RFC is to extract the stable public contract from implementation
experience and restate it in a cleaner, more general form.

## Evolution Should Be Deliberate

Protocols should grow carefully. Additive change is easier to absorb than
semantic churn. Versioning should be used when real incompatibility is
introduced. Ambiguity should be treated as a defect.

The standard should evolve, but it should do so in a way that lets independent
implementations converge rather than drift.

## Clarity Is Part Of The Design

Clarity is not secondary documentation work. It is part of the protocol
itself.

If the model is awkward to explain, overloaded with exceptions, or dependent on
local background knowledge, that is usually a sign that the design is not yet
finished. A good protocol should be simple enough to explain plainly and
precise enough to implement confidently.
