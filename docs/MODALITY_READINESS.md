# Modality readiness

A communications session is not one state.

ACE Omni must preserve the difference between signaling success, transport readiness, media receipt, media decoding, presentation, and accessible text readiness. A browser can have a stable signaling state and a selected media path while the participant still sees a black frame. Likewise, usable video says nothing about whether RTT was negotiated or whether a T.140 character was ever exchanged.

This document defines the first portable readiness vocabulary used by **PG-003 — Modality Readiness Under Stalled ICE**.

## Why this exists

The historical ACE Direct codebase pinned JsSIP 3.5.1 and carried a local ICE-gathering timeout patch. The patch is useful evidence that a real TRS deployment once needed an escape path when candidate gathering did not complete as expected. It is not proof that current JsSIP, current browsers, Elixip, OpenMeetings, or any future Baudot implementation has the same defect.

PG-003 turns that historical behavior into a controlled experiment rather than copying the patch.

## Independent observations

The media package exposes `deriveModalityReadiness()` over the existing WebRTC telemetry sample plus observations that the WebRTC stats API cannot establish by itself.

The contract deliberately keeps these states separate:

| Layer | Observation | Evidence source |
| --- | --- | --- |
| session | session established | SIP/runtime observer |
| signaling | peer connection signaling stable | `RTCPeerConnection.signalingState` |
| transport | ICE ready | `iceConnectionState` |
| transport | candidate pair selected/succeeded | WebRTC stats |
| audio | inbound packets observed | inbound RTP stats |
| video | inbound packets observed | inbound RTP stats |
| video | frame decoded | `framesDecoded` |
| video | frame rendered | independent presentation observer |
| RTT | negotiated | SIP/SDP RTT observer |
| RTT | first T.140 character observed | RTT transport observer |

The key rule is:

```text
SESSION_ESTABLISHED
  != ICE_READY
  != VIDEO_DECODED
  != VIDEO_RENDERED
  != RTT_READY
```

A later observation may advance one state. It must not retroactively rewrite what was observed earlier.

## Readiness states

Each observation is one of:

- `unknown` — the observer has no evidence yet;
- `pending` — the relevant path exists or was explicitly observed as not ready yet;
- `ready` — affirmative evidence exists;
- `failed` — affirmative failure evidence exists.

`overall` is derived only from states required by the experiment. The default media requirement is audio + video. RTT becomes part of the overall gate only when the scenario explicitly requires RTT.

This avoids making every call an RTT call while still allowing an RTT experiment to state that video success is insufficient.

## The stalled-ICE experiment

PG-003 begins with a normal control and then introduces bounded variants such as:

1. delayed final candidate;
2. no end-of-candidates signal;
3. TURN-only;
4. STUN-only; and
5. ICE restart.

The initial question is intentionally narrow:

> Can the runtime preserve the exact point at which signaling, transport, media, presentation, and RTT diverge when ICE gathering is late or incomplete?

The trial is `planned` until Omni can manipulate or reliably induce the condition and preserve the resulting readiness observations as evidence.

## Baudot boundary

The vocabulary is designed to be portable into Baudot's future SIP RTT/T.140 testkit work. In that use, the RTT side should be grounded in the T.140 and RFC 4103 normative vectors rather than inferred from WebRTC media state.

The intended relationship is:

```text
Baudot
  normative RTT/T.140 behavior + vectors
        │
        ▼
portable modality-readiness contract
        │
        ▼
ACE Omni
  controlled experiment execution + evidence
```

Nothing in PG-003 establishes T.140, RFC 4103, or Baudot conformance. It establishes the observation boundary needed to test those claims later without confusing a connected call with a usable accessible call.

## Candidate targets

Once the control and manipulated browser paths are repeatable, the same experiment can be executed against independent communications implementations. Current candidates include current JsSIP, Elixip, an Asterisk-mediated path, and Apache OpenMeetings.

The point is cross-implementation evidence, not forcing every target to use the same SIP or WebRTC internals.
