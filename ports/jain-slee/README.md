# ACE Omni — JAIN SLEE port

This directory is the first conformance port of ACE Omni's experiment/call behavior to a Service Logic Execution Environment.

It is intentionally **not** a rewrite of the React/WebRTC application. The purpose is to prove that the experiment semantics survive a runtime change.

## Why this exists

ACE Omni now has three useful architectural viewpoints:

1. **Original MITRE ACE Omni** — Node.js, MongoDB, Socket.IO/WebSocket-era orchestration, local experiment data, cloud-service integrations.
2. **Cloudflare ACE Omni** — Workers, Durable Objects, D1, R2, WebRTC, immutable experiment versions, deterministic schedules, generic system-under-test adapters, observation envelopes, and evidence manifests.
3. **SLEE port** — stateful Service Building Blocks, Resource Adaptor boundaries, activity correlation, events, and profiles/configuration.

Anything that remains necessary across all three is a candidate for the runtime-independent Omni Core.

## Current target

The code compiles against the standard **JAIN SLEE 1.1 API** (`javax.slee:jainslee-api:1.1`).

Nhan Nguyen's micro-JAIN-SLEE implementation is the intended modern container target, but its current source/API is not publicly discoverable from this repository. The port therefore keeps container-specific code deliberately thin: the behavior is standard SLEE, and the SBB-facing RA interface can be rebound when that runtime is available.

## First vertical slice

```text
ParticipantJoined(A)
        |
        v
OmniCallSbb -> WAITING_FOR_PARTICIPANTS
        |
ParticipantJoined(B)
        |
        v
      READY
        |
        +---- StartActivity command ----> OmniTransport RA
                                           |
                                           +---- external runtime / browser / SIP / simulator later
        |
ActivityStarted event
        |
        v
      RUNNING
        |
ObservationReceived
        |
ActivityEnded
        |
        v
     COMPLETED
```

`COMPLETED` and `FAILED` are terminal.

The SBB also rejects events from a different `runId` or `activityId` and deduplicates previously accepted event IDs before they can produce another command.

## SBB / RA rule

The boundary is strict:

> **SBB owns behavior. Resource Adaptor owns I/O.**

`OmniCallSbb` does not open sockets, talk WebRTC, read Cloudflare state, or call SIP APIs. It emits an `OmniCommand` through `OmniTransportRaSbbInterface`.

The synthetic transport in this directory is a deterministic test double for that SBB-facing RA contract. It is **not yet a deployable JAIN SLEE ResourceAdaptor**. The deployable RA lifecycle and descriptors should be bound against the concrete micro-JAIN-SLEE runtime instead of guessing its conventions.

## Mapping

| ACE Omni / Cloudflare | JAIN SLEE port |
| --- | --- |
| Durable Object call authority | SBB entity + activity context |
| room/call event | SLEE event |
| deterministic state transition | SBB behavior |
| system-under-test adapter | Resource Adaptor / RA object |
| pinned experiment configuration | Profile/configuration input |
| DO alarm | Timer Facility |
| call/run correlation IDs | activity context + explicit run/activity IDs |
| observation envelope | resource event payload |
| D1/R2 evidence persistence | external Evidence RA later |

The mapping is behavioral, not a claim that the runtime primitives are identical.

## Build

From the repository root:

```bash
mvn -B -f ports/jain-slee/pom.xml test
```

The repository CI runs the same command.

## What is deliberately outside this slice

- React UI
- browser WebRTC implementation
- AudioWorklets
- D1/R2 persistence
- evidence uploads/manifests
- SIP/Elixip
- a deployable micro-JAIN-SLEE RA descriptor
- multi-party CA/VRS topology

Those should attach to the semantic kernel rather than redefine it.

## Next port step

Once the micro-JAIN-SLEE repository/API is available:

1. bind `OmniTransportRaSbbInterface` to its concrete RA lifecycle;
2. turn the generic Omni events into native runtime events;
3. bind `OmniCallSbb` state to its preferred CMP/profile mechanism;
4. run the same conformance tests against both the Cloudflare and SLEE implementations;
5. only then add a SIP/Elixip RA.
