/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { ExperimentConfigSchema } from "@ace-omni/domain";
import { hashPassword } from "../src/security";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct horse battery staple";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const CALLER_CONFIG_ID = "00000000-0000-4000-8000-000000000011";
const CALLEE_CONFIG_ID = "00000000-0000-4000-8000-000000000012";

const config = ExperimentConfigSchema.parse({
  version: 1,
  trsType: "IP_CTS",
  participants: [
    { id: CALLER_CONFIG_ID, name: "Synthetic caller", role: "caller", captions: { engine: "mock" } },
    { id: CALLEE_CONFIG_ID, name: "Synthetic callee", role: "callee", captions: { engine: "mock" } },
  ],
  timing: { callTimeoutSec: 30, scheduleLeadMs: 10, mockCaptionIntervalMs: 500 },
  manipulations: [
    {
      id: "caption-delay-caller",
      type: "caption_delay",
      targetRole: "caller",
      targetStream: "captions",
      startOffsetMs: 100,
      durationMs: 1_000,
      parameters: { delayMs: 250 },
      seed: 41,
    },
    {
      id: "gain-both",
      type: "gain",
      targetRole: "both",
      targetStream: "incoming",
      startOffsetMs: 200,
      durationMs: 1_000,
      parameters: { gainDb: -6 },
      seed: 42,
    },
  ],
  evidencePolicy: {
    microphoneAudio: true,
    receivedAudio: false,
    manipulatedAudio: false,
    localVideo: false,
    remoteVideo: false,
    rawCaptions: false,
    displayedCaptions: false,
    maxArtifactBytes: 1_048_576,
  },
  mockAsr: { utterances: ["Synthetic test caption."] },
});

let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, new Uint8Array(16).fill(7));
});

beforeEach(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, role, password_hash, created_at)
       VALUES (?, ?, ?, 'researcher', ?, ?)`,
    ).bind(OWNER_ID, "owner@omni.test", "Owner Researcher", passwordHash, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, role, password_hash, created_at)
       VALUES (?, ?, ?, 'researcher', ?, ?)`,
    ).bind(OTHER_ID, "other@omni.test", "Other Researcher", passwordHash, now),
  ]);
});

interface Session {
  cookie: string;
  csrf: string;
}

async function fetchApi(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, {
    ...init,
    headers,
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
  }));
}

function sessionHeaders(session: Session, csrf = true): HeadersInit {
  return {
    Cookie: session.cookie,
    ...(csrf ? { "X-CSRF-Token": session.csrf } : {}),
  };
}

async function login(email: string): Promise<Session> {
  const response = await fetchApi("/api/auth/login", {
    method: "POST",
    json: { email, password: PASSWORD },
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  const cookie = [...setCookie.matchAll(/(?:^|,\s*)(omni_(?:session|csrf)=[^;,]+)/g)]
    .map((match) => match[1])
    .join("; ");
  expect(cookie).toContain("omni_session=");
  expect(cookie).toContain("omni_csrf=");
  return { cookie, csrf: body.csrfToken };
}

async function createExperimentAndCall(session: Session, alias = `secure-${crypto.randomUUID()}`) {
  const experimentResponse = await fetchApi("/api/experiments", {
    method: "POST",
    headers: sessionHeaders(session),
    json: { name: "Security experiment", alias, config },
  });
  expect(experimentResponse.status).toBe(201);
  const experiment = await experimentResponse.json<{ id: string; versionId: string; configSha256: string }>();
  const callResponse = await fetchApi("/api/calls", {
    method: "POST",
    headers: sessionHeaders(session),
    json: { experimentId: experiment.id, version: 1, name: "Synthetic secure call" },
  });
  expect(callResponse.status).toBe(201);
  const call = await callResponse.json<{ callId: string }>();
  return { ...experiment, ...call };
}

async function issueInvitations(session: Session, callId: string) {
  const response = await fetchApi(`/api/calls/${callId}/invitations`, {
    method: "POST",
    headers: sessionHeaders(session),
    json: { ttlMinutes: 5 },
  });
  expect(response.status).toBe(201);
  return response.json<{
    invitations: Array<{
      invitationId: string;
      token: string;
      joinUrl: string;
      role: "caller" | "callee";
    }>;
  }>();
}

describe("research API security boundaries", () => {
  it("requires authentication, CSRF, and an exact allowed origin", async () => {
    const unauthenticated = await fetchApi("/api/experiments", {
      method: "POST",
      json: { name: "No", alias: "unauthorized", config },
    });
    expect(unauthenticated.status).toBe(401);

    const unauthenticatedEvidence = await fetchApi(
      "/api/evidence/uploads/00000000-0000-4000-8000-000000000099",
      { method: "PUT", body: "not evidence" },
    );
    expect(unauthenticatedEvidence.status).toBe(401);

    const session = await login("owner@omni.test");
    const missingCsrf = await fetchApi("/api/experiments", {
      method: "POST",
      headers: sessionHeaders(session, false),
      json: { name: "No", alias: "missing-csrf", config },
    });
    expect(missingCsrf.status).toBe(403);

    const crossOrigin = await exports.default.fetch(new Request("http://localhost:8787/api/experiments", {
      method: "GET",
      headers: { Origin: "https://attacker.example", Cookie: session.cookie },
    }));
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("enforces experiment and call ownership and immutable versions", async () => {
    const owner = await login("owner@omni.test");
    const other = await login("other@omni.test");
    const created = await createExperimentAndCall(owner);

    const hiddenExperiment = await fetchApi(`/api/experiments/${created.id}`, {
      headers: sessionHeaders(other, false),
    });
    expect(hiddenExperiment.status).toBe(404);
    const hiddenCall = await fetchApi(`/api/calls/${created.callId}`, {
      headers: sessionHeaders(other, false),
    });
    expect(hiddenCall.status).toBe(404);

    await expect(
      env.DB.prepare("UPDATE experiment_versions SET revision_note = 'tampered' WHERE id = ?")
        .bind(created.versionId)
        .run(),
    ).rejects.toThrow(/immutable/i);
  });

  it("redeems invitations atomically once and rejects tampering and expiration", async () => {
    const owner = await login("owner@omni.test");
    const created = await createExperimentAndCall(owner);
    const { invitations } = await issueInvitations(owner, created.callId);
    const caller = invitations.find((invitation) => invitation.role === "caller")!;
    expect(caller.joinUrl).toBe(`/join#token=${encodeURIComponent(caller.token)}`);
    expect(new URL(caller.joinUrl, "https://omni.test").pathname).toBe("/join");

    const tamperedToken = `${caller.token.slice(0, -1)}${caller.token.endsWith("a") ? "b" : "a"}`;
    const tampered = await fetchApi("/api/invitations/redeem", {
      method: "POST",
      json: { token: tamperedToken },
    });
    expect(tampered.status).toBe(410);

    const attempts = await Promise.all([
      fetchApi("/api/invitations/redeem", { method: "POST", json: { token: caller.token } }),
      fetchApi("/api/invitations/redeem", { method: "POST", json: { token: caller.token } }),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 410]);
    const sessions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM participant_sessions WHERE invitation_id = ?",
    ).bind(caller.invitationId).first<{ count: number }>();
    expect(sessions?.count).toBe(1);

    const callee = invitations.find((invitation) => invitation.role === "callee")!;
    await env.DB.prepare("UPDATE invitations SET expires_at = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", callee.invitationId)
      .run();
    const expired = await fetchApi("/api/invitations/redeem", {
      method: "POST",
      json: { token: callee.token },
    });
    expect(expired.status).toBe(410);
  });

  it("binds participant identity and credentials to exactly one call", async () => {
    const owner = await login("owner@omni.test");
    const first = await createExperimentAndCall(owner);
    const secondCallResponse = await fetchApi("/api/calls", {
      method: "POST",
      headers: sessionHeaders(owner),
      json: { experimentId: first.id, version: 1, name: "Other room" },
    });
    const second = await secondCallResponse.json<{ callId: string }>();
    const { invitations } = await issueInvitations(owner, first.callId);
    const invitation = invitations[0]!;
    const redeem = await fetchApi("/api/invitations/redeem", {
      method: "POST",
      json: { token: invitation.token },
    });
    const participant = await redeem.json<{ participantToken: string; participantId: string; role: string }>();

    const crossRoom = await fetchApi(`/api/calls/${second.callId}/room-credentials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${participant.participantToken}` },
    });
    expect(crossRoom.status).toBe(403);

    const spoofed = `${participant.participantToken.slice(0, -1)}${participant.participantToken.endsWith("a") ? "b" : "a"}`;
    const invalidIdentity = await fetchApi(`/api/calls/${first.callId}/room-credentials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${spoofed}` },
    });
    expect(invalidIdentity.status).toBe(401);
  });
});
