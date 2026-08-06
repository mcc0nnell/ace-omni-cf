/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { ExperimentConfigSchema, ExperimentScheduleSchema } from "@ace-omni/domain";
import { canonicalJson, hashPassword, hmacVerify, sha256Hex } from "../src/security";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct horse battery staple";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
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
});

const noArtifactConfig = ExperimentConfigSchema.parse({
  ...config,
  timing: { ...config.timing, callTimeoutSec: 5, scheduleLeadMs: 0 },
  evidencePolicy: {
    ...config.evidencePolicy,
    microphoneAudio: false,
    receivedAudio: false,
    manipulatedAudio: false,
    localVideo: false,
    remoteVideo: false,
    rawCaptions: false,
    displayedCaptions: false,
  },
});

let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, new Uint8Array(16).fill(9));
});

beforeEach(async () => {
  await applyD1Migrations(env.DB, inject("migrations"));
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, role, password_hash, created_at)
     VALUES (?, 'owner@omni.test', 'Owner Researcher', 'researcher', ?, ?)`,
  ).bind(OWNER_ID, passwordHash, new Date().toISOString()).run();
});

interface Session {
  cookie: string;
  csrf: string;
}

interface ParticipantAccess {
  participantToken: string;
  participantId: string;
  participantConfigId: string;
  role: "caller" | "callee";
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

async function login(): Promise<Session> {
  const response = await fetchApi("/api/auth/login", {
    method: "POST",
    json: { email: "owner@omni.test", password: PASSWORD },
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}`);
  const body = await response.json<{ csrfToken: string }>();
  const cookie = [...(response.headers.get("Set-Cookie") ?? "")
    .matchAll(/(?:^|,\s*)(omni_(?:session|csrf)=[^;,]+)/g)]
    .map((match) => match[1])
    .join("; ");
  return { cookie, csrf: body.csrfToken };
}

function researcherHeaders(session: Session): HeadersInit {
  return { Cookie: session.cookie, "X-CSRF-Token": session.csrf };
}

async function createExperiment(
  session: Session,
  experimentConfig: typeof config = config,
): Promise<string> {
  const response = await fetchApi("/api/experiments", {
    method: "POST",
    headers: researcherHeaders(session),
    json: {
      name: "Room experiment",
      alias: `room-${crypto.randomUUID()}`,
      config: experimentConfig,
    },
  });
  if (response.status !== 201) throw new Error(`Experiment creation failed: ${response.status}`);
  return (await response.json<{ id: string }>()).id;
}

async function createCall(session: Session, experimentId: string): Promise<string> {
  const response = await fetchApi("/api/calls", {
    method: "POST",
    headers: researcherHeaders(session),
    json: { experimentId, version: 1, name: "Room integration call" },
  });
  if (response.status !== 201) throw new Error(`Call creation failed: ${response.status}`);
  return (await response.json<{ callId: string }>()).callId;
}

async function redeemCall(session: Session, callId: string): Promise<ParticipantAccess[]> {
  const issued = await fetchApi(`/api/calls/${callId}/invitations`, {
    method: "POST",
    headers: researcherHeaders(session),
    json: { ttlMinutes: 5 },
  });
  if (issued.status !== 201) throw new Error(`Invitation creation failed: ${issued.status}`);
  const { invitations } = await issued.json<{
    invitations: Array<{ token: string }>;
  }>();
  return Promise.all(invitations.map(async ({ token }) => {
    const response = await fetchApi("/api/invitations/redeem", {
      method: "POST",
      json: { token },
    });
    if (response.status !== 200) throw new Error(`Invitation redemption failed: ${response.status}`);
    return response.json<ParticipantAccess>();
  }));
}

interface SocketHarness {
  socket: WebSocket;
  credential: string;
  closed: Promise<{ code: number; reason: string }>;
  next(type: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

async function authorizeAndUpload(
  callId: string,
  participant: ParticipantAccess,
  bytes: Uint8Array,
): Promise<{ artifactId: string; objectKey: string; sha256: string }> {
  const sha256 = await sha256Hex(bytes);
  const capturedAt = new Date().toISOString();
  const authorization = await fetchApi(`/api/calls/${callId}/evidence/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${participant.participantToken}` },
    json: {
      artifactType: "microphone_audio",
      contentType: "audio/webm",
      sizeBytes: bytes.byteLength,
      sha256,
      capturedAt,
    },
  });
  if (authorization.status !== 201) {
    throw new Error(`Upload authorization failed: ${authorization.status} ${await authorization.text()}`);
  }
  const credential = await authorization.json<{
    uploadId: string;
    uploadUrl: string;
    uploadToken: string;
    objectKey: string;
  }>();
  const upload = await fetchApi(credential.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${credential.uploadToken}`,
      "Content-Type": "audio/webm",
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (upload.status !== 200) {
    throw new Error(`Evidence upload failed: ${upload.status} ${await upload.text()}`);
  }
  return { artifactId: credential.uploadId, objectKey: credential.objectKey, sha256 };
}

async function connect(callId: string, participant: ParticipantAccess): Promise<SocketHarness> {
  const issued = await fetchApi(`/api/calls/${callId}/room-credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${participant.participantToken}` },
  });
  if (issued.status !== 200) throw new Error(`Room credential creation failed: ${issued.status}`);
  const { credential } = await issued.json<{ credential: string }>();
  const response = await fetchApi(`/api/calls/${callId}/ws`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `ace-omni.v1, credential.${credential}`,
    },
  });
  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`WebSocket connection failed: ${response.status} ${await response.text()}`);
  }
  const socket = response.webSocket;
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    type: string;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter!.timer);
      waiter!.resolve(message);
    } else {
      messages.push(message);
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener("close", (event) => {
      resolve({ code: event.code, reason: event.reason });
    }, { once: true });
  });
  socket.accept();

  return {
    socket,
    credential,
    closed,
    next(type: string) {
      const existingIndex = messages.findIndex((message) => message.type === type);
      if (existingIndex >= 0) return Promise.resolve(messages.splice(existingIndex, 1)[0]!);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for WebSocket message: ${type}`));
        }, 5_000);
        waiters.push({ type, resolve, reject, timer });
      });
    },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        socket.addEventListener("close", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        socket.close(1000, "test complete");
      });
    },
  };
}

async function expectTerminalStateAccountedFor(
  session: Session,
  callId: string,
): Promise<{ state: "ended" | "failed"; failedReason: string | null; manifest?: unknown }> {
  const call = await env.DB.prepare(
    "SELECT state, failed_reason FROM calls WHERE id = ?",
  ).bind(callId).first<{ state: string; failed_reason: string | null }>();
  expect(["ended", "failed"]).toContain(call?.state);

  const finalize = await fetchApi(`/api/calls/${callId}/finalize`, {
    method: "POST",
    headers: researcherHeaders(session),
  });
  if (call?.state === "failed") {
    expect(call.failed_reason).toBeTruthy();
    expect(finalize.status).toBe(422);
    await expect(finalize.json()).resolves.toMatchObject({
      code: "CALL_FAILED",
      failedReason: call.failed_reason,
    });
    return { state: "failed", failedReason: call.failed_reason };
  }

  expect(finalize.status).toBe(201);
  const finalized = await finalize.json<{ manifest: unknown }>();
  return { state: "ended", failedReason: null, manifest: finalized.manifest };
}

describe("authoritative call Durable Object", () => {
  it("ignores a replaced connection close but records a genuine disconnect", async () => {
    const session = await login();
    const experimentId = await createExperiment(session);
    const callId = await createCall(session, experimentId);
    const participants = await redeemCall(session, callId);
    const caller = participants.find((participant) => participant.role === "caller")!;
    const callee = participants.find((participant) => participant.role === "callee")!;

    const originalCallerSocket = await connect(callId, caller);
    await originalCallerSocket.next("welcome");
    const calleeSocket = await connect(callId, callee);
    await calleeSocket.next("welcome");
    await originalCallerSocket.next("schedule_issued");

    const replacementCallerSocket = await connect(callId, caller);
    await replacementCallerSocket.next("welcome");
    await expect(originalCallerSocket.closed).resolves.toMatchObject({ code: 4001 });

    const room = env.CALL_ROOM.getByName(callId);
    await room.getStatus();
    const presenceAfterReplacement = await env.DB.prepare(
      "SELECT left_at FROM call_participants WHERE call_id = ? AND id = ?",
    ).bind(callId, caller.participantId).first<{ left_at: string | null }>();
    const staleDepartureCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM call_events
       WHERE call_id = ? AND participant_id = ? AND type = 'participant_left'`,
    ).bind(callId, caller.participantId).first<{ count: number }>();

    expect(presenceAfterReplacement?.left_at).toBeNull();
    expect(staleDepartureCount?.count).toBe(0);
    await expect(room.getStatus()).resolves.toMatchObject({
      connectedParticipantIds: expect.arrayContaining([caller.participantId, callee.participantId]),
    });

    await replacementCallerSocket.close();
    await room.getStatus();
    const presenceAfterDisconnect = await env.DB.prepare(
      "SELECT left_at FROM call_participants WHERE call_id = ? AND id = ?",
    ).bind(callId, caller.participantId).first<{ left_at: string | null }>();
    const genuineDepartureCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM call_events
       WHERE call_id = ? AND participant_id = ? AND type = 'participant_left'`,
    ).bind(callId, caller.participantId).first<{ count: number }>();

    expect(presenceAfterDisconnect?.left_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(genuineDepartureCount?.count).toBe(1);
    await calleeSocket.close();
  });

  it("accounts for pre-start termination as an explicit failed terminal state", async () => {
    const session = await login();
    const experimentId = await createExperiment(session, noArtifactConfig);
    const callId = await createCall(session, experimentId);
    const participants = await redeemCall(session, callId);
    const caller = participants.find((participant) => participant.role === "caller")!;
    const callerSocket = await connect(callId, caller);
    await callerSocket.next("welcome");

    callerSocket.socket.send(JSON.stringify({ type: "end_call", clientClockMs: Date.now() }));
    const room = env.CALL_ROOM.getByName(callId);
    await room.getStatus();

    await expect(expectTerminalStateAccountedFor(session, callId)).resolves.toMatchObject({
      state: "failed",
      failedReason: "end_call_before_start",
    });
    const lifecycle = await env.DB.prepare(
      "SELECT state, started_at, ended_at, schedule_json, failed_reason FROM calls WHERE id = ?",
    ).bind(callId).first<{
      state: string;
      started_at: string | null;
      ended_at: string | null;
      schedule_json: string | null;
      failed_reason: string | null;
    }>();
    expect(lifecycle).toMatchObject({
      state: "failed",
      started_at: null,
      ended_at: null,
      schedule_json: null,
      failed_reason: "end_call_before_start",
    });
    const failureEvent = await env.DB.prepare(
      `SELECT participant_id, payload_json FROM call_events
       WHERE call_id = ? AND type = 'call_failed'`,
    ).bind(callId).first<{ participant_id: string | null; payload_json: string }>();
    expect(failureEvent?.participant_id).toBe(caller.participantId);
    expect(JSON.parse(failureEvent!.payload_json)).toMatchObject({ reason: "end_call_before_start" });
    const inspection = await fetchApi(`/api/calls/${callId}`, {
      headers: { Cookie: session.cookie },
    });
    expect(inspection.status).toBe(200);
    await expect(inspection.json()).resolves.toMatchObject({
      call: { state: "failed", failedReason: "end_call_before_start" },
      events: expect.arrayContaining([expect.objectContaining({ type: "call_failed" })]),
    });
    await callerSocket.close();
  });

  it("accounts for an abandoned active call by ending it at the configured alarm", async () => {
    const session = await login();
    const experimentId = await createExperiment(session, noArtifactConfig);
    const callId = await createCall(session, experimentId);
    const participants = await redeemCall(session, callId);
    const caller = participants.find((participant) => participant.role === "caller")!;
    const callee = participants.find((participant) => participant.role === "callee")!;
    const callerSocket = await connect(callId, caller);
    await callerSocket.next("welcome");
    const calleeSocket = await connect(callId, callee);
    await calleeSocket.next("welcome");
    await callerSocket.next("schedule_issued");

    const room = env.CALL_ROOM.getByName(callId);
    const status = await room.getStatus();
    const alarmAt = await runInDurableObject(room, (_instance, state) => state.storage.getAlarm());
    expect(alarmAt).toBe(status.callClockStartMs! + noArtifactConfig.timing.callTimeoutSec * 1_000);

    await Promise.all([callerSocket.close(), calleeSocket.close()]);
    expect(await runDurableObjectAlarm(room)).toBe(true);
    await expect(expectTerminalStateAccountedFor(session, callId)).resolves.toMatchObject({
      state: "ended",
      failedReason: null,
    });
    const timeoutEvent = await env.DB.prepare(
      `SELECT participant_id, payload_json FROM call_events
       WHERE call_id = ? AND type = 'call_ended'`,
    ).bind(callId).first<{ participant_id: string | null; payload_json: string }>();
    expect(timeoutEvent?.participant_id).toBeNull();
    expect(JSON.parse(timeoutEvent!.payload_json)).toMatchObject({ reason: "call_timeout" });
    expect(await runDurableObjectAlarm(room)).toBe(false);
    await runInDurableObject(room, (instance) => instance.alarm());
    const timeoutEndCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM call_events WHERE call_id = ? AND type = 'call_ended'",
    ).bind(callId).first<{ count: number }>();
    expect(timeoutEndCount?.count).toBe(1);
  });

  it("survives hibernation and isolates signed signaling, schedules, and identity", async () => {
    const session = await login();
    const experimentId = await createExperiment(session);
    const callId = await createCall(session, experimentId);
    const participants = await redeemCall(session, callId);
    const caller = participants.find((participant) => participant.role === "caller")!;
    const callee = participants.find((participant) => participant.role === "callee")!;

    const callerSocket = await connect(callId, caller);
    await callerSocket.next("welcome");
    const replayedCredential = await fetchApi(`/api/calls/${callId}/ws`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ace-omni.v1, credential.${callerSocket.credential}`,
      },
    });
    expect(replayedCredential.status).toBe(401);

    const calleeSocket = await connect(callId, callee);
    await calleeSocket.next("welcome");
    const scheduleMessage = await callerSocket.next("schedule_issued");
    const schedule = ExperimentScheduleSchema.parse(scheduleMessage.schedule);
    expect(new Set(schedule.manipulations.map((item) => item.targetParticipantId))).toEqual(
      new Set([caller.participantId, callee.participantId]),
    );
    const { signature, algorithm: _algorithm, ...scheduleBody } = schedule;
    expect(await hmacVerify(env.SCHEDULE_SIGNING_SECRET, canonicalJson(scheduleBody), signature)).toBe(true);

    const room = env.CALL_ROOM.getByName(callId);
    expect(await room.getStatus()).toMatchObject({
      state: "active",
      scheduleRevision: 1,
      connectedParticipantIds: expect.arrayContaining([caller.participantId, callee.participantId]),
    });
    const alarmBeforeEviction = await runInDurableObject(
      room,
      (_instance, state) => state.storage.getAlarm(),
    );
    await evictDurableObject(room);
    expect(await room.getStatus()).toMatchObject({
      state: "active",
      scheduleRevision: 1,
      connectedParticipantIds: expect.arrayContaining([caller.participantId, callee.participantId]),
    });
    await expect(runInDurableObject(
      room,
      (_instance, state) => state.storage.getAlarm(),
    )).resolves.toBe(alarmBeforeEviction);

    callerSocket.socket.send(JSON.stringify({
      type: "offer",
      targetId: callee.participantId,
      sdp: { type: "offer", sdp: "synthetic-sdp" },
    }));
    await expect(calleeSocket.next("offer")).resolves.toMatchObject({
      fromId: caller.participantId,
      sdp: { type: "offer", sdp: "synthetic-sdp" },
    });

    const secondCallId = await createCall(session, experimentId);
    const [foreignParticipant] = await redeemCall(session, secondCallId);
    callerSocket.socket.send(JSON.stringify({
      type: "offer",
      targetId: foreignParticipant!.participantId,
      sdp: { type: "offer", sdp: "cross-room" },
    }));
    await expect(callerSocket.next("error")).resolves.toMatchObject({ code: "invalid_target" });

    callerSocket.socket.send(JSON.stringify({
      type: "caption_raw",
      participantId: callee.participantId,
      utteranceId: "spoof",
      text: "forged identity",
      isFinal: true,
      clientClockMs: Date.now(),
    }));
    await expect(callerSocket.next("error")).resolves.toMatchObject({ code: "identity_spoof" });

    const callerManipulation = schedule.manipulations.find(
      (item) => item.targetParticipantId === caller.participantId,
    )!;
    callerSocket.socket.send(JSON.stringify({
      type: "manipulation_executed",
      manipulationId: callerManipulation.id,
      clientClockMs: Date.now(),
    }));
    calleeSocket.socket.send(JSON.stringify({
      type: "manipulation_ack",
      manipulationId: "caption-delay-caller",
      clientClockMs: Date.now(),
    }));
    await expect(calleeSocket.next("error")).resolves.toMatchObject({ code: "invalid_manipulation" });

    callerSocket.socket.send(JSON.stringify({ type: "end_call", clientClockMs: Date.now() }));
    await calleeSocket.next("call_ended");
    expect(await runDurableObjectAlarm(room)).toBe(false);
    const lifecycle = await env.DB.prepare(
      "SELECT state, schedule_json, duration_ms FROM calls WHERE id = ?",
    ).bind(callId).first<{ state: string; schedule_json: string; duration_ms: number }>();
    expect(lifecycle?.state).toBe("ended");
    expect(ExperimentScheduleSchema.parse(JSON.parse(lifecycle!.schedule_json))).toEqual(schedule);
    expect(lifecycle?.duration_ms).toBeGreaterThanOrEqual(0);
    const executed = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM call_events WHERE call_id = ? AND type = 'manipulation_executed'",
    ).bind(callId).first<{ count: number }>();
    expect(executed?.count).toBe(1);

    const tamperBytes = new TextEncoder().encode("synthetic-evidence-expected");
    const tamperAuthorization = await fetchApi(`/api/calls/${callId}/evidence/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${caller.participantToken}` },
      json: {
        artifactType: "microphone_audio",
        contentType: "audio/webm",
        sizeBytes: tamperBytes.byteLength,
        sha256: await sha256Hex(tamperBytes),
        capturedAt: new Date().toISOString(),
      },
    });
    const tamperCredential = await tamperAuthorization.json<{
      uploadUrl: string;
      uploadToken: string;
    }>();
    const alteredBytes = new TextEncoder().encode("synthetic-evidence-altered!");
    expect(alteredBytes.byteLength).toBe(tamperBytes.byteLength);
    const rejectedTamper = await fetchApi(tamperCredential.uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tamperCredential.uploadToken}`,
        "Content-Type": "audio/webm",
        "Content-Length": String(alteredBytes.byteLength),
      },
      body: alteredBytes,
    });
    expect(rejectedTamper.status).toBe(400);

    const callerArtifact = await authorizeAndUpload(
      callId,
      caller,
      new TextEncoder().encode("synthetic caller WebM evidence"),
    );
    await authorizeAndUpload(
      callId,
      callee,
      new TextEncoder().encode("synthetic callee WebM evidence"),
    );
    const finalize = await fetchApi(`/api/calls/${callId}/finalize`, {
      method: "POST",
      headers: researcherHeaders(session),
    });
    expect(finalize.status).toBe(201);
    const finalized = await finalize.json<{
      manifest: {
        callId: string;
        experimentVersionId: string;
        configSha256: string;
        schedule: unknown;
        participants: unknown[];
        artifacts: Array<{ id: string; sha256: string }>;
        events: Array<{ type: string }>;
        eventsSha256: string;
      };
      sha256: string;
    }>();
    expect(finalized.manifest).toMatchObject({
      callId,
      participants: expect.arrayContaining([
        expect.objectContaining({ id: caller.participantId }),
        expect.objectContaining({ id: callee.participantId }),
      ]),
      artifacts: expect.arrayContaining([
        expect.objectContaining({ id: callerArtifact.artifactId, sha256: callerArtifact.sha256 }),
      ]),
      events: expect.arrayContaining([expect.objectContaining({ type: "evidence_uploaded" })]),
    });
    expect(finalized.manifest.eventsSha256).toMatch(/^[a-f0-9]{64}$/);

    const evidenceDownload = await fetchApi(
      `/api/calls/${callId}/evidence/${callerArtifact.artifactId}`,
      { headers: { Cookie: session.cookie } },
    );
    expect(evidenceDownload.status).toBe(200);
    expect(new TextDecoder().decode(await evidenceDownload.arrayBuffer())).toBe(
      "synthetic caller WebM evidence",
    );

    await env.EVIDENCE.put(callerArtifact.objectKey, "tampered after upload", {
      httpMetadata: { contentType: "audio/webm" },
    });
    const detectedTamper = await fetchApi(
      `/api/calls/${callId}/evidence/${callerArtifact.artifactId}`,
      { headers: { Cookie: session.cookie } },
    );
    expect(detectedTamper.status).toBe(409);

    await expect(
      env.DB.prepare("UPDATE evidence_manifests SET manifest_json = '{}' WHERE call_id = ?")
        .bind(callId)
        .run(),
    ).rejects.toThrow(/immutable/i);

    const replayResponse = await fetchApi(`/api/calls/${callId}/replay`, {
      method: "POST",
      headers: researcherHeaders(session),
    });
    expect(replayResponse.status).toBe(201);
    const replay = await replayResponse.json<{ callId: string; replayOfCallId: string }>();
    expect(replay.replayOfCallId).toBe(callId);
    const replayPin = await env.DB.prepare(
      `SELECT replay.experiment_version_id AS replay_version,
         replay.config_sha256 AS replay_sha,
         source.experiment_version_id AS source_version,
         source.config_sha256 AS source_sha
       FROM calls replay JOIN calls source ON source.id = replay.replay_of_call_id
       WHERE replay.id = ?`,
    ).bind(replay.callId).first<{
      replay_version: string;
      replay_sha: string;
      source_version: string;
      source_sha: string;
    }>();
    expect(replayPin?.replay_version).toBe(replayPin?.source_version);
    expect(replayPin?.replay_sha).toBe(replayPin?.source_sha);

    await Promise.all([callerSocket.close(), calleeSocket.close()]);
  });
});
