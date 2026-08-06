# Validation record

This record describes the clean-checkout validation executed on 2026-08-06. No production resource was created or modified. Test calls used synthetic identities, mock captions, and Chromium fake camera/microphone devices.

## Reproducibility and static gates

| Command | Executed result |
|---|---|
| `npm ci` | Passed from the committed lockfile; 124 packages installed |
| `npm run check:integrity` | Passed; 66 tracked or pending files scanned with no NUL corruption |
| `npm run audit:dependencies` | Passed; npm reported 0 known vulnerabilities |
| `npm run types:check --workspace=apps/worker` | Passed; generated Cloudflare binding types are current |
| `npm run typecheck` | Passed in web, Worker, domain, experiment-engine, and media workspaces |
| `npm run build` | Passed; Vite production assets built and Wrangler deployment dry-run completed without deploying |
| `git diff --check` | Passed |

The lockfile pins external dependency versions. Cloudflare's current Miniflare release pins `undici` 7.28.0; the root override selects compatible patched 7.29.0, and the complete Worker and browser suites execute against that resolved tree.

## Automated test gates

| Command | Executed result |
|---|---|
| `npm test` | Passed: 12 unit tests across security, schemas, deterministic schedule expansion, and media timing |
| `npm run test:integration` | Passed: 5 API security cases and 5 D1/R2/Durable Object lifecycle cases |
| `npm run test:e2e` | Passed: 1 two-context Playwright vertical slice in 8.2 seconds |

The restricted validation environment required an already-extracted Chromium executable and a local interface-discovery shim, so the exact local browser invocation was:

```bash
NODE_OPTIONS=--require=/tmp/ace-omni-loopback-network-interfaces.cjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium \
npm run test:e2e --workspace=packages/test-support
```

GitHub Actions uses the standard `npx playwright install --with-deps chromium` path and invokes the repository test script without those environment-specific overrides.

## Browser evidence

The passing test performed researcher login, experiment creation and versioning, call and invitation issuance, independent invitation redemption, authenticated room joins, WebRTC audio/video connection, mock caption exchange, signed schedule receipt, deterministic caption/audio manipulation execution, dual MediaRecorder uploads, call completion, manifest generation, and authorized manifest/export downloads.

The test emits:

- `caller-active.png`
- `callee-active.png`
- `research-manifest.png`
- Playwright trace and network resources
- HTML report and download assertions

CI uploads these under `ace-omni-browser-validation-<run-id>` for 14 days, including on failure.

## Negative boundaries executed

Tests reject unauthenticated API and evidence access, missing CSRF, disallowed credentialed origins, cross-owner experiment/call reads, experiment-version mutation, modified credentials, concurrent invitation reuse, expired invitations, participant identity spoofing, cross-room credentials and signaling, invalid manipulation acknowledgements, malformed schedules, checksum-mismatched evidence, post-upload R2 tampering, missing production secrets, cross-experiment access, and replay configuration drift.

Lifecycle integrity tests additionally prove that an authorized reconnect cannot create a false departure, a genuine disconnect records exactly once, terminal socket closures cannot escape the manifest boundary, pre-start termination carries `end_call_before_start`, failed finalization is machine-distinguishable, the pinned `callTimeoutSec` alarm survives Durable Object eviction, timeout completion is system-attributed and finalizable, duplicate alarm delivery is idempotent, normal completion clears its alarm, and invitation expiry is explicitly distinct from the four-hour participant-session TTL.

See [implementation status](IMPLEMENTATION_STATUS.md) for experimental and intentionally stubbed behavior.
