# Cloudflare ACE Omni — semantic archaeology

Source: `mcc0nnell/ace-omni-cf`

This note identifies which ideas in the 2026 Cloudflare resurrection appear to be ACE Omni semantics and which are properties of the chosen runtime.

## Preserved from original Omni

The Cloudflare implementation preserves the original research shape:

- researchers define communications conditions before execution;
- participants occupy assigned roles;
- a call/run executes one selected configuration;
- media/caption conditions can be deliberately manipulated;
- runtime observations and research artifacts are collected;
- the resulting data remains attached to the exact execution that produced it.

The implementation changes almost completely; the experiment grammar survives.

## Semantics made explicit

### Immutable experiment versions

A call pins an exact experiment version instead of relying on a mutable study document. A later edit cannot silently change the meaning of an earlier execution.

This is promoted to Omni Core as **ExperimentVersion**.

### Authoritative execution identity

The server chooses call/run identity, participant role, configuration, schedule and event/evidence ordering. Browsers and attached runtimes execute work and report observations but do not author those authoritative identities.

This is promoted to Omni Core as an **authority invariant**.

### Deterministic commands

The experiment engine introduces `ExperimentRun`, deterministic `ExecutionPlan` compilation, stable command sequencing, seeded commands and canonical plan digests.

This is promoted to Omni Core as the separation between an experiment version and a particular reproducible run.

### Resource adapters

`SystemUnderTestAdapter` separates the experiment authority from the world/system being exercised. Adapters declare capabilities and follow a `prepare -> start -> command -> observe -> stop` lifecycle.

This is promoted to Omni Core as the generic external-resource boundary. In SLEE that boundary maps naturally to a Resource Adaptor without requiring the two interfaces to be identical.

### Commands versus observations

An `ExecutionCommand` says what Omni intends an endpoint or attached runtime to do.

An `ObservationEnvelope` says what a source reports or measures. It carries stable run/adapter/source identity, observation time, payload and canonical payload digest.

These are deliberately distinct. A command is not evidence that the condition occurred.

This distinction is normative Omni Core behavior.

### Replay-safe evidence identity

Observation identity is stable and exact replay is idempotent. Reusing the same identity with changed timestamp or payload is a conflict.

The reliable room client, Durable Object sequencer and D1 synchronization apply the same principle to browser-originated research observations.

This becomes the Omni Core requirement that accepted event/observation identity is retry-safe and cannot be silently mutated.

### Terminal evidence boundary

A terminal call produces an immutable manifest or an explicit failure reason. Events cannot silently escape the finalized evidence boundary.

The first SLEE conformance slice promotes only the smaller invariant: `COMPLETED` and `FAILED` are terminal. Full manifest persistence remains an external resource for a later port step.

## Cloudflare-specific machinery not promoted to Omni Core

These remain implementation choices:

- Hono routing;
- Cloudflare Workers;
- one Durable Object per call;
- Durable Object SQLite;
- D1 persistence;
- R2 artifact storage;
- WebSocket hibernation;
- Worker alarms;
- Wrangler bindings;
- browser credential format;
- exact CSRF/session implementation.

Their responsibilities may map to SLEE facilities or external Resource Adaptors, but the APIs themselves are not Omni semantics.

## The surviving runtime-independent chain

```text
pinned experiment version
        -> identified run/activity
        -> authoritative commands
        -> external resource execution
        -> observations
        -> correlated state transitions
        -> evidence
        -> terminal outcome
```

That chain is the basis of `docs/omni-core/SPEC.md` and the first JAIN SLEE conformance port.
