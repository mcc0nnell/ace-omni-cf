# Accessibility GRC on OSCAL

This directory is the first ACE Omni reference implementation of accessibility as a first-class OSCAL control domain.

## Core invariant

> Accessibility is represented with standard OSCAL artifacts and lifecycle semantics. Omni may execute, normalize, evidence, replay, and visualize assessments, but it must not create a parallel accessibility compliance model.

The governing path is:

```text
Section 508 / WCAG authority
          ↓
    OSCAL Catalog
          ↓
    OSCAL Profile
          ↓
Component Definition / SSP implementation claims
          ↓
    Assessment Plan
          ↓
 Omni execution + evidence
          ↓
   Assessment Results
          ↓
        POA&M
```

OSCAL supplies the control, implementation, assessment, and remediation vocabulary. Omni supplies execution, provenance, deterministic replay, and causal graphing.

## What is in this slice

- `accessibility-assurance-catalog.json` — an **experimental** OSCAL Catalog containing the initial `AX` accessibility-assurance control family.
- `federal-ict-profile.json` — an OSCAL Profile selecting the complete initial `AX` family for federal ICT.
- `omni-accessibility-component-definition.json` — an OSCAL Component Definition showing how Omni can make implementation claims against those controls without inventing a new schema.
- `scripts/run-accessibility-oscal-conformance.mjs` — a fail-closed conformance test proving the artifacts are selected, implemented, and normalized through the existing OSCAL graph path.

The initial `AX` controls cover the GRC lifecycle around accessibility:

| Control | Purpose |
| --- | --- |
| `AX-1` | Accessibility applicability and scope |
| `AX-2` | Implementation traceability |
| `AX-3` | Reproducible assessment evidence |
| `AX-4` | Findings and remediation |
| `AX-5` | Continuous accessibility monitoring |

These are **candidate assurance controls**, not a replacement for the technical requirements in the Revised Section 508 Standards or WCAG. The next content layer can represent the applicable Section 508/WCAG technical requirements as OSCAL controls and profiles, with source traceability back to the authoritative publications.

## Authority boundary

This content is experimental ACE Omni reference material. It is not an official publication of NIST, the U.S. Access Board, GSA, or W3C and must never be presented as one.

The current federal legal/technical baseline remains the Revised Section 508 Standards, including their incorporation of WCAG 2.0 Level A and AA requirements and the applicable exceptions and scoping rules. Source publications remain authoritative; this catalog is machine-readable governance content built around them.

OpenACR/ACR material, automated scanner output, manual test reports, assistive-technology test records, screenshots, traces, and similar artifacts are evidence inputs. They do not replace the governing OSCAL control model.

## Design rule

Do not add an `AccessibilityRegime`, `AccessibilityFinding`, or bespoke accessibility evidence schema to Omni merely because accessibility is the subject matter. If OSCAL already has the model — Catalog, Profile, Component Definition, SSP, Assessment Plan, Assessment Results, or POA&M — use the OSCAL model.
