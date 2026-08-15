# Governed agent behavior specifications

Status: **experimental / Atlas prompt-architecture follow-up**

This note captures a second architectural idea recovered from Sandia `atlas-ui-3`: prompts can act as operational control specifications rather than mere assistant personality text.

No Atlas prompt text is copied. ACE Omni adopts the structural lesson only.

## What the Atlas prompts reveal

Atlas contains narrowly scoped coding-agent definitions for activities such as:

- final quality-gate review;
- test execution and factual reporting;
- isolated git worktree setup.

Each definition is effectively an operational contract:

```text
trigger / role
  -> bounded procedure
  -> prohibited behavior
  -> required verification
  -> terminal result
```

The test-report role is especially instructive: it executes the authoritative test regime and reports results, but is explicitly prohibited from debugging or suggesting fixes. That is a recognizable separation-of-duties pattern.

Atlas also retains an older prompt-driven reason/observe control loop in its prompt assets. That layer produces planning/control objects around tool calls. The newer architecture increasingly relies on native tool execution, making the older prompts useful as an architectural fossil: cognition and control were once conflated in prompt output, then separated into actual tool/runtime behavior.

## Omni interpretation

Omni should preserve that separation explicitly:

```text
behavior specification
  -> how a role should reason, what evidence it needs,
     what it must not do, and how completion is recognized

operator/runtime binding
  -> which executor, adapter, and capability are authoritative

canonical command path
  -> the only path that may cause effects
```

Therefore:

> **Prompt / behavior specification does not grant authority.**

A behavior specification may constrain cognition and completion semantics. It may not name or grant executable tools, adapters, capabilities, shell commands, or environment access.

## First behavior-spec contract

`apps/web/src/lib/omni-behavior.ts` introduces a small versioned contract.

### Behavior spec

A behavior spec contains:

- stable `id` and label;
- `instructionRef` pointing at the governed instruction artifact;
- `instructionSha256` pinning the exact instruction version;
- one bounded `duty`;
- `separationFrom` duties that the same principal may not simultaneously perform in the same governance group;
- required evidence labels;
- a completion kind;
- an output contract.

The initial duty vocabulary is:

- `collect`
- `assess`
- `remediate`
- `approve`
- `report`
- `provision`

The initial completion vocabulary is:

- `evidence-emitted`
- `assertion-recorded`
- `remediation-recorded`
- `approval-recorded`
- `report-produced`
- `provisioning-verified`

### Assignment

A behavior assignment binds:

```text
operator context
  + behavior spec
  + principal identity
```

The principal is the human or agent identity performing that bounded duty.

### Binding

`composeBehaviorBindings()` resolves assignments against an already-validated `OmniOperatorDeck`.

The resulting binding includes executor, adapter, and capability only because they are copied from the governed operator context. The behavior spec itself is forbidden from supplying them.

Runtime validation rejects authority-shaped fields on a behavior spec, including:

- `executor`
- `adapterId`
- `capability` / `capabilities`
- `tool` / `tools` / `allowedTools`
- `command`
- `args` / `argv`
- `cwd`
- `env` / `environment`
- `script`
- `executable`
- `shell`

This preserves the existing path:

```text
intent
  -> higher-order expansion
  -> canonical Omni command
  -> capability / adapter authorization
  -> execution
  -> observation
  -> evidence
```

There is no `behavior spec -> tool -> effect` bypass.

## Separation of duties

The first implementation turns the Atlas prompt insight into a machine-checkable control.

Separation is evaluated per governance group and principal. If two assigned behavior specs declare incompatible duties and the same principal is assigned both, composition fails.

For the SC-7 fixture:

```text
agent:ssp-collector
  duty: collect

agent:boundary-collector
  duty: collect

agent:control-assessor
  duty: assess

human:finding-reviewer
  duty: approve
```

The collector roles declare separation from assessment, remediation, and approval. The assessor declares separation from collection, remediation, and approval. The human approval role declares separation from collection, assessment, and remediation.

If the boundary collector is also assigned the contradiction-assessor context, the behavior manifest fails validation before the operator surface is composed.

This produces an explicit invariant:

```text
collector != assessor
assessor != remediator
remediator != approver
```

The identities may be human or machine. The control is about incompatible duties, not implementation type.

## Evidence and completion

A bounded agent role needs more than an instruction string. The contract must say what counts as finished.

Examples from the SC-7 fixture:

```text
SSP collector
  requires: ssp-implementation-statement
  completes: evidence-emitted
  output: evidence/ssp-claim-v1

boundary evidence collector
  requires: security-group-snapshot
  completes: evidence-emitted
  output: evidence/network-boundary-v1

contradiction assessor
  requires:
    - ssp-implementation-statement
    - security-group-snapshot
  completes: assertion-recorded
  output: assertion/control-contradiction-v1

finding approver
  requires:
    - control-assertion
    - finding-record
  completes: approval-recorded
  output: decision/finding-review-v1
```

This is intentionally closer to a service behavior contract or control procedure than a chatbot persona.

## Relationship to Regime and Experiment IR

The behavior specification does not replace the Regime or Experiment IR.

Expected eventual composition:

```text
OSCAL / authority
       ↓
compiled Regime
       ↓
Experiment IR task
       ↓
behavior specification
  role / evidence needs / completion / separation
       ↓
authoritative provider + adapter + capability binding
       ↓
canonical Omni commands
       ↓
observations / evidence / assertions
       ↓
operator projection
```

The Regime determines what evidence has compliance meaning. The Experiment IR determines where the task sits in the authoritative DAG. The behavior spec constrains how the assigned role performs its duty. The adapter/capability binding determines what it may actually do.

## Why this matters for GRC

This is the beginning of machine-executable organizational controls.

A traditional control procedure often says that one party gathers evidence, another evaluates it, another remediates deficiencies, and an authorized official or reviewer approves the result. Agentic automation becomes materially safer when those distinctions survive implementation rather than collapsing into one omnipotent agent prompt.

The architectural target is therefore not "an agent with a good system prompt."

It is:

```text
bounded role
+ pinned behavior specification
+ authoritative task identity
+ explicit capability binding
+ required evidence
+ separation of duties
+ completion contract
+ audit identity
```

That is the unit the Omni operator cockpit should eventually display and govern.
