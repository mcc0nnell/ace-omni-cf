# ElixiPG — Elixip Proving Grounds

This directory is the Elixip execution adapter used by **ElixiPG**, the Elixip Proving Grounds.

ElixiPG treats Elixip as an executable communications world and ACE Omni Core as the experiment/evidence plane around it. The current port is the third ACE Omni Core runtime target and supplies the first proven proving-ground trial, **PG-001 Runtime Independence**.

It executes the canonical Omni conformance fixtures inside the real Elixip `SIP.Scenario` finite-state-machine engine. The current slice is deliberately transport-neutral: `START_ACTIVITY` is emitted as an abstract Omni command, while Elixip owns the state-machine execution and terminal success/failure semantics. **PG-002 SIP Establishment** will replace that abstract command with an actual SIP INVITE/dialog path without changing the Omni Core evidence grammar.

See `proving-grounds/README.md` and `proving-grounds/trials/` for the proving-ground contract and trial registry.

## Upstream pin

CI uses:

- repository: `neutrino38/elixip`
- version observed at the pin: `1.3.0`
- commit: `fd0f7bf703dddfcefcf2cb28205776a5a402e192`
- scenario entry point: `mix scenario <scenario.exs>`

Pinning the commit prevents a moving upstream runtime from silently changing proving-ground results.

## Boundary

```text
ElixiPG trial
    ↓
Omni fixture / command
    ↓
ports/elixip/omni_conformance.exs
    ↓
SIP.Scenario FSM
    ↓
normalized Omni semantic trace
    ↓
ElixiPG evidence / verdict
```

The scenario uses Elixip's own `state`, `on_events`, `goto`, `scenario_success`, and `scenario_failure` execution model. It does not copy or modify Elixip implementation source.

Current mapping:

| Omni Core | Elixip |
| --- | --- |
| activity behavior | `SIP.Scenario` FSM |
| scoped state | scenario `appdata` |
| input event | Elixir event consumed by `on_events` |
| transition | `goto` + scenario state |
| terminal outcome | `scenario_success` / `scenario_failure` |
| `START_ACTIVITY` | abstract command; PG-002 maps this to SIP/dialog execution |

## Authority boundary

**Elixip makes communications happen. Omni records and evaluates what happened. ElixiPG defines the trial.**

Elixip events and media observations are evidence inputs; they do not independently choose experiment identity, canonical trial inputs, evidence identity, or semantic verdicts.

## License boundary

Elixip is BSL 1.1. Its upstream license explicitly exempts `.exs` scenarios executed by the scenario engine from derivative-work treatment. This repository therefore carries an ACE Omni scenario and pins an external Elixip checkout in CI; it does not vendor Elixip.

The upstream license separately reserves competing SIP/RTP/WebRTC testing products for commercial licensing. This conformance integration is non-production research/CI. Any later production or commercial testing integration should be covered by explicit permission or a commercial agreement with the Elixip licensor.

## Local run

Point `ELIXIP_DIR` at the pinned Elixip checkout, compile `apps/elixip2`, then run:

```sh
ELIXIP_DIR=/path/to/elixip bash scripts/run-elixip-conformance.sh
npm run test:conformance
npm run test:elixipg
```

The generated traces live under `conformance/generated/elixip/` and are not committed.
