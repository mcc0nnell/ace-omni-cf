# Evidence Rendering — shareable assurance artifacts

Status: **design proposal**

ACE Omni already has the authoritative pieces required for trustworthy evidence: pinned experiment identity, canonical commands, correlated observations, ordered evidence, immutable finalization, and replay. What it lacks is a first-class presentation layer that can turn those machine-readable records into artifacts a human can understand, share, embed, or review without weakening the provenance chain.

This document proposes an **Evidence Renderer**: a deterministic presentation layer over canonical Omni evidence.

The core rule is simple:

> **Rendering may explain evidence. Rendering may never become evidence authority.**

## Inspiration: Carbon's source-to-artifact boundary

[Carbon](https://github.com/carbon-app/carbon) is useful here as an architectural reference, not as a dependency to import wholesale.

Carbon accepts structured source, applies configurable presentation state, renders a deterministic visual artifact, and supports sharing or embedding that artifact while preserving a path back to the underlying source. Its value to Omni is the pattern:

```text
structured source
    + presentation configuration
             ↓
       rendered artifact
             ↓
      share / embed / export
             ↓
       source remains available
```

For Omni, replace source code with canonical evidence:

```text
canonical Omni evidence
    + renderer profile
             ↓
      Evidence Artifact
             ↓
   SVG / PNG / HTML / print
             ↓
 canonical source + provenance
```

The renderer is therefore closer to a compiler target than a dashboard screenshot.

## Why this matters for assurance and GRC

OSCAL, assessment results, experiment traces, adapter decisions, observation envelopes, checksums, and replay records are strong machine interfaces. They are not automatically strong review interfaces.

A reviewer often needs a compact answer to questions such as:

- What control, test, or assertion was evaluated?
- What was the authoritative input?
- What actually happened?
- What evidence supports the result?
- What runtime or adapter produced the observation?
- Is the artifact complete, partial, stale, superseded, or unverifiable?
- Can I get back to the canonical machine-readable record?

A rendered evidence artifact should answer those questions without inventing a second source of truth.

## Authority boundary

The Evidence Renderer MUST NOT:

- assign a verdict that is absent from authoritative evaluation state;
- reorder evidence in a way that changes its meaning;
- suppress failed assertions while presenting a successful summary;
- invent human-readable values that cannot be traced to canonical fields;
- mutate experiment, assessment, run, control, or evidence state;
- treat a screenshot, export, or cached card as sufficient proof of the underlying record.

The Evidence Renderer MAY:

- select a bounded view of an authoritative record;
- format timestamps, identifiers, digests, and structured values for readability;
- apply a named presentation profile;
- generate accessible SVG, HTML, PNG, or print/PDF-oriented output;
- embed canonical identifiers, digests, and source links;
- visually distinguish authoritative facts from commentary or interpretation.

This preserves the Omni invariant that **presentation is not authority**.

## Evidence Artifact model

A rendered artifact should be derived from an explicit artifact envelope rather than arbitrary UI state.

```json
{
  "artifactVersion": "1",
  "artifactType": "control-result",
  "source": {
    "kind": "omni-evidence",
    "runId": "run_01K...",
    "evidenceId": "ev_01K...",
    "sequence": 42,
    "digest": "sha256:5ea8..."
  },
  "subject": {
    "type": "oscal-control",
    "id": "AC-2",
    "title": "Account Management"
  },
  "result": {
    "status": "pass",
    "summary": "Privileged account controls satisfied the bound assessment assertions."
  },
  "provenance": {
    "experimentVersionId": "expv_01K...",
    "adapterId": "ibm-oscal",
    "rendererProfile": "assurance-card/v1"
  }
}
```

The envelope is a **projection descriptor**. The authoritative values remain in the referenced Omni record.

## Artifact types

The initial vocabulary should remain deliberately small.

### Control result

Human-readable representation of a control, objective, assertion, or assessment result.

Typical content:

- control/assertion identity;
- result and evaluation time;
- bound evidence references;
- source adapter/runtime;
- canonical digest;
- link back to the authoritative record.

### Finding

A failed, partial, ambiguous, or review-required result.

A finding artifact must make failure state at least as visually prominent as success state and must not collapse `unknown`, `not-applicable`, `not-tested`, and `failed` into one generic state.

### Execution trace

A bounded sequence of commands, observations, transitions, and terminal outcome.

Useful for proving that higher-order authoring lowered into canonical commands and passed through ordinary adapter capability checks.

### Evidence bundle summary

A compact index over a finalized evidence manifest or authorization package.

### Replay proof

A representation of pinned input identity, replay target, output identity, and equivalence or divergence result.

### Provenance card

A small artifact intended to travel with another export. It answers: **what canonical thing produced this?**

## Visual grammar

A Carbon-like renderer works because visual state is explicit. Omni should do the same with a constrained **renderer profile** rather than arbitrary CSS.

A profile may define:

- typography scale;
- density;
- spacing;
- window/card treatment;
- light/dark presentation;
- code/data syntax presentation;
- status iconography;
- export dimensions;
- organization branding when allowed;
- redaction presentation rules;
- whether provenance is compact, expanded, or both.

A profile must not redefine semantic status colors in a way that makes results misleading. Status also must never depend on color alone.

## Example assurance card

```text
┌──────────────────────────────────────────────────────┐
│ AC-2  ACCOUNT MANAGEMENT                    PASS ✓   │
│                                                      │
│ Source: SSP §9.3                                     │
│ Evaluator: omni/oscal                                │
│ Adapter: IBM OSCAL                                   │
│ Run: 01K2...                                         │
│                                                      │
│ Evidence                                             │
│ ──────────────────────────────────────────────────── │
│ MFA required for privileged accounts                 │
│ ✓ configuration observed                             │
│ ✓ implementation statement matched                  │
│ ✓ evidence checksum verified                         │
│                                                      │
│ SHA256  5ea8...                                      │
└──────────────────────────────────────────────────────┘
```

The card is useful because it is readable. It is trustworthy only because each displayed assertion is traceable to canonical evidence.

## Source-backlink requirement

Every shareable artifact MUST preserve a path back to the canonical record when the deployment permits it.

For interactive HTML this should be a direct link.

For static SVG/PNG/print output, the artifact should include at least:

- canonical artifact/evidence identifier;
- digest or short digest;
- human-readable source locator or QR/deep-link when appropriate;
- renderer profile/version.

If the canonical source is not externally accessible, the artifact should say so rather than imply public verifiability.

## Accessibility requirements

Evidence rendering is part of the assurance surface and must itself be accessible.

At minimum:

- semantic HTML for interactive artifacts;
- useful text alternatives for exported visual artifacts;
- status conveyed by text/iconography as well as color;
- sufficient contrast;
- keyboard-operable source/provenance controls;
- scalable text without loss of information;
- no essential evidence encoded only spatially;
- predictable reading order;
- generated SVG that retains meaningful text when practical rather than flattening everything into paths.

For a system that may evaluate accessibility compliance, inaccessible evidence presentation would be an own-goal.

## Determinism and reproducibility

Two renders from the same artifact envelope and renderer profile version should be semantically equivalent.

Where byte-for-byte reproducibility is practical, prefer it. Where platform font/rendering differences prevent exact bytes, preserve deterministic content identity separately from presentation bytes.

Recommended identities:

```text
sourceDigest      = digest(canonical evidence)
projectionDigest  = digest(artifact envelope)
profileDigest     = digest(renderer profile)
renderDigest      = digest(export bytes)   // optional / format-specific
```

This lets Omni distinguish:

- the thing being proven;
- the bounded human-readable projection;
- the presentation rules;
- the particular exported file.

## Security and redaction

Evidence cards are unusually easy to forward outside their original context. The renderer therefore needs explicit disclosure and redaction behavior.

A renderer profile should be able to declare:

- public / internal / restricted presentation class;
- which fields are displayable;
- whether participant identifiers are pseudonymized;
- whether raw observations may be shown;
- whether source links require authentication;
- whether generated exports receive a visible classification/banner treatment.

Redaction must occur before rendering. Hiding values with CSS is not redaction.

## Proposed implementation boundary

The first implementation should be small and dependency-light:

```text
canonical Omni object
        ↓
projection builder
        ↓
EvidenceArtifact envelope
        ↓
renderer profile
        ↓
React/SVG/HTML renderer
        ↓
interactive view or export
```

The renderer should consume already-normalized Omni objects. It should not know how to query OSCAL, interpret SIP, evaluate a control, or decide an experiment verdict.

Those remain upstream responsibilities.

## First vertical slice

A useful first slice would implement three artifact types:

1. `control-result`
2. `finding`
3. `execution-trace`

with one built-in profile:

`assurance-card/v1`

and two outputs:

- semantic HTML for the Omni UI;
- SVG export for portable sharing.

PNG can be derived later from the SVG/HTML render path rather than becoming the canonical output.

## Acceptance criteria

The first renderer should prove these properties:

1. identical source + artifact envelope + profile produces semantically identical output;
2. every displayed result is traceable to an authoritative source field;
3. rendered artifacts cannot mutate source state;
4. failure/unknown states cannot be hidden by profile configuration;
5. source identity and digest are present in portable exports;
6. exported artifacts have usable accessible equivalents;
7. profile changes alter presentation identity without altering evidence identity;
8. redacted exports contain no redacted source values in markup, metadata, or hidden DOM;
9. a renderer can display OSCAL-oriented assurance results without becoming OSCAL-specific;
10. the same renderer can display non-GRC experiment evidence.

## What to borrow from Carbon — and what not to

Borrow the architectural ideas:

- structured source separated from presentation configuration;
- a single canonical render surface;
- named customization state;
- multiple export/share paths;
- preservation of access to underlying source;
- portable visual artifacts that are useful outside the authoring UI.

Do **not** make Carbon itself an architectural dependency. Omni needs stronger provenance, deterministic identity, redaction, accessibility, and authority boundaries than a code-image tool was designed to provide.

The useful lesson is the boundary:

> **Machine-readable truth can compile into a human-readable artifact without ceasing to be machine-readable truth.**

That is the presentation layer Omni needs for automated assurance.