# Explorable assurance

ACE Omni should not stop at drawing an assurance graph. The graph should become an **explorable explanation of the assurance case**: an operator can select an object, trace the causal/evidentiary neighborhood, replay the event history, and ask explicitly hypothetical questions without changing authoritative state.

This interaction model is inspired by Nicky Case's explorable explanations, especially:

- [LOOPY](https://ncase.me/loopy/) — causal relationships as manipulable system objects;
- [The Wisdom and/or Madness of Crowds](https://ncase.me/crowds/) — system behavior exposed by changing topology and parameters;
- [The Evolution of Trust](https://ncase.me/trust/) — rules understood through repeated consequences; and
- [Nutshell](https://ncase.me/nutshell/) — explanation expanded in place instead of forcing a context switch.

This PR adopts the interaction principle, not source code from those projects.

## Core invariant

> Exploration may change the projection, but it may not change the evidence.

The underlying `OmniWorkspaceState` remains a deterministic projection of authoritative runtime events. `traceAssurance()` and `projectCounterfactualOmission()` are pure read-only transformations over that state.

A counterfactual therefore means:

> "Show me what is causally downstream if I hypothetically remove this object."

It does **not** mean:

- delete the evidence;
- retract a finding;
- change a control assertion;
- alter replay history;
- authorize remediation; or
- make a compliance determination.

The `/omni` surface labels the mode `HYPOTHETICAL` and states that evidence, events, findings, and authorization state remain unchanged.

## Explicit causal grounding

The original spatial-workspace fixture already represented:

```text
task -> evidence
     -> claim
contradiction -> claim
 task -> finding
```

That topology was insufficient for a defensible counterfactual because the UI could not prove that the evidence caused the contradiction or that the contradiction grounded the finding.

This slice makes those relationships explicit:

```text
AWS evidence
    | supports
    v
SSP claim

AWS evidence
    | grounds
    v
contradiction
    | grounds
    v
finding
```

A `contradiction.detected` event already names the exact evidence it depends on, so the compositor may safely emit an `evidence -> contradiction` `grounds` edge.

A `finding.created` event may now declare `basisNodeIds`. Those references are fail-closed: the basis object must already exist in the reconstructed workspace before the finding event. The UI no longer needs to infer a contradiction/finding dependency from temporal proximity or task membership.

## Trace mode

`TRACE` follows typed assurance relationships in either direction from the selected visible object.

The first implementation traverses:

- `asserts`
- `supports`
- `challenges`
- `produces`
- `grounds`

It intentionally does not treat layout or selection state as causality.

For the SC-7 fixture, tracing downstream from the AWS security-group evidence reveals the affected claim, contradiction, and grounded finding.

## What-if mode

`WHAT IF: OMIT` starts at the selected visible object and follows causal edges downstream. It returns:

- the hypothetically omitted object id;
- affected downstream object ids; and
- affected causal edge ids.

It never removes an object from `workspace.nodes`, never removes an event from `workspace.events`, and never changes the authoritative revision.

The UI expresses the result by dimming unrelated objects, marking the selected object as hypothetically omitted, and highlighting downstream impact.

## Why this matters for OSCAL

OSCAL can provide the authorization-package ontology while Omni supplies runtime causality and evidence:

```text
OSCAL control / objective
        -> implementation claim
        -> assessment task
        -> canonical Omni execution
        -> observation / evidence
        -> assertion / contradiction
        -> finding / risk
        -> remediation / POA&M
```

The useful interface is not a table of those objects. It is a workspace in which an assessor can enter that chain anywhere, traverse it, inspect its provenance, replay how it formed, and test hypothetical dependency changes without confusing the hypothetical view with the authoritative record.

## Security and governance boundary

This layer has no adapter, command, mutation, or authorization capability.

It cannot mint execution authority and does not create a second GRC execution path. Any future action launched from an exploration must still lower into canonical Omni commands and pass the normal capability/adapter authorization boundary.

## Tests

Focused tests cover:

1. deterministic downstream trace from SC-7 evidence through contradiction and finding;
2. counterfactual evidence omission with the authoritative workspace left byte-for-byte equivalent;
3. rejection of exploration references outside the current visible projection; and
4. fail-closed finding basis references.

## Next slices

- Load the normalized OSCAL assurance graph from the separate OSCAL branch into the same interaction grammar.
- Add in-context progressive disclosure for control -> claim -> objective -> evidence -> finding.
- Preserve exploration operations as shareable, non-authoritative view state.
- Add branch comparison after the state-checkpoint work lands, while keeping counterfactual projection distinct from executable experiment branching.
