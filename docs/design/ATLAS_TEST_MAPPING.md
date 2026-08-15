# Atlas Test mapping — assurance UI slice

This records the six-question Atlas Test for the first ACE Omni assurance-workbench slice.

| Atlas Test question | Answer for this slice |
| --- | --- |
| Physical artifact | Planning table containing scenario folders, evidence marks, and archival surfaces. |
| Purpose | Let a researcher or assessor locate durable experiment packages and inspect immutable version state without generic dashboard abstractions. |
| Lifecycle | Experiment package is created, versioned, executed, evidenced, reviewed, and retained. Rendering may age; authoritative history remains in Omni/OSCAL state. |
| Provenance | The UI surfaces only provenance/state actually supplied by the system. The current slice exposes pinned configuration version and does not invent creator/timestamp metadata. |
| Accessibility | Keyboard and visible focus, redundant text labels, reduced motion, forced colors, touch target minimum, print path, and no status conveyed by color/material/motion alone. |
| Evidence | Folder surfaces lead to the experiment package; pinned-state marking identifies the immutable configuration boundary that anchors downstream evidence and replay. |

## Counterexamples rejected

- KPI card grids with no physical/evidence analogy.
- Decorative animated charts.
- Neon/glowing status treatment.
- Fabricated provenance to make the interface appear richer.
- Visual age used as a substitute for authoritative timestamps or policy.
- Color-only risk or status encoding.
