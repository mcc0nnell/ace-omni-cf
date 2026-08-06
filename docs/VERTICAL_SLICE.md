# Vertical slice status

## Repo

- **GitHub:** https://github.com/mcc0nnell/ace-omni-cf
- **Default branch:** `main`
- **Working branch:** `cloudflare-native` (tracks main for continued implementation)

## What is implemented

| Step | Status |
|------|--------|
| 1. Researcher account / seeded admin | Seed SQL + PBKDF2 passwords |
| 2. Server-authenticated session | D1 sessions, HTTP-only cookies |
| 3. Create experiment | API + Zod validation |
| 4. Define two participants + call config | ExperimentConfig schema |
| 5. Audio + caption manipulations | Config + DO-issued schedule |
| 6. Signed participant invitations | Token hash, expiry, one-time redeem |
| 7–8. Two browsers join same call | Join flow + CallRoom DO |
| 9. WebRTC A/V | P2P + DO signaling |
| 10. Mock captions | Deterministic mock ASR, no credentials |
| 11. Manipulations at deterministic times | Schedule with offsets |
| 12–14. Evidence | R2 upload endpoints (browser record still stub) |
| 15. Researcher views call | Call GET API; download path started |

## Durable Object call protocol (summary)

- `POST /init` — bind callId + experimentId
- WebSocket upgrade with `participantId`, `name`, `role`, `token`
- Events: `welcome`, `participant_joined/left`, `call_started`, `offer`/`answer`/`ice_candidate`, `schedule_issued`, `caption`, `manipulation_*`, `call_ended`, `error` (identity_spoof)
- Identity spoof rejected; no cross-room signaling

## D1 schema

See `migrations/0001_initial.sql`: users, sessions, experiments, invitations, calls, call_events, audit_events.

## Evidence manifest (target)

`EvidenceManifestSchema` in `@ace-omni/domain` — versioned snapshot + artifacts list with opaque R2 keys.

## Original Omni → Cloudflare mapping

| Original | Cloudflare |
|----------|------------|
| Express + MongoDB | Hono Worker + D1 |
| Socket.IO rooms | Durable Object WebSockets |
| EC2 / local FS recordings | R2 multipart / Worker upload |
| Google/IBM/Azure ASR | Mock ASR default; Workers AI hook |
| sessionStorage auth | Server sessions + cookies |
| Nested Mongo experiment docs | Versioned Zod ExperimentConfig |

## Known limitations

- Local sandbox FS corruption blocked full `npm ci` + Playwright run in agent environment
- AudioWorklet manipulations not yet wired (schedule is acknowledged; Web Audio TBD)
- Evidence recording from MediaRecorder not finished end-to-end
- Playwright two-context e2e not committed
- TURN credentials generation stub only
- CSRF header checked on client; server enforcement incomplete
- Unit/integration test suite not yet filled

## Next milestone

1. Clone repo locally, `npm ci`, migrate, seed, `wrangler dev` + Vite
2. Wire MediaRecorder → R2 for mic/received/captions
3. AudioWorklet for noise/packet-drop/filter per schedule
4. Playwright two-browser vertical-slice test
5. Role tests, invitation expiry tests, DO isolation tests

## Local startup (once cloned)

```bash
git clone https://github.com/mcc0nnell/ace-omni-cf.git
cd ace-omni-cf
npm ci
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run db:migrate:local
cd apps/worker && npx tsx scripts/seed.ts > /tmp/seed.sql
npx wrangler d1 execute ace-omni-db --local --file=/tmp/seed.sql
cd ../..
npm run dev:worker   # :8787
npm run dev:web      # :5173
```

Demo login: `admin@omni.local` / `omni-admin-2026`
