# ACE Omni (Cloudflare-native)

Cloudflare-native resurrection of [ACE Omni](https://github.com/mitrefccace/ace-omni) — a configurable research laboratory for Telecommunications Relay Services (TRS).

This is **not** a generic video-chat application. Researchers configure communications conditions, run controlled experiments with participants, and collect synchronized evidence.

## Architecture

- **apps/web** — React + Vite participant & researcher UI
- **apps/worker** — Hono API on Cloudflare Workers, D1, R2, Durable Objects
- **packages/domain** — Shared Zod schemas (experiments, calls, manipulations, evidence)
- **migrations/** — D1 SQL migrations

Real-time call coordination lives in a per-call Durable Object (`CallRoom`). Media is peer-to-peer WebRTC; signaling, presence, experiment clock, and schedules are authoritative on the server. Captions use a deterministic mock ASR provider by default (no external credentials).

## Local development

```bash
npm ci
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run db:migrate:local
# Generate seed SQL and apply:
cd apps/worker && npx tsx scripts/seed.ts > /tmp/seed.sql
npx wrangler d1 execute ace-omni-db --local --file=/tmp/seed.sql
cd ../..
npm run dev:worker   # terminal 1 — http://127.0.0.1:8787
npm run dev:web      # terminal 2 — http://127.0.0.1:5173 (proxies /api)
```

**Demo credentials:** `admin@omni.local` / `omni-admin-2026`

### Vertical slice

1. Sign in as administrator
2. Create a sample experiment (or use seeded one)
3. Issue participant invitations
4. Create a call room
5. Open two browser profiles / windows, redeem each invitation, enter the same call ID
6. Grant camera/microphone; establish WebRTC; observe mock captions and scheduled manipulations
7. End call

## Government notice

This software was produced for the U.S. Government under Contract Number 75FCMC18D0047, subject to FAR 52.227-14. See `LICENSE`.

© 2024 The MITRE Corporation. Approved for Public Release; Distribution Unlimited 24-0463.

The Cloudflare-native implementation preserves the original purpose and notice. It does **not** claim to relicense the original work.
