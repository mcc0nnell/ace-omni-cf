# Omni Core — runtime mapping

This table is an architectural comparison, not a claim that the underlying runtime primitives are identical.

| Omni Core concept | Original MITRE ACE Omni | Cloudflare ACE Omni | JAIN SLEE port |
| --- | --- | --- | --- |
| Experiment definition | Mongo `Experiment` document with modules/configurations | experiment + immutable versions | profile/configuration input |
| Experiment execution | selected study/module/configuration associated with a call | pinned `ExperimentRun` / call | SBB entity bound to run/activity |
| Participant role | Caller / Callee / CA stored on `Call` | server-assigned caller/callee; CA deferred | CMP state + event identity; role model can expand |
| Activity | call/room | call-scoped Durable Object / generic attached-system run | SLEE activity + Activity Context |
| Stateful behavior | Socket.IO handlers + mutable room/call state | Durable Object state machine | `OmniCallSbb` |
| External resource | ASR/cloud service, browser media/signaling | `SystemUnderTestAdapter`, WebRTC/browser, R2/D1 | Resource Adaptor |
| Runtime input | Socket.IO event | authenticated room/adapter event | SLEE event |
| Intended action | socket emit / client instruction | signed schedule / `ExecutionCommand` | `OmniCommand` through RA interface |
| Observation | captions/media/files and runtime messages | versioned observation envelope + ledger | resource event / `OmniEvent` |
| Correlation | room name, extension, call ID | call/run/participant IDs + authoritative sequence | Activity Context + explicit run/activity IDs |
| Timing | JS timestamps/timers | signed schedule + DO alarms + observed execution time | Timer Facility + event time |
| Data collection | filesystem + Mongo file metadata | R2 artifacts + D1 metadata + manifest | Evidence RA later; not implemented in first slice |
| Finalization | call end time/duration + file-size cleanup | immutable evidence manifest or explicit failure | terminal SBB state; evidence binding later |
| Replay identity | not explicit | experiment version, plan/event/observation identity | core event/command identity; persistence binding pending |

## Where the mapping is intentionally incomplete

### Durable Object != SBB

A Durable Object combines addressability, serialization, storage, alarms, and WebSocket ownership. An SBB is a managed service behavior component attached to activities. The semantic overlap is stateful correlated behavior, not implementation equivalence.

### D1/R2 != SLEE profiles

Profiles are provisioned service/subscriber/configuration data. They are a plausible home for experiment configuration but not a substitute for an evidence store. Evidence persistence should remain an external resource behind an RA rather than being forced into profiles.

### WebRTC != Resource Adaptor

The current browser owns the WebRTC peer connection. A SLEE port should not move browser media into the SBB. A WebRTC-facing RA can bridge control/observation while the actual media endpoint remains external.

### Observation authority remains separate

Both the Cloudflare and SLEE implementations must preserve the same trust rule: an execution endpoint reports an observation; the experiment runtime binds it to authoritative run/activity/source identity and evidence order.

## Architectural lineage

```text
Original ACE Omni
Experiment + Call + runtime messages + collected data
        |
        v
Cloudflare ACE Omni
immutable version + deterministic command + observation + evidence
        |
        v
Omni Core
runtime-independent experiment grammar
        |
        +-------------------+
        |                   |
        v                   v
Cloudflare runtime      JAIN SLEE runtime
Durable Objects         SBB / RA / Activity Context
```

The conformance question is not whether each runtime performs the same internal work. It is whether they preserve the same externally meaningful experiment semantics.
