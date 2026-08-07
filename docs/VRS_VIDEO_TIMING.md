# VRS video lag, jitter, and freeze

©2024 The MITRE Corporation. Approved for Public Release 24-0463.

## Purpose

Video Relay Service research needs controlled **application-layer** temporal distortion of signed language video:

| Type | Effect |
|------|--------|
| `video_lag` | Constant presentation delay (ms) |
| `video_jitter` | Seeded per-frame delay variation around a mean |
| `video_freeze` | Hold previous frame (stutter / freeze) |

These are **schedule-driven** manipulations, same authority model as audio and captions: experiment config → signed schedule → participant-local execution → evidence events.

## Not in this slice

- Path-level WAN emulation (Emulytics / minimega / netem) — outer shell later
- Codec bitrate ladders and resolution throttling
- TURN-forced relay lag as a first-class schedule type (measurable via WebRTC stats; not a manipulation primitive here)
- Communications-assistant three-party VRS topology (still deferred)

## Domain

Manipulation types: `video_lag`, `video_jitter`, `video_freeze`  
Target stream: `video`

Example parameters:

```json
{ "type": "video_lag", "parameters": { "delayMs": 250 } }
{ "type": "video_jitter", "parameters": { "meanDelayMs": 80, "jitterMs": 40, "minDelayMs": 0 } }
{ "type": "video_freeze", "parameters": { "holdMs": 300 } }
```

## Runtime

`packages/media/src/video-timing.ts` decides per-frame delay/hold from the signed schedule. The call UI is responsible for applying the decision to a presentation path (e.g. delayed draw to canvas, or a small frame queue).

Determinism: jitter uses Mulberry32 with `seed + frameIndex` so two browsers with the same schedule produce the same delay series.

## Next

1. Wire controller into `CallPage` remote video track presentation.
2. Emit `manipulation_executed` with `presentOffsetMs` / `holdPrevious`.
3. Optional Playwright assertion on freeze/lag under fake media.
