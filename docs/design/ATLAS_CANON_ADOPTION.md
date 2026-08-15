# Atlas Canon adoption in ACE Omni

ACE Omni adopts **Resilience Atlas Design Canon v4.0** as the governing interaction and rendering language for assurance work.

This is not a new Omni design system. It is an application of the existing Canon to a different evidence domain.

## Architecture boundary

```text
OSCAL  → control / implementation / assessment / remediation ontology
Omni   → execution / evidence / provenance / causality / replay
Atlas  → material / motion / age / interaction / accessibility grammar
```

The three layers must remain separate. UI code must not invent compliance meaning that belongs in OSCAL, and visual state must not become authoritative system state.

## Why the Canon fits assurance work

The Canon already requires the properties that GRC interfaces usually bolt on after the fact:

- persistent objects have provenance;
- evidence is immutable once verified;
- time and age are explicit state;
- revisions remain discoverable rather than silently replacing history;
- motion communicates lifecycle changes rather than decoration;
- accessibility is structural;
- evidence relationships are part of every component's reason to exist;
- the interface remains calm under pressure;
- corporate dashboard chrome is not the target language.

That maps directly onto OSCAL packages, evidence, assessment results, findings, risk decisions, and POA&M work.

## Material mapping

| Assurance object | Atlas physical analogy | Material |
| --- | --- | --- |
| System / assessment package | Scenario Folder / Agency Binder | Cardstock |
| Observation / evidence artifact | Evidence Card / Photograph | Paper or cardstock |
| Live or conditional state | Acetate Layer | Acetate |
| Verification / disposition | Stamp | Ink |
| Relationship / causal edge | Thread / reference tag | Thread / label |
| Historical state | Ghost annotation / aged object | Ink + Time |
| Durable attachment | Clip / pin | Metal |
| Workspace | Planning table | Wood |

These are rendering analogies only. OSCAL identifiers and Omni evidence identities remain authoritative.

## Provenance rule

Every persistent assurance object presented by Omni should be able to expose, where available:

- creation source and time;
- modification history;
- verification state;
- evidence references;
- execution / adapter provenance;
- immutable version or checksum;
- downstream actions and findings.

The first dashboard slice does not fabricate provenance fields that the API does not supply. It surfaces only the currently authoritative pinned configuration state and reserves the visual grammar for richer provenance as those data become available.

## Time / age rule

Atlas age states are presentation state, not a substitute for timestamps or freshness policy.

`fresh | light | medium | heavy`

An OSCAL evidence object may visually age only from authoritative timestamps / policy. The UI must never infer compliance status merely from visual age.

## Motion rule

Use only meaningful mechanical motion families from the Canon: fold, page turn, stamp, slide, pin, lift, stack, overlay, peel, reveal, archive.

- no decorative bounce;
- no glow for attention;
- no motion as the sole status indicator;
- respect `prefers-reduced-motion`;
- preserve focus independently from animation.

## Accessibility rule

The existing Omni accessibility baseline remains mandatory and the Atlas quality gates extend it:

- keyboard operability;
- visible focus;
- screen-reader names, roles, and states;
- redundant status encoding;
- forced-colors support;
- reduced-motion support;
- print-safe evidence views;
- no critical information encoded in color, material, age, or motion alone.

## Current implementation slice

This adoption starts by replacing generic application/dashboard chrome with:

- a wood-table workbench foundation;
- paper/cardstock shell surfaces;
- experiment packages rendered as scenario folders;
- pinned-version state rendered with an ink stamp;
- explicit material and age attributes;
- Canon timing tokens;
- print and forced-color fallbacks;
- token tests that pin the canonical material palette.

Future OSCAL graph work should use the same grammar: evidence cards, acetate live-state overlays, stamped verification, historical ghost layers, and inspectable provenance paths.

## Invariant

> If an Omni UI component cannot explain its physical analogy, lifecycle, provenance, accessibility behavior, and evidence relationship, it has not passed the Atlas Test and should not enter the assurance interface.
