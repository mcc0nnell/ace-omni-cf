# ACE Omni (Cloudflare-native)

ACE Omni is a controlled Telecommunications Relay Services research laboratory. It is not a generic video-chat application. Researchers save immutable communications conditions, issue call-bound participant invitations, run synchronized calls, apply deterministic caption and audio conditions, and collect checksum-linked evidence.

This repository resurrects the original [MITRE ACE Omni](https://github.com/mitrefccace/ace-omni) architecture on React, Vite, Hono, Cloudflare Workers, D1, Durable Objects, R2, WebRTC, and AudioWorklets.

## What executes today

The implemented vertical slice covers:

1. Server-managed researcher login, HttpOnly session cookie, and enforced double-submit CSRF token.
2. Owned experiments with immutable, SHA-256-addressed versions.
3. Calls pinned to an exact experiment-version snapshot.
4. Call-bound, expiring, cryptographically signed, single-use invitations.
5. Server-assigned participant identity and role.
6. A short-lived, one-use credential for the per-call Durable Object WebSocket.
7. Target-authorized WebRTC signaling and isolated P2P audio/video.
8. Credential-free synthetic mock captions.
9. A Durable Object call clock and an experiment-derived HMAC-signed schedule.
10. AudioWorklet frame scheduling plus caption conditions, acknowledgements, and observed execution times.
11. Configured MediaRecorder evidence, one-use upload authorization, R2 checksum validation, and D1 lifecycle events.
12. A versioned immutable evidence manifest, authorized downloads, research export, and pinned replay.

See [architecture audit](docs/ARCHITECTURE_AUDIT.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), [security boundaries](docs/SECURITY.md), and the [executed validation record](docs/VALIDATION.md).

## Repository map

- `apps/web` — React/Vite researcher and participant application.
- `apps/worker` — Hono API and the `CallRoom` Durable Object.
- `packages/domain` — shared versioned Zod contracts.
- `packages/experiment-engine` — deterministic schedule expansion.
- `packages/media` — frame mapping, AudioWorklet graph, seeded randomness, and MediaRecorder helpers.
- `packages/test-support` — two-independent-context Playwright test with fake media.
- `migrations` — ordered D1 migrations.

## Clean local setup

Requirements: Node.js 22.14 or newer and npm.

```bash
npm ci
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run db:migrate:local
npm run seed:local
npm run build
npm run dev:worker
```

Open `http://127.0.0.1:8787`. The local-only synthetic seed account is `researcher@omni.local`; its default password is `local-only-synthetic-password`. Override it with `OMNI_SEED_PASSWORD`. The seed script refuses `--remote` and production execution, and it is not part of the Worker bundle.

For Vite hot reload, run `npm run dev` and open `http://127.0.0.1:5173`.

## Validation

```bash
npm run check:integrity
npm run audit:dependencies
npm run typecheck
npm run build
npm test
npm run test:integration
npm run test:e2e
```

`npm run test:e2e` resets an isolated local Cloudflare state directory, builds the web app, applies all migrations, seeds synthetic data, starts Wrangler, and runs Chromium with fake camera and microphone devices. It creates two independent browser contexts and preserves screenshots/traces in the Playwright artifacts.

No production resources are created by these commands. `npm run build` performs a Worker deployment dry run only.

## Government notice

This software was produced for the U.S. Government under Contract Number 75FCMC18D0047, subject to FAR 52.227-14. See [LICENSE](LICENSE).

©2024 The MITRE Corporation. Approved for Public Release; Distribution Unlimited 24-0463.

The Cloudflare-native implementation preserves the original purpose, copyright, government notice, and licensing information. It does not claim to relicense the original work.
