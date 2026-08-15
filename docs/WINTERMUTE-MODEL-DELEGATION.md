# Wintermute model-delegation boundary

Status: **experimental / cross-repository contract**

ACE Omni behavior specifications may request a bounded cognitive role from an external intelligence boundary such as Wintermute. They do not select a provider or model and do not gain execution authority by requesting cognition.

## Shared role vocabulary

The current role vocabulary mirrors the Wintermute `/api` delegation contract:

- `collector`
- `researcher`
- `assessor`
- `challenger`
- `remediator`
- `reporter`

These are reasoning roles, not Omni duties. An Omni duty describes organizational responsibility (`collect`, `assess`, `remediate`, `approve`, `report`, `provision`). A reasoning role describes the kind of cognition requested to help perform a non-approval duty.

For example, the SC-7 contradiction-assessor behavior has:

```text
duty: assess
reasoningRole: challenger
```

The distinction is deliberate. The operator context still owns the authoritative adapter/capability binding, while Wintermute policy may resolve `challenger` to an independent reasoning provider.

## Model-selection boundary

An Omni behavior spec may say:

```text
reasoningRole: challenger
```

It may not say:

```text
provider: anthropic
model: <model-id>
allowedProviders: [...]
```

Runtime validation rejects provider/model-shaped fields just as it rejects tool, adapter, capability, shell, and executable fields.

The intended composition is:

```text
Omni behavior duty
  -> requested reasoning role
  -> Wintermute capability / provider policy
  -> advisory model output
  -> Omni observation / evidence / assertion path
```

There is no `behavior -> model -> authority` shortcut.

## Approval boundary

Model reasoning roles are prohibited on an Omni `approve` duty. The current SC-7 finding approver remains a distinct human principal with no `reasoningRole`.

This preserves the stronger invariant:

> Models may collect, research, assess, challenge, remediate, or report within governed boundaries. They do not approve the authoritative finding merely because they produced or reviewed the analysis.

## Epistemic independence

Provider diversity belongs to Wintermute routing policy, not Omni presentation state. Omni can request a `challenger`; Wintermute can require that challenge to use a provider independent from the assessment being checked. If that independence constraint cannot be satisfied, the routing layer should fail closed rather than silently reuse the same provider.

Disagreement is not resolved by model voting. Material conflicts should remain explicit and, where possible, drive the next authoritative observation or controlled Omni experiment.
