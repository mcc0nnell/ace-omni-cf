# Omni Core Conformance

This directory turns the Omni Core draft into an executable behavioral contract.

A fixture is runtime-neutral input: a run identity, an activity identity, and an ordered event stream. Each runtime emits the same normalized semantic trace: whether the event was accepted or ignored, the resulting Omni semantic state, abstract commands emitted by behavior, and the observation-count delta.

The trace deliberately excludes runtime machinery such as Durable Object IDs, SQLite rows, WebSocket frames, Java object identities, JNDI bindings, BEAM process IDs, and container callbacks.

## Runtimes

The Cloudflare semantic adapter in `scripts/run-omni-conformance.mjs` projects the authoritative `CallRoom` lifecycle into Omni Core states. Cloudflare collapses some steps internally (`waiting -> active`), so conformance normalizes its observable behavior into `WAITING -> READY -> RUNNING -> COMPLETED/FAILED` rather than requiring identical internal state names.

`OmniConformanceFixtureTest` executes the same fixtures through the real `OmniCallSbb` transition entry point and its synthetic Resource Adaptor. Maven writes those traces to `conformance/generated/slee/`.

`ports/elixip/omni_conformance.exs` executes the fixtures inside a pinned real Elixip `SIP.Scenario` FSM. Elixip writes its traces to `conformance/generated/elixip/`. The first Elixip slice keeps `START_ACTIVITY` abstract; a later transport slice can map it to SIP/dialog/media behavior without changing the conformance schema.

## Equivalence

CI requires four views to match exactly: the fixture oracle plus the Cloudflare, SLEE, and Elixip semantic traces. Current fixtures cover successful two-participant execution with an observation, duplicate-event idempotency, cross-run/activity correlation isolation, timeout/transport failure, and terminal-state isolation.

Generated traces are not committed. CI preserves them as build artifacts.

```sh
mvn -B -f ports/jain-slee/pom.xml test
ELIXIP_DIR=/path/to/pinned/elixip npm run test:conformance:elixip
npm run test:conformance
```

The existing Worker/Durable Object integration and browser vertical-slice suites remain separate evidence that the Cloudflare runtime itself is healthy. Conformance is a semantic comparison layer, not a replacement for those runtime tests.

## What this proves — and what it does not

A green three-runtime comparison proves that the tested Omni behavior survives execution in three materially different runtime models.

It does **not** yet prove SIP interoperability or media equivalence for Elixip. The current Elixip scenario exercises the real scenario engine and FSM semantics while keeping external transport synthetic. The next experiment is to bind `START_ACTIVITY` to a real Elixip SIP call and translate the resulting SIP/dialog/media events back into Omni observations.
