# Omni Proving Grounds

The **Omni Proving Grounds** catalog controlled experiments that exercise behavior through one or more execution grounds and evaluate the result with ACE Omni Core semantics and evidence.

**ElixiPG** remains the first executable ground: Elixip owns communications execution while Omni owns experiment identity, normalized observations, evidence, and cross-runtime comparison. The proving-ground registry is broader than Elixip, however. A trial may target a communications runtime, a synthetic world, a cyber range, a system under test, or another explicitly governed environment.

```text
                 Omni Proving Grounds

                         Trial
                           │
                           ▼
                    Omni Core intent
                           │
                           ▼
                 governed effect boundary
                           │
                           ▼
              execution ground / world / SUT
                           │
                 events / observations / faults
                           │
                           ▼
                   Omni evidence plane
                           │
                           ▼
              replay / hypothesis / verdict
```

## Vocabulary

- **Ground** — the executable environment under test.
- **Trial** — one named, controlled proving-ground experiment.
- **Scenario** — the behavior exercised by the trial.
- **Conditions** — deterministic network, media, accessibility, runtime, or world manipulations.
- **Observer** — a source that reports facts about execution without becoming experiment authority.
- **Evidence** — the preserved, runtime-independent record used to evaluate a trial.
- **Replay** — reconstruction from pinned trial inputs and evidence.
- **Hypothesis** — a provisional model of hidden behavior formed during a discovery trial.
- **Verdict** — the independently evaluated result of declared assertions or discovered claims.

## Trial modes

Every trial declares one of two modes.

### Conformance

The expected behavior and assertions are known in advance. The trial asks whether the system behaves as specified.

Examples: runtime semantic equivalence, SIP lifecycle behavior, terminal-state isolation, deterministic replay.

### Discovery

The relevant environment rules are intentionally withheld from the agent. The trial asks whether the agent can infer and demonstrate valid invariants through bounded experimentation.

A discovery trial must keep the oracle hidden, restrict actions to an explicit manifest, preserve hypothesis revisions, impose an experiment budget, require replayable evidence for claims, and use verdict logic independent of the agent's self-assessment.

The core loop is:

```text
unknown behavior
      ↓
bounded experiment
      ↓
authorized Omni action
      ↓
observation
      ↓
hypothesis
      ↓
next experiment
      ↓
evidence-backed invariant
      ↓
independent verdict
```

See [`docs/DISCOVERY-TRIALS.md`](../docs/DISCOVERY-TRIALS.md).

## Trial states

Trial manifests under `proving-grounds/trials/` use one of four states:

- `planned` — contract exists; executable path or evidence is not complete.
- `runnable` — execution path exists but the trial is not declared proven.
- `proven` — CI must be able to locate and validate the trial's declared evidence.
- `regressed` — a previously proven trial has a known semantic divergence.

A trial is never `proven` merely because a document says so. `npm run test:elixipg` retains its historical command name but now validates the broader Omni Proving Grounds registry. For proven conformance trials it verifies declared cross-runtime evidence; for proven discovery trials it requires a generated discovery record plus an independent verdict artifact.

## Foundational trials

### PG-001 — Runtime Independence

Mode: `conformance`

Demonstrate that the same Omni Core behavior produces equivalent semantic traces across Cloudflare Omni, JAIN SLEE Omni, and Elixip Omni.

This is the first proven trial. It uses the five canonical conformance fixtures and the generated traces under `conformance/generated/`.

### PG-002 — SIP Establishment

Mode: `conformance`

Replace abstract `START_ACTIVITY` in the Elixip conformance scenario with a real SIP INVITE/dialog lifecycle. Normalize dialog establishment, failure, teardown, and relevant media observations back into Omni Core events and evidence.

PG-002 is intentionally `planned` until that real SIP path exists.

### PG-003 — Discovery Under Uncertainty

Mode: `discovery`

Evaluate whether a governed agent can infer and demonstrate valid hidden system invariants through bounded experiments without receiving arbitrary execution authority.

PG-003 adopts the architectural pattern demonstrated by DiG-bench: the agent must experiment against an environment whose rules are not disclosed, preserve a hypothesis ledger, and support every final claim with replayable evidence. The benchmark supplies the discovery pattern; Omni supplies the authority boundary and evidence model.

## Architectural rule

The proving grounds must preserve the authority boundary:

```text
The ground makes behavior happen.
Omni controls experiment identity and evidence.
The trial constrains what may be tested.
The agent may choose among authorized experiments.
The verdict is independent of the agent.
```

A scenario may execute SIP, RTP, WebRTC, timers, faults, media behavior, synthetic-world changes, or other explicitly authorized effects. It may not silently redefine experiment identity, canonical inputs, adapter authority, evidence identity, hidden oracle state, or the semantic verdict.
