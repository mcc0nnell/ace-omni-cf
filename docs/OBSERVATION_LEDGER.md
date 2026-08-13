# Generic observation ledger

ACE Omni treats measurements as evidence, not as authoritative client state.

## Runtime chain

`producer → observation input → reliable room outbox → authenticated Durable Object → server-created ObservationEnvelope → authoritative sequence → D1 → immutable manifest → export/replay`

The first live producer is the browser WebRTC telemetry observer. The same envelope is intentionally usable by future SIP, network-emulation, sensor, simulation, hardware-in-the-loop, and world-model adapters.

## Trust boundary

A participant runtime may report:

- an observation id local to the source;
- an adapter id;
- a bounded source id;
- an observation timestamp;
- a JSON payload; and
- its client wall-clock time.

The runtime may **not** choose the authoritative run binding or room sequence. The Durable Object:

1. authenticates the participant connection;
2. binds `runId` to the current call id for the TRS call path;
3. namespaces `sourceId` with the authenticated participant id;
4. validates that the payload is canonical JSON;
5. computes `payloadSha256` using the Emulytics canonical digest function;
6. persists the event under the existing `(participant_id, client_event_id)` replay key;
7. synchronizes the ordered event to D1; and
8. ACKs only after the event is durable in both the room sequencer and D1.

An exact lost-ACK replay returns the original authoritative sequence without inserting a second observation. If the same client event id is replayed with changed observation content or clock data, Omni preserves the original event, writes an `observation_replay_conflict` error into the evidence ledger, reports the conflict to the client, and ACKs the already-committed sequence so the corrupt local outbox entry cannot retry forever.

This preserves the existing untrusted-endpoint boundary: a browser can measure and report what it observed, but it cannot rewrite the experiment identity, authoritative event order, or evidence digest after ingestion.

## WebRTC producer

Each peer connection gets a fresh source instance id. While a call is active and experiment-event evidence is enabled, the observer samples `RTCPeerConnection.getStats()` once per second and emits:

- RTP jitter and packet-loss measurements;
- jitter-buffer delays;
- remote-reported RTT/jitter;
- frame drops and freezes;
- audio concealment counters; and
- selected candidate-pair transport metrics.

The durable client event id includes the source instance and local sample sequence. A lost ACK can therefore replay the exact observation safely without colliding with a later peer connection after a page reload.

## Architectural invariant

WebRTC is only a producer. There is no WebRTC-specific evidence table and no jitter-specific ledger protocol.

`commanded condition ≠ measured transport behavior ≠ participant effect`

Omni preserves those layers separately so later analysis can correlate them without silently asserting causation.
