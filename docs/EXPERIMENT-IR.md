# Omni Experiment IR

ACE Omni treats an assessment or communications experiment as a deterministic graph that is compiled before effects are executed.

This design is inspired by Sandia National Laboratories' FIREWHEEL architecture: composable model components build an authoritative experiment graph, capabilities can be supplied by interchangeable providers, and experiment setup is separated from synchronized experimental time. Omni adopts those architectural ideas without importing FIREWHEEL source code or its trusted-cluster execution assumptions.

## Boundary

The Experiment IR is not an adapter, agent, VM manager, UI graph, or shell runner.

It is the authoritative compiled description of:

- tasks and their causal dependencies;
- setup work versus post-baseline exercise work;
- canonical commands;
- capabilities required by each command;
- the explicit provider and adapter authorized to satisfy each capability;
- expected evidence;
- the exact regime identity and digest under which the experiment was compiled.

```text
OSCAL / authority
       ↓
compiled Regime
       ↓
assessment intent / scenario
       ↓
capability resolution
       ↓
Experiment IR DAG
       ↓
setup tasks
       ↓
──────── T=0 baseline seal ────────
       ↓
exercise tasks
       ↓
canonical commands
       ↓
capability-checked adapters
       ↓
observations / artifacts
       ↓
assertions / findings
```

## FIREWHEEL ideas adopted

### Experiment graph as intermediate representation

FIREWHEEL's model components transform an experiment graph that represents the intended experimental world before the execution backend realizes it. Omni uses the same separation: higher-order scenario or assessment authoring compiles into a deterministic IR before adapters execute effects.

The IR, not the UI, is authoritative.

### Capability-oriented providers

FIREWHEEL components distinguish requirements from providers. Omni does the same for execution capabilities.

A task asks for a capability such as `config.read`; it does not acquire authority merely by naming an implementation. Compilation resolves the capability to an explicit provider and adapter. If no provider exists, compilation fails. If multiple providers exist, compilation fails unless one is selected explicitly.

Provider resolution never bypasses canonical commands or adapter authorization.

### Setup, barrier, exercise

FIREWHEEL distinguishes pre-experiment setup from synchronized experimental time. Omni V1 models the same boundary with two phases:

- `setup` — materialize fixtures, capture configuration, establish instrumentation, and prepare the system;
- `exercise` — execute the assessment condition and collect resulting evidence.

A setup task may not depend on an exercise task. Once setup has completed, Omni can establish a logical `T=0` baseline.

The compiler emits a `baselineSeal.sha256` derived only from the setup graph, setup command bindings, experiment identity, and bound regime. Changing an exercise condition changes the overall experiment digest without silently changing the baseline digest.

This is intended to make the assessment boundary mechanically visible: preparation happened before the baseline; evidence-producing exercise happened after it.

## Fail-closed invariants

`@ace-omni/domain/experiment-ir` enforces:

1. task IDs and provider IDs are unique;
2. all dependencies resolve;
3. dependency cycles are rejected;
4. setup tasks cannot depend on exercise tasks;
5. every command names a capability;
6. every capability resolves to exactly one selected provider;
7. the selected provider must explicitly authorize the canonical command;
8. regime ID and regime digest travel together;
9. canonical ordering and hashing make semantically equivalent input orderings byte-equivalent.

These rules deliberately preserve the existing Omni invariant:

> Higher-order behavior expands into canonical primitive commands rather than bypassing the authoritative execution path.

## Security difference from FIREWHEEL

FIREWHEEL was designed for controlled experimental clusters and documents trusted-user, privileged execution assumptions. Omni should not inherit that model.

The Experiment IR therefore contains declarative commands and explicit capability bindings rather than arbitrary executable code. Adapters remain the authority boundary. A compiler may decide *which authorized provider* satisfies a capability; it does not grant a provider new capability.

## Relationship to Regime

The Regime compiler answers:

> What requirements, evidence needs, and decision semantics apply?

The Experiment compiler answers:

> What deterministic sequence of authorized actions and observations will test them?

A compiled experiment can bind to the exact `regimeId` and `regimeSha256`, preventing evidence generated under one effective regime from being silently represented as though it came from another.

## Next slice: Staghorn-style branching

This PR intentionally does not claim snapshot or time-travel support.

A future state-branching layer can add explicit snapshot/fork semantics around the baseline or later checkpoints:

```text
                   snapshot S0
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       trial A       trial B       trial C
          │            │            │
          ↓            ↓            ↓
      evidence A   evidence B   evidence C
```

That would allow an assessor to replay the same sealed starting state while changing one controlled condition, preserving the branch lineage and evidence produced by each run. The UI can then project those branches as an assessment debugger, but the branch graph must remain a domain/runtime object rather than presentation state.

## Provenance

Architectural references:

- Sandia FIREWHEEL documentation: https://sandialabs.github.io/firewheel/
- Sandia FIREWHEEL repository: https://github.com/sandialabs/firewheel
- Sandia Staghorn presentation: https://www.sandia.gov/app/uploads/sites/94/2021/08/Elliott-Staghorn-Presentation.pdf

No FIREWHEEL or Staghorn source code is copied by this implementation.
