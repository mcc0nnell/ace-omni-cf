# WebRTC telemetry and jitter detection

ACE Omni now has a browser-side observer for the actual WebRTC media path. This is measurement, not impairment injection.

## Two different meanings of jitter

PR #11 introduced deterministic **application-layer video timing jitter**: Omni can deliberately vary presentation delay for a controlled experiment.

This observer measures **WebRTC transport and receiver behavior** exposed by `RTCPeerConnection.getStats()`. The two signals must remain distinct:

- commanded `video_jitter` answers *what condition did the experiment ask the presentation layer to apply?*
- observed WebRTC telemetry answers *what did the real RTP/ICE/media path report?*

A later experiment can correlate them without pretending one causes the other automatically.

## Normalized measurements

`packages/media/src/webrtc-telemetry.ts` normalizes browser statistics into `WebRtcTelemetrySample` records.

For inbound RTP streams it records, when exposed by the browser:

- RTP inter-arrival jitter in milliseconds;
- cumulative and interval packet loss;
- jitter-buffer cumulative delay;
- average, target, and minimum jitter-buffer delay;
- decoded and dropped frames;
- freeze count and total freeze duration;
- concealed audio samples and concealment-event counts.

For remote inbound RTP it records remote-reported jitter, round-trip time, loss, and fraction lost.

For the selected ICE candidate pair it records current round-trip time, available incoming/outgoing bitrate, and byte counters.

Each sample also carries:

- a stable caller-supplied `sourceId` for the peer connection;
- a monotonically increasing local sample sequence;
- the local observation wall-clock time;
- the newest source `RTCStats.timestamp` in the report; and
- connection, ICE, and signaling state.

## Detecting jitter

The observer does not impose a universal pass/fail threshold. Jitter tolerance depends on codec, frame rate, jitter-buffer behavior, signing motion, network conditions, and the research question.

Instead it preserves the measurements needed to detect and quantify a change:

`RTP jitter → jitter-buffer growth → loss/concealment or frame drops/freezes → presentation or human-performance effect`

`maxInboundJitterMs` and `maxJitterBufferAverageDelayMs` are convenience summaries. Per-stream records remain available for analysis.

## Interval deltas

Cumulative WebRTC counters are not directly comparable between adjacent moments. When the observer has a previous sample for the same inbound RTP stat ID, it derives:

- `packetsReceivedDelta`;
- `packetsLostDelta`;
- `intervalPacketLossPercent`;
- `framesDroppedDelta`;
- `freezeCountDelta`; and
- `concealmentEventsDelta`.

Counter resets do not produce negative deltas; the interval field is omitted until a new baseline exists.

## Observer lifecycle

`createWebRtcTelemetryObserver(peerConnection, options)` calls the real `getStats()` interface. It exposes:

- `sampleNow()` for an explicit measurement;
- `start()` for periodic observation; and
- `stop()` for deterministic teardown.

Periodic sampling is serialized so a slow `getStats()` call cannot create overlapping measurements.

## Evidence boundary

This PR establishes the measurement primitive and its deterministic normalization/tests. It deliberately does not make jitter a special case in the Emulytics core protocol.

The next runtime wiring should carry `WebRtcTelemetrySample` through a generic evidence-bearing observation event, where the existing reliable room outbox and Durable Object sequencer can provide retry safety, authoritative sequence assignment, D1 synchronization, manifest inclusion, and replay.

That keeps the architecture clean:

`RTCPeerConnection.getStats() → WebRTC telemetry observer → generic Omni observation → authoritative evidence ledger`
