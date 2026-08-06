# Security boundaries and operations

©2024 The MITRE Corporation. Approved for Public Release 24-0463.

## Identity and authorization

- Researcher sessions use random bearer cookies; D1 stores only SHA-256 token hashes. Cookies are HttpOnly, Secure in production, SameSite Strict, and scoped to `/`.
- Every unsafe researcher request requires the CSRF token in both a readable cookie and `X-CSRF-Token`; D1 stores only its hash.
- Experiments, versions, calls, invitations, artifacts, manifests, exports, and replay operations enforce owner or administrator access.
- Invitations are HMAC-signed, call/version/role/template-bound, expire, and can update exactly once. Participant links carry the bearer token in a URL fragment so it is not sent in the initial HTTP request or Worker access logs; the fragment is cleared after redemption.
- Participant access tokens are HMAC-signed and also matched against a non-revoked D1 session hash.
- Room credentials expire after 60 seconds, are consumed atomically, and are verified again by the destination Durable Object.
- Participant WebSocket payloads cannot select identity. A mismatching `participantId` is explicitly rejected.

## Evidence integrity

- The participant asks the API to authorize one artifact described by type, content type, byte size, SHA-256, and capture time.
- The server verifies the pinned evidence policy, assigns the R2 object key, stores only a token hash, and issues a short-lived one-use upload credential.
- PUT must match the exact authorization. R2 independently validates SHA-256 while streaming.
- D1 records size, digest, ETag, capture/upload timestamps, participant, call, and object key.
- Download rechecks R2 size, ETag, R2 checksum, and custom metadata against D1. A mismatch fails closed with 409.
- The versioned manifest embeds the exact config snapshot and digest, signed schedule, participants, artifacts, immutable events, event digest, and timestamps.

## Secrets

Production startup rejects missing, short, or recognizable development placeholder secrets. Set these only through Worker secrets:

- `SESSION_SECRET`
- `TOKEN_SIGNING_SECRET`
- `SCHEDULE_SIGNING_SECRET`

`.dev.vars.example` is explicitly local-only. The production Wrangler environment contains no secret values and uses an invalid placeholder D1 identifier to prevent accidental deployment without provisioning.

## Network policy

- Credentialed CORS accepts exact configured origins only.
- Cross-site unsafe Fetch Metadata requests are rejected.
- CSP, frame denial, MIME sniffing denial, no-referrer, no-store, opener isolation, and media permission policies are emitted on Worker responses.
- WebSocket signaling can target only a currently connected participant in the same per-call object.
- SDP and ICE bodies are relayed but not persisted; event storage records only type, actor, target, sequence, and timing.

## Dependency integrity

- External versions and npm's integrity hashes are locked; clean checkout uses `npm ci`.
- CI rejects NUL-corrupted source before installation and runs `npm audit --audit-level=moderate`.
- The Cloudflare development toolchain's exact `undici` 7.28.0 dependency is overridden to compatible patched 7.29.0; Worker integration and browser tests run against that resolved dependency tree.

## Production gate

Before deployment, provision unique D1/R2/Durable Object resources, replace the invalid production origin/database placeholders, add secrets through Cloudflare, configure R2 lifecycle rules, select a TURN strategy, establish monitoring/alerts, and run the clean-checkout suite against the release revision. Do not use the local synthetic seed against remote resources.
