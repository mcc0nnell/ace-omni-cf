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

## Architectural rule

ElixiPG must preserve the authority boundary:

```text
Elixip makes communications happen.
Omni records and evaluates what happened.
ElixiPG defines the proving-ground trial.
```

A scenario may execute SIP, RTP, WebRTC, timers, faults, or media behavior. It may not silently redefine experiment identity, canonical trial inputs, evidence identity, or the semantic verdict.
