# Implementation and validation status

Status is evidence-based: “tested” means the path has executed in automation, not merely compiled.

| Capability | Status | Executed evidence |
|---|---|---|
| Lockfile install, dependency audit, migration, seed, typecheck, build | Tested | clean migration/seed commands plus CI workflow; `npm audit` reports zero known vulnerabilities |
| Researcher session and CSRF | Tested | Worker integration negative/positive tests |
| Ownership isolation | Tested | cross-researcher experiment and call tests |
| Immutable experiment version and pinned replay | Tested at API/integration level | D1 immutability trigger, call pinning, export/replay routes |
| Invitation signature, expiry, race, and reuse | Tested | concurrent redemption, modified token, expiry tests |
| Participant identity and room isolation | Tested | modified access token, cross-call room credential, spoofed message, cross-room signal target |
| Reconnect presence integrity | Tested | replaced connection close is suppressed; genuine disconnect records D1 presence and one immutable event |
| Reconnect delivery integrity | Tested | fresh credential per attempt, snapshot-before-replay, tab-restored outbox, lost-ACK replay, SQLite deduplication, monotonic sequence guard |
| Durable Object hibernation and call timeout | Tested | live WebSockets, authoritative state, and the configured alarm survive eviction; timeout finalizes once |
| Terminal call-state invariant | Tested | every exercised terminal state either finalizes a manifest or carries an explicit `failed_reason` |
| Experiment-derived signed schedule | Tested | deterministic engine, runtime identity mapping, HMAC verification |
| WebRTC audio/video | Tested | two independent Chromium contexts with fake devices |
| Mock captions | Tested | both contexts exchange and render synthetic captions |
| Caption appearance and semantic tokens | Tested at unit/build level | pinned size/contrast/attribution are rendered; token export drift, critical contrast pairs, forced colors, reduced motion, and touch target are asserted |
| Caption and audio schedule execution | Tested | exact schedule offsets persisted; AudioWorklet frame mapping unit tests |
| MediaRecorder → authorized R2 | Tested | two browser artifacts plus Worker R2 integration test |
| Evidence tamper rejection | Tested | wrong upload digest and post-upload R2 overwrite |
| Immutable evidence manifest | Tested | finalize, schema parse, trigger, browser download |
| Research export | Tested | authorized browser download |

## Experimental but implemented

- P2P WebRTC currently uses host candidates in automated tests. A production TURN service is not configured.
- AudioWorklet `gain`, `background_noise`, `packet_drop`, and one-pole `audio_filter` conditions are implemented; only gain is exercised in the browser slice, while deterministic frame mapping is unit-tested.
- Caption delay is exercised in the browser slice. Caption dropout/error implementations use deterministic seeded decisions but are not yet covered by a browser matrix.
- R2 retention days are captured in policy but lifecycle deletion rules must be configured at the bucket level before production.

## Explicitly stubbed or out of scope for this slice

- External ASR engines (`workers_ai`, Google, Azure, Watson, Amazon) are schema options only. Automated and local runs use mock ASR.
- Version 1 supports exactly caller and callee. Communications-assistant/VRS multi-party topology is deferred.
- Recruitment, consent authoring, participant compensation, and study randomization workflows are not implemented.
- Cloudflare Realtime TURN credentials and an SFU path are not implemented.
- Production resources, domains, secrets, retention rules, alerts, and deployment have not been created.
- Login rate limiting, account recovery, MFA/SSO, and institutional identity integration remain recommended production work.
- Full assistive-technology and real-device accessibility matrices remain future validation; semantic labels, focus visibility, status regions, and keyboard controls are present.

## Recommended next work

1. Integrate short-lived Cloudflare Realtime TURN credentials and test restrictive NAT paths.
2. Add MFA/SSO, login throttling, session administration, and operational key rotation.
3. Run real AudioWorklet device/browser matrices and quantify frame variance under load.
4. Add study consent/recruitment controls and institutional data-governance workflows.
5. Configure R2 lifecycle/encryption policy, alerting, log sinks, and disaster-recovery exercises.
6. Extend schemas and call topology for communications assistants and VRS.
