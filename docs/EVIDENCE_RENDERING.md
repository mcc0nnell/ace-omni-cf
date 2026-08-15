# Evidence Rendering — shareable assurance artifacts

Status: **first vertical slice implemented**

ACE Omni already has authoritative machine-readable evidence: pinned experiment identity, canonical commands, ordered observations, immutable evidence manifests, checksums, and replay. Human reviewers need a presentation layer over those records, but that layer cannot become a second source of truth.

The governing invariant is:

> **Rendering may explain evidence. Rendering may never become evidence authority.**

## Carbon as the architectural reference

[Carbon](https://github.com/carbon-app/carbon) is useful as a pattern rather than a dependency. It separates structured source from presentation configuration and produces a portable artifact while preserving a route back to source.

Omni applies the same boundary to evidence:

```text
canonical Omni object
        ↓
source-path projection builder
        ↓
disclosure policy
        ↓
EvidenceProjection
        ↓
integrity verification
        ↓
renderer profile
        ↓
semantic HTML / accessible SVG
```

The renderer behaves more like a compiler target than a dashboard screenshot.

## Naming

`@ace-omni/domain` already has an `EvidenceArtifact` contract for stored evidence objects such as audio, video, captions, schedules, and configuration snapshots.

The human-review envelope is therefore named **`EvidenceProjection`**. A projection is derived, bounded, portable, and non-authoritative.

## Authority boundary

The renderer MUST NOT:

- assign or reinterpret a verdict;
- choose which sensitive fields are disclosed;
- hide failure, unknown, or review-required state through profile configuration;
- invent values that are not bound to canonical source paths;
- mutate experiment, run, assessment, control, or evidence state;
- treat an export as sufficient proof when the canonical record is unavailable.

The renderer MAY:

- format authoritative values for readability;
- apply a named visual profile;
- emit semantic HTML and SVG;
- include source identifiers, digests, and approved source links;
- expose provenance and trace information;
- visually distinguish status as long as meaning never depends on color alone.

## Projection construction

`buildEvidenceProjection()` takes three inputs:

1. an authoritative source object;
2. a projection specification made of source paths;
3. a disclosure policy.

Dynamic display values are never supplied independently. The builder dereferences them from the authoritative object. This keeps the human-readable projection mechanically tied to source data.

Example:

```ts
import {
  buildEvidenceProjection,
  renderEvidenceHtml,
} from "@ace-omni/domain/evidence-rendering";

const projection = await buildEvidenceProjection(authoritativeResult, {
  artifactType: "control-result",
  source: {
    recordType: "assessment-result",
    recordIdPath: "meta.recordId",
    runIdPath: "meta.runId",
  },
  subject: {
    type: "oscal-control",
    idPath: "control.id",
    titlePath: "control.title",
  },
  result: {
    statusPath: "result.status",
    summaryPath: "result.summary",
  },
  facts: [
    { label: "MFA", valuePath: "evidence.mfa" },
  ],
}, {
  disclosureClass: "internal",
  blockedSourcePaths: ["participant.rawIdentifier"],
});

const html = await renderEvidenceHtml(projection);
```

## Field-level provenance

Every displayed dynamic field receives an `EvidenceFieldBinding` containing:

- the projection path;
- the canonical source path;
- the canonical source digest.

The schema rejects projections missing required bindings. That includes subject identity, verdict, summary, dynamic facts, trace entries, and any displayed provenance fields.

Bindings make the question "where did this value come from?" answerable without treating the rendered card itself as authority.

## Redaction and disclosure

Disclosure is upstream of rendering.

`EvidenceProjectionPolicy` controls:

- `public`, `internal`, or `restricted` classification;
- whether a canonical source locator may travel with the projection;
- which source paths are blocked.

Blocked optional facts or trace entries are omitted before `EvidenceProjection` exists. A blocked field cannot remain hidden in CSS, metadata, SVG text, or DOM because it is never passed to the renderer.

If policy blocks a field required to state the authoritative result — for example the verdict itself — projection construction fails rather than producing an ambiguous card.

Renderer profiles have no redaction or field-disclosure controls.

## Deterministic identity

Omni canonicalizes JSON before hashing by recursively sorting object keys and preserving array order.

The implementation separates four identities:

```text
sourceDigest      = digest(canonical authoritative source)
projectionDigest  = digest(EvidenceProjection without projectionDigest)
profileDigest     = digest(renderer profile)
renderDigest      = digest(rendered bytes)
```

This distinguishes:

- the thing being proven;
- the bounded human-readable projection;
- the presentation rules;
- the particular exported file.

Changing a theme changes profile/render identity without changing evidence or projection identity.

## Integrity verification

The public package export is intentionally sealed behind verification.

Before HTML or SVG rendering, Omni recomputes `projectionDigest` and rejects a projection that was altered after construction.

Server-side consumers may additionally call `verifyEvidenceProjectionAgainstSource()` to recompute the authoritative source digest and prove that the projection still corresponds to the supplied canonical object.

This does not make a projection authoritative. It proves that the derived artifact has not drifted from the source and projection state it claims to represent.

## Artifact vocabulary

The first slice supports:

### `control-result`

A human-readable control, assertion, objective, or assessment result.

### `finding`

A failed, partial, ambiguous, or review-required result. Failure state receives the same structural prominence as success state.

### `execution-trace`

A bounded sequence of commands, observations, transitions, and terminal outcome. This is suitable for proving that higher-order authoring lowered into canonical Omni commands and passed through ordinary capability checks.

Future projection types may include evidence-bundle summaries, replay proofs, and standalone provenance cards without changing the authority model.

## Renderer profile

The first built-in profile is:

```text
assurance-card/v1
```

It controls only presentation:

- light/dark treatment;
- compact/comfortable density;
- compact/expanded provenance treatment.

It cannot suppress evidence, alter semantics, choose disclosure fields, or reclassify result states.

## Outputs

### Semantic HTML

HTML uses semantic headings, lists, definition lists, links, status text, and accessible labels. Dynamic content is escaped before insertion.

### SVG

SVG exports include:

- `role="img"`;
- `<title>` and `<desc>`;
- textual status labels and symbols;
- source and projection digests;
- disclosure class.

Status is never encoded by color alone.

## Validation

The focused evidence-rendering suite verifies:

1. canonical object ordering produces stable hashes;
2. displayed values are derived from authoritative source paths;
3. every dynamic field receives a source binding;
4. blocked values do not survive in projection, HTML, or SVG;
5. required verdict fields cannot be redacted into ambiguity;
6. renderer profiles cannot hide semantic state;
7. equivalent source/projection/profile inputs render deterministically;
8. profile changes do not change evidence identity;
9. forbidden source links are omitted;
10. tampered projections are rejected before rendering;
11. projections can be checked against the original authoritative source.

A dedicated `evidence-rendering-validation` workflow typechecks and tests `@ace-omni/domain` independently. The repository-wide validation currently still fails earlier on the pre-existing dependency audit inherited from `main`; this feature introduces no dependency changes.

## What was borrowed from Carbon

Borrowed:

- source separated from presentation configuration;
- explicit named presentation state;
- one canonical render path;
- portable outputs;
- preservation of a route back to source.

Not borrowed:

- authority semantics;
- disclosure policy;
- provenance requirements;
- deterministic source/projection identities;
- evidence-specific accessibility and tamper checks.

The useful lesson remains the boundary:

> **Machine-readable truth can compile into a human-readable artifact without ceasing to be machine-readable truth.**
