# Elixip Omni Runtime Adapter

This port is the third ACE Omni Core runtime target.

It executes the canonical Omni conformance fixtures inside the real Elixip `SIP.Scenario` finite-state-machine engine. The current slice is deliberately transport-neutral: `START_ACTIVITY` is emitted as an abstract Omni command, while Elixip owns the state-machine execution and terminal success/failure semantics. A subsequent slice can map that command to actual SIP/dialog/media behavior without changing the Omni Core fixture format.

## Upstream pin

CI uses:

- repository: `neutrino38/elixip`
- version observed at the pin: `1.3.0`
- commit: `fd0f7bf703dddfcefcf2cb28205776a5a402e192`
- scenario entry point: `mix scenario <scenario.exs>`

Pinning the commit prevents a moving upstream runtime from silently changing conformance results.

## Boundary

```text
Omni fixture
    ↓
ports/elixip/omni_conformance.exs
    ↓
SIP.Scenario FSM
    ↓
normalized Omni semantic trace
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
| `START_ACTIVITY` | abstract command; future SIP/dialog invocation |

## License boundary

Elixip is BSL 1.1. Its upstream license explicitly exempts `.exs` scenarios executed by the scenario engine from derivative-work treatment. This repository therefore carries an ACE Omni scenario and pins an external Elixip checkout in CI; it does not vendor Elixip.

The upstream license separately reserves competing SIP/RTP/WebRTC testing products for commercial licensing. This conformance integration is non-production research/CI. Any later production or commercial testing integration should be covered by explicit permission or a commercial agreement with the Elixip licensor.

## Local run

Point `ELIXIP_DIR` at the pinned Elixip checkout, compile `apps/elixip2`, then run:

```sh
ELIXIP_DIR=/path/to/elixip bash scripts/run-elixip-conformance.sh
npm run test:conformance
```

The generated traces live under `conformance/generated/elixip/` and are not committed.
