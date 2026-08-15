# Atlas-inspired operator substrate

Status: **experimental / stacked on the Omni spatial workspace**

This note records the architectural ideas adopted after reviewing Sandia's `atlas-ui-3` Agent Portal and the boundary ACE Omni keeps deliberately different.

No Atlas source code is copied. The implementation adopts the operator-surface pattern — panes, groups, bundles, budgets, audit tags, and an executor seam — while preserving Omni's existing authority model.

## The useful idea

Atlas UI 3 demonstrates that an agent/operator cockpit can be built from a small set of durable primitives:

- multiple live panes;
- named groups of related work;
- reusable bundles/presets;
- resource budgets;
- explicit sandbox/executor identity;
- persistent layout state;
- synchronized operator actions;
- an append-only audit trail.

Those primitives are useful even when the thing inside a pane is not a Unix process.

For Omni, a pane is an **execution context projection** over an already-authoritative object. It can represent an assessment task, an adapter, a capability binding, evidence analysis, a contradiction, a finding, or a human approval gate.

## Critical divergence from Atlas Agent Portal

Atlas's dev-preview Agent Portal ultimately launches host commands. That is appropriate for its current single-developer preview, but it is not the authority model Omni wants.

Omni must preserve this path:

```text
intent
  -> higher-order expansion
  -> canonical Omni command
  -> capability / adapter authorization
  -> execution
  -> observation
  -> evidence
```

The operator surface must never create a second path such as:

```text
pane
  -> arbitrary command / shell / cwd / env
  -> effect
```

For that reason `OmniOperatorContext` deliberately contains only bindings and display/governance metadata:

- authoritative `sourceObjectId`;
- governance `groupId`;
- `executor` identity;
- `adapterId`;
- required `capability`;
- status;
- optional `auditTag`.

The runtime validator explicitly rejects command-shaped fields including `command`, `args`, `argv`, `cwd`, `env`, `script`, `executable`, and `shell`.

## Operator manifest

The first manifest version has three first-class objects.

### Context

A context is one pane-worthy governed execution object. It must bind to an object that already exists in the authoritative Omni event history at the current revision.

A context does not grant its adapter or capability. It only records the binding the authoritative runtime has already established.

### Group

A group is a governance envelope over contexts. It can carry:

- exact context membership;
- maximum concurrency;
- memory budget;
- CPU budget;
- audit tag.

Membership is checked in both directions. A context cannot claim a group that does not claim the context, and a group cannot hide undeclared or unknown contexts.

### Bundle

A bundle is a named collection of contexts inside exactly one group. It is an operator convenience, not a way to cross a governance boundary. A bundle that references a context from another group fails validation.

## Layout is not authority

The supported layout vocabulary intentionally mirrors the useful Atlas pane shapes:

- `single`
- `2x2`
- `3x2`
- `focus+strip`

Layout and preferred pane order are presentation state only. Rearranging the deck cannot change:

- authoritative source identity;
- adapter identity;
- capability binding;
- group membership;
- status;
- audit tag.

The tests explicitly rearrange the same four SC-7 contexts and require those bindings to remain unchanged.

## SC-7 fixture

The spatial-workspace SC-7 demo now has an operator manifest describing one assessment cell:

```text
group:sc7-assessment
  audit tag: oscal:SC-7
  max concurrent: 3
  memory: 1024 MB
  CPU: 100%

  context:ssp-claim
    -> claim:ssp-sc7-1
    -> regime-evaluator / control.claim.read

  context:aws-evidence
    -> evidence:aws-sg-0a41
    -> aws-ec2 / config.security-group.read

  context:contradiction
    -> contradiction:sc7-public-admin
    -> assurance-graph / evidence.contradiction.evaluate

  context:finding
    -> finding:finding-sc7-001
    -> human-approval / finding.review
```

The final context is deliberately `blocked`: the operator surface can show that a human decision is required without pretending that the interface itself can satisfy the gate.

## Relationship to the other Omni branches

This PR is stacked on the spatial workspace because it is primarily an operator-surface contract.

It is intentionally not coupled yet to the OSCAL / Regime / Experiment IR stack. Once those branches land, the expected binding is:

```text
OSCAL / authority
       ↓
compiled Regime
       ↓
Experiment IR
       ↓
canonical commands + provider bindings
       ↓
operator manifest projection
       ↓
panes / groups / bundles / spatial debugger
```

The Experiment IR remains authoritative. The operator manifest is a projection suitable for humans.

## Next slice

The next UI step can render `OmniOperatorDeck` as a real multi-pane control surface inside `/omni`:

- one pane per context;
- group boundaries visible spatially;
- budget and audit status in pane chrome;
- executor/adapter/capability breadcrumb;
- blocked human gates visibly impassable;
- bundle launch as a request to the authoritative runtime, never direct process spawn;
- live streams fed by Omni observations/evidence rather than raw host stdout by default.

That is the safe path from a conventional operator cockpit to the RTS/debugger/assurance-graph interface without weakening Omni's execution boundary.
