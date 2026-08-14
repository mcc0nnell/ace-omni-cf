# Regimes in ACE Omni

ACE Omni treats a **regime** as the authoritative evaluative context under which evidence acquires compliance meaning.

This abstraction comes from the earlier 14ten architecture, where the evaluator accepted a first-class regime pack separately from sensors and policy. In Omni, the concept is generalized beyond accessibility and made composable.

## Boundary

A regime is **not** a scanner, adapter, evaluator, or UI projection.

- OSCAL and other authoritative sources describe requirements and assurance structure.
- A regime binds those authorities into an effective set of applicable controls, evidence requirements, evaluator bindings, and decision semantics.
- Omni executes canonical commands through capability-checked adapters.
- Sensors and adapters emit observations and artifacts.
- Evaluators interpret that evidence under the exact compiled regime.
- Assertions are bound to the effective regime digest and retain evidence provenance.

The resulting chain is:

```text
authority / OSCAL / regulation / policy
                  ↓
              regime layers
                  ↓
        compiled effective regime
                  ↓
       controls + evidence needs
                  ↓
      evaluator / adapter bindings
                  ↓
        canonical Omni commands
                  ↓
        observations + artifacts
                  ↓
             assertions
                  ↓
       findings / GRC decisions
```

## Why the regime is separate from OSCAL

OSCAL supplies a strong machine-readable ontology for catalogs, profiles, system security plans, assessment plans, assessment results, and POA&M data. Omni's OSCAL conformance graph normalizes those artifacts into deterministic assurance topology.

The Regime abstraction sits one level above that topology. It can bind OSCAL sources together with non-OSCAL authorities such as statutes, regulations, standards, contracts, agency policy, and system-specific requirements. It also carries execution-specific information that an OSCAL document does not itself execute: evidence requirements, adapter capabilities, canonical command bindings, and gating semantics.

A future federal system could therefore compile an effective regime from layers such as:

```text
NIST / FedRAMP baseline
        +
agency overlay
        +
FCC-specific requirements
        +
Section 508 / accessibility requirements
        +
system-specific policy
```

The compiler does not claim that any example layer is itself a complete or authoritative implementation of those regimes. Authoritative content must be imported from pinned source material and its provenance retained.

## V1 compiler invariants

`@ace-omni/domain/regime` implements a small fail-closed kernel.

### Deterministic composition

Layers are normalized and ordered by `precedence`, then stable layer ID. Control arrays, source references, evidence requirements, evaluator bindings, and gating status arrays are normalized before hashing. Reordering semantically identical input therefore produces the same effective regime and SHA-256 digest.

### Explicit overrides

A control can be introduced only with `mode: define`. A later layer cannot silently redefine it. It must use `mode: override` or `mode: exclude`, and the layer must have strictly higher precedence.

This makes overlays visible in provenance instead of permitting last-write-wins ambiguity.

### Resolved imports

Every declared layer import must be present in the compilation input, and the importing layer must have higher precedence than the imported layer. Missing or inverted dependencies fail compilation.

### Provenance survives composition

Every effective control retains the ordered sequence of `define`, `override`, and `exclude` operations that produced it, including source references and layer identity.

### Missing evidence is not a pass

Evidence readiness is separate from evaluation. `checkControlEvidenceReadiness()` reports only:

- `ready`
- `needs_review`
- `not_applicable`

It does not produce a compliance pass. A `pass` assertion is rejected unless every required evidence requirement for that control is satisfied.

This preserves the 14ten principle that absence of evidence cannot be laundered into evidence of compliance.

### Assertions bind to an exact regime

A control assertion carries both `regimeId` and the compiled `regimeSha256`. An assertion from a different effective regime cannot be replayed as though it were valid under the current one.

## Relationship to Omni execution

Regime evaluator bindings contain a required adapter capability and canonical command name. They are instructions for later compilation into the same authoritative execution path used elsewhere in Omni; they are not an alternate execution mechanism.

The core invariant remains:

> Higher-order governance behavior must compile into canonical Omni commands rather than bypassing adapter capability checks or the evidence ledger.

## Next slices

The intentionally narrow V1 compiler establishes semantics before integration. Natural follow-on work is:

1. bind OSCAL graph control nodes from the pinned conformance corpus into regime layers;
2. compile evidence requirements into executable Omni assessment tasks;
3. emit assertion and finding nodes back into the assurance graph;
4. serialize assessment results and findings to OSCAL-compatible artifacts;
5. project the effective regime, evidence flow, unresolved review states, and findings into the spatial Omni UI.

At that point the UI is no longer drawing a compliance diagram. It is projecting a regulatory regime executing against a system.
