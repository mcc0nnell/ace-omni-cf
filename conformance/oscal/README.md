# OSCAL graph conformance

This directory defines ACE Omni's first OSCAL graph-conformance boundary.

The goal is not to build an OSCAL editor or copy NIST content into Omni. The goal is to prove that a real, maintained OSCAL authorization-package corpus can be projected into a deterministic assurance graph that later runtimes and UIs can consume.

## Source corpus

CI checks out `usnistgov/oscal-content` at the exact commit recorded in `fixtures.json` and reads four JSON artifacts from NIST's IFA examples:

- System Security Plan (SSP)
- Assessment Plan (AP)
- Assessment Results (AR)
- Plan of Action and Milestones (POA&M)

The upstream repository is a United States Government work and is also dedicated under CC0 1.0. Omni keeps the corpus external and pinned rather than vendoring it.

## Contract

`npm run test:oscal` loads the selected IFA package and derives one normalized graph.

The graph contains:

- UUID-backed OSCAL objects as typed nodes;
- canonical `control:<id>` nodes for control references;
- explicit external-reference nodes for non-fragment `href` targets;
- `contains` edges for object containment;
- `addresses` edges for `control-id` relationships;
- `references` edges for UUID and fragment references;
- `imports` edges for OSCAL import links.

The normalized representation sorts nodes, edges, kinds, paths, and document metadata so authored file order or fixture load order cannot become semantic state.

## Assertions

The conformance runner requires:

1. all four selected NIST model roots to parse;
2. the graph to contain implementation, component, observation, finding, risk, and control objects;
3. containment, control-addressing, reference, and import edges to exist;
4. local fragment references to resolve inside their source document;
5. the same package loaded in reverse order to produce byte-equivalent canonical graph semantics;
6. a deliberately broken local fragment reference to fail closed.

A successful run writes the normalized graph plus a SHA-256 semantic digest to `conformance/generated/oscal/ifa-graph.json`. The generated directory is already ignored by git and preserved by the existing CI evidence artifact.

## Architectural boundary

OSCAL provides the ontology. Omni adds execution, evidence provenance, causality, and replay. The spatial workspace may later project this graph, but the graph contract does not depend on the web UI.

```text
NIST OSCAL package
       ↓
normalized assurance graph
       ↓
Omni execution / evidence overlays
       ↓
Mission · Evidence · Investigation · Replay projections
```

The graph is therefore an input to the compositor, not a drawing produced by it.
