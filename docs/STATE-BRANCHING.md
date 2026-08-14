# State Branching in ACE Omni

ACE Omni models repeatable experimental branching as a lineage-preserving operation from a cryptographically bound system checkpoint.

This layer is inspired by Sandia National Laboratories' Staghorn work on coordinated full-system snapshots and repeated execution from a preserved state. Omni adopts the architectural principle — restore one known state, vary one controlled condition, retain the resulting lineage and evidence — without claiming that a domain object itself can snapshot or restore an arbitrary runtime.

## The model

```text
                 compiled experiment E0
                          │
                          ▼
                   setup / materialize
                          │
                          ▼
                 ─────── T=0 ───────
                          │
                          ▼
                 state checkpoint S0
                state artifact digest
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          branch A      branch B      branch C
          role=user     role=admin    enabled=false
             │            │            │
             ▼            ▼            ▼
        evidence A    evidence B    evidence C
```

The runtime is responsible for producing and restoring the state artifact. The domain layer is responsible for proving what that artifact belongs to and what a branch is allowed to change.

## Baseline checkpoints

`bindBaselineCheckpoint()` binds a runtime-produced state artifact to:

- the exact compiled experiment ID;
- the exact compiled experiment SHA-256 digest;
- the exact `T=0` baseline-seal SHA-256 digest;
- the state artifact's own SHA-256 digest and media type.

A checkpoint from another experiment revision cannot be silently reused. A stale snapshot is not "close enough."

V1 intentionally supports the baseline boundary only. Arbitrary after-task checkpoints require runtime restore semantics and causal slicing that should be added explicitly rather than implied.

## Branches

A V1 branch is deliberately narrow. It may replace only the **parameters** of an existing command in an `exercise` task.

It may not change:

- setup tasks;
- task dependencies;
- experiment topology;
- command names;
- required capabilities;
- adapter/provider identity;
- regime identity or digest;
- the baseline seal.

This gives Omni a meaningful controlled-variable primitive. A branch means "run this same experiment from this same state with this declared exercise variation," not "construct another arbitrary workflow and call it a replay."

## Provider pinning

The parent experiment's capability bindings are replay constraints.

If the parent used:

```text
account.exercise
      ↓
account-driver
      ↓
synthetic.account
```

then a branch cannot silently choose `alternate-account-driver`, even if that provider satisfies the same abstract capability. Provider drift would introduce a second experimental variable.

The branch compiler therefore reconstructs provider preferences from the parent Experiment IR and fails if the pinned provider is absent, changed, or no longer authorizes the original command.

## Lineage

Every compiled branch records:

- parent experiment digest;
- optional parent branch digest;
- checkpoint ID;
- baseline digest;
- state artifact digest;
- normalized declared variations;
- resulting compiled experiment;
- branch digest.

The optional parent-branch digest supports a future branch tree without making UI nesting authoritative.

```text
S0
├── B1
│   ├── B1.1
│   └── B1.2
├── B2
└── B3
```

The graph can be projected spatially in the Omni workspace, but lineage exists in the domain model first.

## Why this matters for assurance

A normal compliance test often records one outcome from one run.

State branching enables a stronger question:

> Starting from the exact same sealed system state, how does the control behave as one relevant condition changes?

For example:

```text
baseline S0
   │
   ├── standard account creation   → pass
   ├── privileged account creation → fail
   └── disabled account creation   → pass
```

Those outcomes can later bind to separate observations, evidence artifacts, assertions, and OSCAL assessment-result nodes while retaining a common experimental origin.

## Security boundary

A checkpoint URI is not executable authority.

A branch cannot request an arbitrary shell command, replace an adapter, or introduce a new capability. The existing Experiment IR and adapter authorization boundary remain intact.

This is the same design rule used throughout modern Omni:

> Higher-order behavior must reduce to canonical, capability-checked primitives rather than bypassing the authoritative execution path.

## Next slices

The natural follow-ons are:

1. runtime checkpoint adapters that can actually capture/restore supported environments;
2. branch-specific evidence namespaces and manifests;
3. arbitrary post-task checkpoints with causal eligibility rules;
4. branch comparison and sensitivity analysis;
5. spatial replay/debugger projection in the Omni UI;
6. OSCAL assessment-result serialization that retains branch lineage and evidence provenance.

## Provenance

Architectural inspiration:

- Sandia FIREWHEEL: https://sandialabs.github.io/firewheel/
- Sandia Staghorn presentation: https://www.sandia.gov/app/uploads/sites/94/2021/08/Elliott-Staghorn-Presentation.pdf

No FIREWHEEL or Staghorn source code is copied by this implementation.
