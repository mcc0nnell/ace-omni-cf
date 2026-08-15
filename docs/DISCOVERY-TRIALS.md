# Discovery Trials — bounded scientific discovery in Omni

Status: **experimental proving-ground contract**

ACE Omni already knows how to execute controlled experiments, preserve observations, compare runtime semantics, and produce evidence. Discovery trials add a different question:

> What if the system behavior is not disclosed to the agent in advance?

Instead of checking a known assertion against known expected behavior, a discovery trial requires an agent to interact with a bounded environment, observe the consequences, form hypotheses, test them, revise them, and eventually demonstrate valid invariants with replayable evidence.

The direct inspiration is **DiG-bench: Discovery in Games** (`discos-research/dig-bench`). DiG-bench evaluates scientific discovery using text-based games whose transformation rules are hidden from the agent. Omni adopts that architectural pattern, not DiG-bench source code or benchmark content.

## Why this matters for assurance

Most automated compliance testing begins with a known requirement and a known test method:

```text
control requirement
      ↓
known assessment procedure
      ↓
collect evidence
      ↓
pass / fail / review
```

A discovery trial tests a harder capability:

```text
unknown system behavior
      ↓
controlled experiment
      ↓
observation
      ↓
hypothesis
      ↓
new controlled experiment
      ↓
discovered invariant
      ↓
evidence-backed assertion
```

For security testing and evaluation, that can mean discovering the system's actual trust boundaries, authorization behavior, failure conditions, timing assumptions, state transitions, or hidden coupling rather than merely checking a supplied implementation statement.

This is closer to **ST&E as scientific discovery** than to another scanner.

## The authority problem

Discovery requires freedom to choose the next experiment. It does **not** require freedom to execute arbitrary effects.

The critical rule is:

> **Give the machine freedom to discover without giving it freedom to act outside the experimental boundary.**

A discovery agent may select among experimental actions already authorized by the trial and runtime. It may not create new tools, adapters, capabilities, shell paths, credentials, or external-effect channels.

The intended execution path remains:

```text
agent hypothesis / experimental choice
                ↓
       canonical Omni intent
                ↓
      capability / adapter check
                ↓
        authorized effect boundary
                ↓
        world / system under test
                ↓
             observation
                ↓
          Omni evidence plane
```

JAIN SLEE is one particularly useful realization of this pattern because SBB behavior and Resource Adaptor I/O are explicitly separated. A SLEE-backed discovery trial can let the agent choose experiments while still requiring every effect to traverse a finite RA vocabulary.

The same principle applies to Cloudflare adapters, SCEPTRE bindings, Elixip, browser runtimes, or other Omni grounds.

## Discovery contract

A trial with `"mode": "discovery"` must declare a `discovery` contract.

### Hidden oracle

`oracleVisibility` must be `hidden`.

The ground may contain an oracle, rule set, expected invariant set, or independent evaluator, but the agent-facing execution context must not receive that answer as input.

The point is to test discovery, not retrieval.

### Explicit action vocabulary

`allowedActionPolicy` must be `explicit-manifest-only`.

The manifest describes classes of action that the trial may expose. Those action classes are constraints, not grants. Concrete execution must still lower into canonical Omni commands and ordinary capability/adapter authorization.

A discovery manifest must never become an alternate `trial -> shell -> effect` path.

### Experiment budget

A discovery trial must have a finite experiment budget.

The budget makes exploration measurable and bounded. It also prevents a successful verdict from meaning only that the agent eventually brute-forced an unlimited environment.

PG-003 currently declares:

- maximum 50 experiments;
- maximum 10 resets.

Those are proving-ground defaults for the planned trial, not universal Omni limits.

### Hypothesis ledger

A discovery trial must preserve hypotheses and their revision history.

The ledger should be able to answer:

- what the agent believed at each point;
- which observation caused a belief to change;
- which experiment was chosen to distinguish competing hypotheses;
- which hypotheses were falsified;
- which final invariant claims survived testing.

A final answer without that causal record is insufficient assurance evidence.

### Evidence-backed claims

Every discovered invariant must bind to replayable evidence.

A claim such as "role B cannot invoke operation X after state transition Y" must identify the experiments and observations that support it. The agent's narrative confidence is not evidence.

### Independent verdict

`verdictAuthority` must be `independent`.

The agent being evaluated may propose claims and explanations, but it may not grade its own success. A proving-ground evaluator, hidden oracle, deterministic checker, human assessor, or other separately governed authority must determine whether the claimed invariant is valid.

## PG-003 — Discovery Under Uncertainty

The first discovery trial is intentionally `planned`.

Its purpose is to establish the contract before wiring a particular world or model harness.

A future runnable vertical slice should use a deliberately small hidden-state system with:

1. a pinned hidden oracle;
2. a narrow authorized action vocabulary;
3. deterministic reset/checkpoint support;
4. complete action/observation capture;
5. a hypothesis ledger;
6. an independent verdict that compares demonstrated claims with the hidden oracle;
7. evidence proving that all effects traveled through authorized Omni boundaries.

Only after that slice is deterministic should the pattern expand to richer environments such as SCEPTRE worlds, communications runtimes, browser applications, or deployed test systems.

## Relationship to the broader Omni stack

Discovery trials fit naturally into the architecture already emerging around Omni:

```text
FIREWHEEL / SCEPTRE
    world construction and controlled state

GHOSTS / synthetic actors
    behavior inside the world

Atlas / TalkPipe / agent runtime
    governed cognition and orchestration

Omni Core
    experiment identity, commands, observations, evidence

SLEE / authorized adapters
    bounded external effects

Discovery trial
    experiment -> observation -> hypothesis -> next experiment

Flow/provenance layer
    causal record and replay

OSCAL / Regime / assessment
    assurance meaning and control interpretation
```

The important separation remains intact:

- the world does not decide compliance meaning;
- the agent does not grant itself authority;
- OSCAL does not execute effects;
- the UI does not become experiment truth;
- the agent does not issue its own verdict.

## Federal assurance interpretation

A mature discovery trial could support questions such as:

- infer the effective authorization matrix of an unfamiliar application;
- discover which state transitions actually invalidate sessions or privileges;
- infer trust-boundary behavior from controlled network perturbations;
- discover hidden dependencies between components from fault injection;
- identify undocumented fail-open / fail-closed conditions;
- test whether implementation behavior matches an SSP claim without giving the agent the implementation answer;
- compare discovered invariants against OSCAL assertions or Regime requirements after the experiment completes.

That is not autonomous authorization. It is a governed way to let machines perform bounded scientific inquiry and turn the resulting experiments into inspectable assurance evidence.
