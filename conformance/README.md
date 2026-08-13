# Omni Core Conformance

This directory turns the Omni Core draft into an executable behavioral contract.

A fixture is runtime-neutral input: a run identity, an activity identity, and an ordered event stream. Each runtime emits the same normalized semantic trace: whether the event was accepted or ignored, the resulting Omni semantic state, abstract commands emitted by behavior, and the observation-count delta.

The trace deliberately excludes runtime machinery such as Durable Object IDs, SQLite rows, WebSocket frames, Java object identities, JNDI bindings, and container callbacks.

## Runtimes

The Cloudflare semantic adapter in `scripts/run-omni-conformance.mjs` projects the authoritative `CallRoom` lifecycle into Omni Core states. Cloudflare collapses some steps internally (`waiting -> active`), so conformance normalizes its observable behavior into `WAITING -> READY -> RUNNING -> COMPLETED/FAILED` rather than requiring identical internal state names.

`OmniConformanceFixtureTest` executes the same fixtures through the real `OmniCallSbb` transition entry point and its synthetic Resource Adaptor. Maven writes those traces to `conformance/generated/slee/`.

## Equivalence

CI requires all three to match exactly: the fixture oracle, the Cloudflare semantic trace, and the SLEE semantic trace. Current fixtures cover successful two-participant execution with an observation, duplicate-event idempotency, cross-run/activity correlation isolation, timeout/transport failure, and terminal-state isolation.

Generated traces are not committed. CI preserves them as build artifacts.

```sh
mvn -B -f ports/jain-slee/pom.xml test
npm run test:conformance
```

The existing Worker/Durable Object integration and browser vertical-slice suites remain separate evidence that the Cloudflare runtime itself is healthy. Conformance is a semantic comparison layer, not a replacement for those runtime tests.
