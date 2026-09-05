# Generic observation ledger

ACE Omni treats measurements as evidence, not as authoritative client state.

## Runtime chains

ACE Omni now has two deliberately distinct observation-ingestion paths.

The live TRS call path is:

`producer → observation input → reliable room outbox → authenticated Durable Object → server-created ObservationEnvelope → authoritative sequence → D1 → immutable manifest → export/replay`

The first live producer is the browser WebRTC telemetry observer. The same envelope is intentionally usable by future SIP, network-emulation, sensor, simulation, hardware-in-the-loop, and world-model adapters.

The protocol-level external import path is:

`external candidate bundle → source-binding validation → Omni run/adapter binding → server-side ObservationEnvelope creation → protocol ledger sequence → immutable ledger export + digest`

The first real external bundle is the 17-record `BAUDOT-INTEROP-004` candidate set produced by Baudot. This path proves generic ingestion, replay, conflict detection, stable sequencing, immutable export, and semantic round-trip without pretending the source CI run was a live Omni room.

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

## External observation import

`ObservationIngestionLedger` applies the same protocol invariants to candidate bundles produced outside an Omni-owned runtime.

An import may declare a `sourceBinding` containing the source run and adapter identities. Omni first validates each candidate under that source binding, then creates a new authoritative `ObservationEnvelope` bound to the declared Omni target run and adapter. The observation id, source id, observation timestamp, and payload are preserved. Omni computes the target envelope's canonical payload digest and assigns a stable one-based ledger sequence.

The authoritative replay key remains:

`runId : adapterId : sourceId : observationId`

An exact replay returns the original sequence without adding a second entry. A replay using the same key with a changed observation timestamp or payload digest is rejected as a conflict. The ledger export is canonical JSON and receives its own SHA-256 digest, so repeated export of unchanged evidence is stable.

### First real import: Baudot INTEROP-004

The experiment-engine test fixture is copied byte-for-byte from the green Baudot PR #45 Actions evidence bundle:

- source repository: `mcc0nnell/baudot`;
- source head: `f4dfe0c21e530d02d4fb5b4547fbf0098716a16b`;
- Actions run: `33996472033`;
- artifact id: `9978215143`;
- artifact digest: `sha256:61cf2136f84c00892f94ce7fa5563dd1fe29dc24e7c652d4f9ea5f92ddb66a46`;
- source JSONL SHA-256: `f15a1a84044bb210f879f3ebeb472bed83444f7211c957d429eb96e1f914220f`;
- observation count: `17`;
- source run binding: `baudot-ci-33996472033-1`;
- source adapter binding: `baudot-interop004`.

The test imports all 17 candidates into an Omni-owned run, exact-replays an observation without duplication, rejects a conflicting replay, verifies a stable export digest, and projects the original Baudot facts back out. In particular, it preserves the distinction between `control:rttReady=true` and `signaling-only:rttReady=false` plus `signaling-only:oldLegPreserved=true`.

That round trip is evidence that Omni preserved Baudot's facts. It is **not** authority for Omni to redefine what `rttReady`, T.140, REFER continuity, or a Baudot interoperability verdict means.

### Persistence boundary

The external-import ledger in the experiment engine is protocol-level authority for its declared target run and immutable export. It does **not** claim Durable Object or D1 persistence.

The live TRS call path remains the durable call-scoped authority: its server call UUID is the authoritative `runId`, its room sequencer owns event order, and D1 plus the finalized evidence manifest own durable call evidence. A future generic-run persistence layer may carry `ObservationIngestionLedger` records into durable storage, but it must preserve the same source-binding, replay, and digest invariants rather than silently treating a foreign run id as an Omni call id.

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

WebRTC and Baudot are both producers at different trust boundaries. Neither producer becomes experiment authority merely by reporting an observation.

`commanded condition ≠ measured transport behavior ≠ participant effect`

Omni preserves those layers separately so later analysis can correlate them without silently asserting causation.
