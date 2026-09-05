# ElixiPG — Elixip Proving Grounds

**ElixiPG** is the controlled proving-ground layer for exercising communications behavior through Elixip and evaluating the result with ACE Omni Core semantics and evidence.

It is not a second test framework and it is not a fork of Elixip. Elixip owns communications execution. Omni owns experiment identity, normalized observations, evidence, and cross-runtime comparison. ElixiPG names and catalogs the controlled trials that connect those two roles.

```text
                     ElixiPG
             Elixip Proving Grounds

                    Trial
                      │
                      ▼
               Omni Core intent
                      │
                      ▼
                   Elixip
             SIP / media / FSM world
                      │
          events / observations / faults
                      │
                      ▼
               Omni evidence plane
                      │
                      ▼
             replay / comparison / verdict
```

## Vocabulary

- **Ground** — the executable communications environment under test.
- **Trial** — one named, controlled proving-ground experiment.
- **Scenario** — the communications behavior exercised by the trial.
- **Conditions** — deterministic network, media, accessibility, or runtime manipulations.
- **Observer** — a source that reports facts about execution without becoming experiment authority.
- **Evidence** — the preserved, runtime-independent record used to evaluate a trial.
- **Replay** — reconstruction from pinned trial inputs and evidence.
- **Verdict** — the result of evaluating declared trial assertions.

## Trial states

Trial manifests under `proving-grounds/trials/` use one of four states:

- `planned` — contract exists; executable path or evidence is not complete.
- `runnable` — execution path exists but the trial is not declared proven.
- `proven` — CI must be able to locate and validate the trial's declared evidence.
- `regressed` — a previously proven trial has a known semantic divergence.

A trial is never `proven` merely because a document says so. `npm run test:elixipg` validates the registry and, for proven trials, verifies the declared runtime evidence produced by the conformance pipeline.

## Initial trials

### PG-001 — Runtime Independence

Demonstrate that the same Omni Core behavior produces equivalent semantic traces across Cloudflare Omni, JAIN SLEE Omni, and Elixip Omni.

This is the first proven ElixiPG trial. It uses the five canonical conformance fixtures and the generated traces under `conformance/generated/`.

### PG-002 — SIP Establishment

Replace abstract `START_ACTIVITY` in the Elixip conformance scenario with a real SIP INVITE/dialog lifecycle. Normalize dialog establishment, failure, teardown, and relevant media observations back into Omni Core events and evidence.

PG-002 is intentionally `planned` until that real SIP path exists.

### PG-003 — Modality Readiness Under Stalled ICE

Carry the next boundary past dialog establishment: preserve signaling, ICE, candidate-pair, inbound-media, decoded-video, rendered-video, and RTT readiness as independent observations while ICE gathering is delayed or incomplete.

The historical ACE Direct JsSIP timeout patch motivates the condition but is not treated as proof that a current implementation shares the same defect. PG-003 is intentionally `planned` until a normal control and a manipulated stalled-ICE arm can be executed and preserved as Omni evidence.

The readiness vocabulary is defined in [`docs/MODALITY_READINESS.md`](../docs/MODALITY_READINESS.md).

### PG-004 — Baudot Cross-Transport T.140 Equivalence

Execute the portable Baudot `BAUDOT-INTEROP-002` contract as an Omni proving-ground trial across RFC 4103 RTP/RED and RFC 8865 T.140 data-channel interworking.

The authority boundary is deliberate: **Baudot owns the standards-grounded protocol behavior and gateway invariants; Omni owns trial identity, execution planning, observations, evidence identity, replay, and verdict.** Omni does not acquire the authority to promote a Baudot conformance claim merely because an experiment passes.

PG-004 is intentionally `planned`. A mutable Baudot pull request may identify the development contract while the trial is being designed, but before PG-004 can become `runnable`, the contract must be merged and pinned by exact commit and immutable digest. The planned evidence chain is:

```text
pinned Baudot contract
        ↓
source transport trace
        ↓
normalized post-recovery T.140 trace
        ↓
target transport trace
        ↓
presentation / missing-marker comparison
        ↓
Omni evidence + terminal verdict
```

This keeps protocol conformance, experiment execution, and evidence authority separate instead of allowing any one layer to redefine the others.

## Architectural rule

ElixiPG must preserve the authority boundary:

```text
Elixip makes communications happen.
Omni records and evaluates what happened.
ElixiPG defines the proving-ground trial.
```

A scenario may execute SIP, RTP, WebRTC, timers, faults, or media behavior. It may not silently redefine experiment identity, canonical trial inputs, evidence identity, or the semantic verdict.
