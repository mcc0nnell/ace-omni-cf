# ElixiPG — Elixip Proving Grounds

This directory is the Elixip execution adapter used by **ElixiPG**, the Elixip Proving Grounds.

ElixiPG treats Elixip as an executable communications world and ACE Omni Core as the experiment/evidence plane around it. The port is the third ACE Omni Core runtime target and now supplies two proven proving-ground trials: **PG-001 Runtime Independence** and **PG-002 SIP Establishment**.

PG-001 executes the canonical Omni conformance fixtures inside the real Elixip `SIP.Scenario` finite-state-machine engine while keeping `START_ACTIVITY` abstract for cross-runtime comparison.

PG-002 preserves that conformance trace and launches a nested Elixip trial that binds `START_ACTIVITY` to actual SIP transaction/dialog execution. It uses Elixip's own `SIP.Test.Transport.UDPMockup` and `MediaServer.Mockup`, and emits dedicated evidence under `conformance/generated/elixipg/`.

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
    ├── normalized runtime-independence trace
    └── PG-002 nested SIP.Scenario
             ↓
       Elixip transaction/dialog stack
             ↓
       signaling + media observations
             ↓
       ElixiPG evidence / verdict
```

The scenarios use Elixip's own `state`, `on_events`, `goto`, `scenario_success`, and `scenario_failure` execution model. They do not copy or modify Elixip implementation source.

Current mapping:

| Omni Core | Elixip |
| --- | --- |
| activity behavior | `SIP.Scenario` FSM |
| scoped state | scenario `appdata` |
| input event | Elixir event consumed by `on_events` |
| transition | `goto` + scenario state |
| terminal outcome | `scenario_success` / `scenario_failure` |
| `START_ACTIVITY` in PG-001 | abstract conformance command |
| `START_ACTIVITY` in PG-002 | SIP INVITE → dialog → media observation → BYE |
| SIP transport in PG-002 | `SIP.Test.Transport.UDPMockup` |
| media adapter in PG-002 | `MediaServer.Mockup` |

## What PG-002 proves

The trial's validated evidence records an ordered causal chain from `START_ACTIVITY` through INVITE serialization, a provisional response, final response, ACK, dialog establishment, media-connectivity observation, BYE serialization, teardown response, and dialog termination.

The artifact validator requires contiguous sequencing, one correlation identity across all observations, the declared runtime identity, terminal `COMPLETED`, verdict `pass`, and the required milestones in order.

PG-002 is deliberately a **runtime-semantic** proof. It does not assert external-network SIP interoperability or RTP interoperability. Those require later trials with external peers/transports and real media paths.

## Authority boundary

**Elixip makes communications happen. Omni records and evaluates what happened. ElixiPG defines the trial.**

Elixip events and media observations are evidence inputs; they do not independently choose experiment identity, canonical trial inputs, evidence identity, or semantic verdicts.

## License boundary

Elixip is BSL 1.1. Its upstream license explicitly exempts `.exs` scenarios executed by the scenario engine from derivative-work treatment. This repository therefore carries ACE Omni scenarios and pins an external Elixip checkout in CI; it does not vendor Elixip.

The upstream license separately reserves competing SIP/RTP/WebRTC testing products for commercial licensing. This conformance integration is non-production research/CI. Any later production or commercial testing integration should be covered by explicit permission or a commercial agreement with the Elixip licensor.

## Local run

Point `ELIXIP_DIR` at the pinned Elixip checkout, compile `apps/elixip2`, then run:

```sh
ELIXIP_DIR=/path/to/elixip bash scripts/run-elixip-conformance.sh
npm run test:conformance
npm run test:elixipg
```

PG-001 runtime traces live under `conformance/generated/elixip/`. PG-002 evidence lives under `conformance/generated/elixipg/`. Generated evidence is not committed.
