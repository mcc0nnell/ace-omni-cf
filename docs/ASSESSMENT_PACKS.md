# Assessment packs

Assessment packs are ACE Omni's executable bridge between a compiled **Regime** and the existing adapter execution plane.

The concept is deliberately descended from 14ten's `scan_and_evaluate` pipeline. The old accessibility harness separated collection from evaluation: scanners emitted evidence, evaluator plugins converted evidence into control assertions, and policy decided whether those assertions gated the build. Omni generalizes that shape without preserving a web- or accessibility-specific runtime.

## Boundary

```text
authority / OSCAL / regulation / policy
                  ↓
          compiled effective Regime
                  ↓
             assessment pack
                  ↓
       collect/evaluate dependency DAG
                  ↓
        PlannedCommandDefinition
                  ↓
        normal Omni capability checks
                  ↓
             adapters / humans
                  ↓
        observations + evidence
                  ↓
              assertions
                  ↓
             gate decision
```

An assessment pack does not execute commands itself. Every runnable task embeds the same `PlannedCommandDefinition` consumed by the existing execution engine. This preserves the architectural invariant that governance cannot bypass adapter capability checks.

## Runtime bindings

Regime controls intentionally name domain capabilities such as `config.read`, `log.read`, `human.review`, or `grc.evaluate`. Those names describe what the assessment requires; they do not pick a product or runtime.

An assessment pack binds each required regime capability to:

- an Omni adapter id;
- one of Omni's declared adapter capability classes;
- a canonical operation name; and
- optional JSON parameters.

Bindings are explicit and unique per assessment target. Ambiguous duplicate routing fails closed.

## Compilation

`compileAssessmentPack()` (also exported as `compileScanAndEvaluatePlan()` to preserve the 14ten lineage) deterministically compiles the effective regime into two task phases:

1. **collect** — satisfy evidence requirements through mapped producer capabilities;
2. **evaluate** — invoke regime evaluator bindings after their evidence dependencies are satisfied.

The resulting plan is content-addressed with SHA-256. Reordering authored runtime bindings cannot change the semantic plan or digest.

Compilation fails when:

- the pack is bound to a different effective-regime digest;
- a non-excluded control has no evaluator;
- required evidence is not consumed by any evaluator;
- an evidence requirement has no mapped producer capability;
- an evaluator capability has no runtime mapping; or
- one regime capability is ambiguously routed to multiple runtime bindings.

## Gate decision

`evaluateAssessmentGate()` validates assertions against the exact effective regime before applying each control's decision semantics.

A control with no assertion remains `needs_review`. It is never promoted to `pass` merely because no evaluator produced a result.

The aggregate decision is:

- `block` when any control's configured gate condition is met;
- `needs_review` when nothing blocks but unresolved controls remain; or
- `allow` only when the regime's active controls are resolved without a gate condition.

This keeps *assessment status* separate from *gate effect*. A regime may deliberately allow `needs_review` to proceed while still preserving that unresolved epistemic state in the record.

## The 14ten lineage

14ten described a ten-part model:

`Signal → Envelope → Taxonomy → Normalization → Pipeline → Rule → Routing → State → Evidence → Assertion`

Omni already has observation envelopes, durable evidence, execution plans, adapter capabilities, and replay. The useful inheritance is therefore conceptual rather than a wholesale port:

- **Signal / Envelope** → Omni observations and authenticated evidence envelopes;
- **Taxonomy / Normalization** → typed adapter observations and canonical graph semantics;
- **Pipeline / Routing** → assessment DAG plus canonical Omni commands;
- **Rule** → Regime evaluator bindings and deterministic evaluators;
- **State** → derived assessment/run state, never a replacement for source evidence;
- **Evidence** → content-addressed ledger artifacts;
- **Assertion** → regime-bound control assertions;
- **Gate** → explicit governance consequence applied after assertions.

The result is the same architectural idea at a different scale: observations do not become compliance facts until an explicit authority model interprets them, and that interpretation remains traceable to the exact evidence and regime that produced it.
