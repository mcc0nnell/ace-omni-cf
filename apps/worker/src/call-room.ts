/**
 * One authoritative Durable Object per ACE Omni call.
 *
 * SQLite is the source of truth for room state and event sequencing. WebSocket
 * attachments preserve server-authorized identity across hibernation.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  ExperimentConfigSchema,
  ExperimentScheduleSchema,
  RoomCredentialClaimsSchema,
  type CallEventType,
  type ExperimentSchedule,
  type NormalizedExperimentConfig,
  type RoomCredentialClaims,
} from "@ace-omni/domain";
import { expandExperimentSchedule } from "@ace-omni/experiment-engine";
import type { WorkerEnv } from "./env";
import { canonicalJson, hmacSign, verifyClaims } from "./security";

const RoomInitializationSchema = z.object({
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  configVersion: z.number().int().positive(),
  configSha256: z.string().regex(/^[a-f0-9]{64}$/),
  config: ExperimentConfigSchema,
});

const SessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer", "pranswer", "rollback"]),
  sdp: z.string().max(128_000).optional(),
});

const SignalMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("offer"), targetId: z.string().uuid(), sdp: SessionDescriptionSchema }),
  z.object({ type: z.literal("answer"), targetId: z.string().uuid(), sdp: SessionDescriptionSchema }),
  z.object({
    type: z.literal("ice_candidate"),
    targetId: z.string().uuid(),
    candidate: z.record(z.unknown()),
  }),
  z.object({
    type: z.enum(["manipulation_ack", "manipulation_executed"]),
    manipulationId: z.string().min(1).max(120),
    clientClockMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.enum(["caption_raw", "caption_displayed"]),
    text: z.string().max(2_000),
    isFinal: z.boolean(),
    clientClockMs: z.number().int().nonnegative(),
    utteranceId: z.string().min(1).max(120),
  }),
  z.object({
    type: z.enum(["recording_started", "recording_stopped"]),
    artifactType: z.string().min(1).max(80),
    clientClockMs: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("end_call"), clientClockMs: z.number().int().nonnegative() }),
]);

const EvidenceEventSchema = z.object({
  participantId: z.string().uuid(),
  artifactId: z.string().uuid(),
  artifactType: z.string().min(1).max(80),
  objectKey: z.string().min(1).max(1_024),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedAt: z.string().datetime(),
});

interface RoomMetaRow {
  [key: string]: SqlStorageValue;
  call_id: string;
  experiment_id: string;
  experiment_version_id: string;
  config_version: number;
  config_sha256: string;
  config_json: string;
  state: "waiting" | "active" | "ended" | "failed";
  call_clock_start_ms: number | null;
  schedule_revision: number;
  schedule_json: string | null;
  ended_at_ms: number | null;
}

interface StoredEventRow {
  [key: string]: SqlStorageValue;
  sequence: number;
  event_id: string;
  type: CallEventType;
  participant_id: string | null;
  payload_json: string;
  client_clock_ms: number | null;
  server_clock_ms: number;
  call_offset_ms: number | null;
  created_at: string;
}

interface ConnectionAttachment {
  version: 1;
  connectionId: string;
  participantId: string;
  participantConfigId: string;
  role: "caller" | "callee" | "communications_assistant";
  name: string;
  joinedAt: number;
}

export interface RoomStatus {
  initialized: boolean;
  callId?: string;
  state?: RoomMetaRow["state"];
  callClockStartMs?: number | null;
  scheduleRevision?: number;
  connectedParticipantIds: string[];
}

export class CallRoom extends DurableObject<WorkerEnv> {
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        call_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        experiment_version_id TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        config_sha256 TEXT NOT NULL,
        config_json TEXT NOT NULL,
        state TEXT NOT NULL,
        call_clock_start_ms INTEGER,
        schedule_revision INTEGER NOT NULL DEFAULT 0,
        schedule_json TEXT,
        ended_at_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS participants (
        participant_id TEXT PRIMARY KEY,
        participant_config_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        joined_at_ms INTEGER NOT NULL,
        left_at_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS room_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        participant_id TEXT,
        payload_json TEXT NOT NULL,
        client_clock_ms INTEGER,
        server_clock_ms INTEGER NOT NULL,
        call_offset_ms INTEGER,
        created_at TEXT NOT NULL,
        d1_synced INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO _sql_schema_migrations (version, applied_at)
      VALUES (1, datetime('now'));
    `);
  }

  async initialize(input: unknown): Promise<RoomStatus> {
    const initialization = RoomInitializationSchema.parse(input);
    const existing = this.readMeta();
    if (existing) {
      if (
        existing.call_id !== initialization.callId ||
        existing.experiment_version_id !== initialization.experimentVersionId ||
        existing.config_sha256 !== initialization.configSha256
      ) {
        throw new Error("Call room is already initialized with different immutable metadata");
      }
      await this.syncPendingEvents();
      return this.getStatus();
    }

    const normalizedConfig = ExperimentConfigSchema.parse(initialization.config);
    this.ctx.storage.sql.exec(
      `INSERT INTO room_meta (
         singleton, call_id, experiment_id, experiment_version_id, config_version,
         config_sha256, config_json, state, schedule_revision
       ) VALUES (1, ?, ?, ?, ?, ?, ?, 'waiting', 0)`,
      initialization.callId,
      initialization.experimentId,
      initialization.experimentVersionId,
      initialization.configVersion,
      initialization.configSha256,
      canonicalJson(normalizedConfig),
    );

    await this.env.DB.prepare(
      `UPDATE calls SET state = 'waiting', updated_at = ? WHERE id = ? AND state = 'pending'`,
    )
      .bind(new Date().toISOString(), initialization.callId)
      .run();
    await this.recordEvent("room_initialized", null, {
      experimentVersionId: initialization.experimentVersionId,
      configSha256: initialization.configSha256,
    });
    return this.getStatus();
  }

  async getStatus(): Promise<RoomStatus> {
    await this.syncPendingEvents();
    const meta = this.readMeta();
    if (!meta) return { initialized: false, connectedParticipantIds: [] };
    return {
      initialized: true,
      callId: meta.call_id,
      state: meta.state,
      callClockStartMs: meta.call_clock_start_ms,
      scheduleRevision: meta.schedule_revision,
      connectedParticipantIds: this.activeConnections().map((connection) => connection.participantId),
    };
  }

  async recordEvidenceUploaded(input: unknown): Promise<void> {
    const evidence = EvidenceEventSchema.parse(input);
    const meta = this.requireMeta();
    const participant = this.ctx.storage.sql
      .exec<{ participant_id: string }>(
        "SELECT participant_id FROM participants WHERE participant_id = ?",
        evidence.participantId,
      )
      .toArray()[0];
    if (!participant) throw new Error("Evidence participant is not a member of this call");
    await this.recordEvent(
      "evidence_uploaded",
      evidence.participantId,
      {
        artifactId: evidence.artifactId,
        artifactType: evidence.artifactType,
        objectKey: evidence.objectKey,
        sizeBytes: evidence.sizeBytes,
        sha256: evidence.sha256,
        uploadedAt: evidence.uploadedAt,
      },
      null,
      meta,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/connect" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    await this.syncPendingEvents();
    const meta = this.readMeta();
    if (!meta) return new Response("Call room is not initialized", { status: 404 });
    if (meta.state === "ended" || meta.state === "failed") {
      return new Response("Call is closed", { status: 409 });
    }

    const token = request.headers.get("X-Omni-Room-Credential");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const claims = await verifyClaims(
      this.env.TOKEN_SIGNING_SECRET,
      token,
      RoomCredentialClaimsSchema,
    );
    if (!claims || claims.callId !== meta.call_id || claims.experimentVersionId !== meta.experiment_version_id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const config = ExperimentConfigSchema.parse(JSON.parse(meta.config_json));
    const configuredParticipant = config.participants.find(
      (participant) => participant.id === claims.participantConfigId,
    );
    if (
      !configuredParticipant ||
      configuredParticipant.role !== claims.role ||
      configuredParticipant.name !== claims.name
    ) {
      return new Response("Credential does not match the pinned experiment", { status: 403 });
    }

    return this.acceptParticipant(request, claims, meta);
  }

  private async acceptParticipant(
    request: Request,
    claims: RoomCredentialClaims,
    meta: RoomMetaRow,
  ): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment?.participantId === claims.participantId) {
        socket.close(4001, "Replaced by an authorized reconnect");
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    const attachment: ConnectionAttachment = {
      version: 1,
      connectionId: crypto.randomUUID(),
      participantId: claims.participantId,
      participantConfigId: claims.participantConfigId,
      role: claims.role,
      name: claims.name,
      joinedAt: now,
    };
    this.ctx.acceptWebSocket(server, [claims.role]);
    server.serializeAttachment(attachment);

    this.ctx.storage.sql.exec(
      `INSERT INTO participants (
         participant_id, participant_config_id, role, display_name, connection_id,
         joined_at_ms, left_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(participant_id) DO UPDATE SET
         connection_id = excluded.connection_id,
         joined_at_ms = excluded.joined_at_ms,
         left_at_ms = NULL`,
      claims.participantId,
      claims.participantConfigId,
      claims.role,
      claims.name,
      attachment.connectionId,
      now,
    );

    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE call_participants SET joined_at = COALESCE(joined_at, ?), left_at = NULL
         WHERE call_id = ? AND id = ?`,
      ).bind(new Date(now).toISOString(), meta.call_id, claims.participantId),
      this.env.DB.prepare(
        `UPDATE calls SET participants_json = (
           SELECT json_group_array(json_object(
             'id', id,
             'participantConfigId', participant_config_id,
             'name', display_name,
             'role', role,
             'joinedAt', joined_at,
             'leftAt', left_at
           )) FROM call_participants WHERE call_id = ?
         ), updated_at = ? WHERE id = ?`,
      ).bind(meta.call_id, new Date(now).toISOString(), meta.call_id),
    ]);

    await this.recordEvent("participant_joined", claims.participantId, {
      participantConfigId: claims.participantConfigId,
      role: claims.role,
      name: claims.name,
      connectionId: attachment.connectionId,
    });

    server.send(
      JSON.stringify({
        type: "welcome",
        callId: meta.call_id,
        you: this.publicParticipant(attachment),
        participants: this.connectedParticipants(),
        callClockStartMs: meta.call_clock_start_ms,
        state: meta.state,
        schedule: meta.schedule_json ? JSON.parse(meta.schedule_json) : null,
      }),
    );
    this.broadcast({
      type: "participant_joined",
      participant: this.publicParticipant(attachment),
      participants: this.connectedParticipants(),
    }, claims.participantId);

    if (meta.state === "waiting" && new Set(this.activeConnections().map((item) => item.participantId)).size === 2) {
      await this.startCall(meta);
    }

    const requestedProtocols = request.headers.get("Sec-WebSocket-Protocol") ?? "";
    const headers = new Headers();
    if (requestedProtocols.split(",").map((value) => value.trim()).includes("ace-omni.v1")) {
      headers.set("Sec-WebSocket-Protocol", "ace-omni.v1");
    }
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = this.attachment(socket);
    const meta = this.readMeta();
    if (!attachment || !meta || meta.state === "failed") return;
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text.length > 256_000) {
      this.sendError(socket, "message_too_large", "WebSocket message exceeds the call protocol limit");
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.sendError(socket, "invalid_message", "Message is not valid JSON");
      return;
    }

    if (
      raw &&
      typeof raw === "object" &&
      "participantId" in raw &&
      (raw as { participantId?: unknown }).participantId !== attachment.participantId
    ) {
      this.sendError(socket, "identity_spoof", "Client-controlled participant identity is forbidden");
      return;
    }

    const parsed = SignalMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendError(socket, "invalid_message", "Message does not match the call protocol");
      return;
    }
    const data = parsed.data;
    if (meta.state === "ended" && data.type !== "recording_stopped") return;

    if (data.type === "offer" || data.type === "answer" || data.type === "ice_candidate") {
      const target = this.socketForParticipant(data.targetId);
      if (!target) {
        this.sendError(socket, "invalid_target", "Signaling target is not connected to this call");
        return;
      }
      const outbound =
        data.type === "ice_candidate"
          ? { type: data.type, fromId: attachment.participantId, candidate: data.candidate }
          : { type: data.type, fromId: attachment.participantId, sdp: data.sdp };
      target.send(JSON.stringify(outbound));
      await this.recordEvent(data.type, attachment.participantId, { targetId: data.targetId });
      return;
    }

    if (data.type === "manipulation_ack" || data.type === "manipulation_executed") {
      const schedule = this.readSchedule(meta);
      const manipulation = schedule?.manipulations.find(
        (entry) =>
          entry.id === data.manipulationId && entry.targetParticipantId === attachment.participantId,
      );
      if (!manipulation) {
        this.sendError(socket, "invalid_manipulation", "Manipulation is not authorized for this participant");
        return;
      }
      await this.recordEvent(
        data.type,
        attachment.participantId,
        {
          manipulationId: data.manipulationId,
          scheduledForMs: (meta.call_clock_start_ms ?? 0) + manipulation.startOffsetMs,
          actualExecutionTimeMs: data.clientClockMs,
        },
        data.clientClockMs,
      );
      return;
    }

    if (data.type === "caption_raw" || data.type === "caption_displayed") {
      await this.recordEvent(
        data.type,
        attachment.participantId,
        {
          utteranceId: data.utteranceId,
          text: data.text,
          isFinal: data.isFinal,
        },
        data.clientClockMs,
      );
      this.broadcast(
        {
          type: data.type,
          fromId: attachment.participantId,
          utteranceId: data.utteranceId,
          text: data.text,
          isFinal: data.isFinal,
          clientClockMs: data.clientClockMs,
        },
        attachment.participantId,
      );
      return;
    }

    if (data.type === "recording_started" || data.type === "recording_stopped") {
      await this.recordEvent(
        data.type,
        attachment.participantId,
        { artifactType: data.artifactType },
        data.clientClockMs,
      );
      return;
    }

    if (data.type === "end_call") {
      if (meta.state !== "active") {
        await this.failCall(meta, "end_call_before_start", attachment.participantId);
        return;
      }
      await this.endCall(meta, attachment.participantId, data.clientClockMs);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (!attachment) return;
    const now = Date.now();
    const authoritativeClose = this.ctx.storage.sql.exec<{ participant_id: string }>(
      `UPDATE participants SET left_at_ms = ?
       WHERE participant_id = ? AND connection_id = ? AND left_at_ms IS NULL
       RETURNING participant_id`,
      now,
      attachment.participantId,
      attachment.connectionId,
    ).toArray();
    if (authoritativeClose.length === 0) return;

    await this.env.DB.prepare(
      `UPDATE call_participants SET left_at = ?
       WHERE call_id = ? AND id = ?`,
    )
      .bind(new Date(now).toISOString(), this.requireMeta().call_id, attachment.participantId)
      .run();
    await this.recordEvent("participant_left", attachment.participantId, {
      connectionId: attachment.connectionId,
    });
    this.broadcast({
      type: "participant_left",
      participantId: attachment.participantId,
      participants: this.connectedParticipants(),
    });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  private async startCall(meta: RoomMetaRow): Promise<void> {
    const latest = this.requireMeta();
    if (latest.state !== "waiting") return;
    const config = ExperimentConfigSchema.parse(JSON.parse(latest.config_json));
    const now = Date.now();
    const callClockStartMs = now + config.timing.scheduleLeadMs;
    const scheduleRevision = latest.schedule_revision + 1;
    const participantIdsByConfigId = Object.fromEntries(
      this.activeConnections().map((participant) => [
        participant.participantConfigId,
        participant.participantId,
      ]),
    );
    const body = expandExperimentSchedule({
      callId: latest.call_id,
      experimentId: latest.experiment_id,
      experimentVersionId: latest.experiment_version_id,
      configVersion: latest.config_version,
      scheduleRevision,
      callClockStartMs,
      issuedAt: new Date(now).toISOString(),
      config,
      participantIdsByConfigId,
    });
    const schedule = ExperimentScheduleSchema.parse({
      ...body,
      algorithm: "HMAC-SHA-256",
      signature: await hmacSign(this.env.SCHEDULE_SIGNING_SECRET, canonicalJson(body)),
    });
    const scheduleJson = canonicalJson(schedule);

    await this.ctx.storage.setAlarm(
      callClockStartMs + config.timing.callTimeoutSec * 1_000,
    );

    this.ctx.storage.sql.exec(
      `UPDATE room_meta SET
         state = 'active', call_clock_start_ms = ?, schedule_revision = ?, schedule_json = ?
       WHERE singleton = 1 AND state = 'waiting'`,
      callClockStartMs,
      scheduleRevision,
      scheduleJson,
    );
    const startedAt = new Date(callClockStartMs).toISOString();
    await this.env.DB.prepare(
      `UPDATE calls SET state = 'active', started_at = ?, schedule_json = ?,
         schedule_signature = ?, updated_at = ?
       WHERE id = ? AND state = 'waiting'`,
    )
      .bind(
        startedAt,
        scheduleJson,
        schedule.signature,
        new Date(now).toISOString(),
        latest.call_id,
      )
      .run();
    await this.recordEvent("call_started", null, { callClockStartMs });
    await this.recordEvent("schedule_issued", null, {
      scheduleRevision,
      signature: schedule.signature,
      manipulationCount: schedule.manipulations.length,
    });
    this.broadcast({
      type: "call_started",
      callClockStartMs,
      participants: this.connectedParticipants(),
    });
    this.broadcast({ type: "schedule_issued", schedule });
  }

  async alarm(): Promise<void> {
    const meta = this.readMeta();
    if (!meta || meta.state !== "active") return;
    await this.endCall(meta, null, null, "call_timeout");
    await this.syncPendingEvents();
  }

  private async endCall(
    meta: RoomMetaRow,
    participantId: string | null,
    clientClockMs: number | null,
    reason = "participant_end_call",
  ): Promise<void> {
    if (meta.state === "ended" || meta.state === "failed") return;
    if (meta.state !== "active") {
      await this.failCall(meta, "end_call_before_start", participantId);
      return;
    }
    const latest = this.requireMeta();
    if (latest.state === "ended" || latest.state === "failed") return;
    if (latest.state !== "active") {
      await this.failCall(latest, "end_call_before_start", participantId);
      return;
    }
    const endedAtMs = Date.now();
    const durationMs = Math.max(0, endedAtMs - (latest.call_clock_start_ms ?? endedAtMs));
    const transition = this.ctx.storage.sql.exec<{ call_id: string }>(
      `UPDATE room_meta SET state = 'ended', ended_at_ms = ?
       WHERE singleton = 1 AND state = 'active'
       RETURNING call_id`,
      endedAtMs,
    ).toArray();
    if (transition.length === 0) return;

    await this.ctx.storage.deleteAlarm();
    await this.env.DB.prepare(
      `UPDATE calls SET state = 'ended', ended_at = ?, duration_ms = ?,
         duration_sec = ?, updated_at = ? WHERE id = ? AND state = 'active'`,
    )
      .bind(
        new Date(endedAtMs).toISOString(),
        durationMs,
        durationMs / 1_000,
        new Date(endedAtMs).toISOString(),
        latest.call_id,
      )
      .run();
    await this.recordEvent(
      "call_ended",
      participantId,
      { endedAtMs, durationMs, reason },
      clientClockMs,
    );
    this.broadcast({ type: "call_ended", endedAtMs, durationMs, reason });
  }

  private async failCall(
    meta: RoomMetaRow,
    reason: string,
    participantId: string | null,
  ): Promise<void> {
    if (meta.state === "ended" || meta.state === "failed") return;
    const latest = this.requireMeta();
    if (latest.state === "ended" || latest.state === "failed") return;
    const transition = this.ctx.storage.sql.exec<{ call_id: string }>(
      `UPDATE room_meta SET state = 'failed'
       WHERE singleton = 1 AND state NOT IN ('ended', 'failed')
       RETURNING call_id`,
    ).toArray();
    if (transition.length === 0) return;

    await this.ctx.storage.deleteAlarm();
    const failedAt = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE calls SET state = 'failed', failed_reason = ?, updated_at = ?
       WHERE id = ? AND state NOT IN ('ended', 'failed')`,
    ).bind(reason, failedAt, latest.call_id).run();
    await this.recordEvent("call_failed", participantId, { reason, failedAt });
    this.broadcast({ type: "call_failed", reason, failedAt });
  }

  private async recordEvent(
    type: CallEventType,
    participantId: string | null,
    payload: Record<string, unknown>,
    clientClockMs: number | null = null,
    suppliedMeta?: RoomMetaRow,
  ): Promise<void> {
    const meta = suppliedMeta ?? this.requireMeta();
    const serverClockMs = Date.now();
    const createdAt = new Date(serverClockMs).toISOString();
    const callOffsetMs =
      meta.call_clock_start_ms === null ? null : serverClockMs - meta.call_clock_start_ms;
    const eventId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO room_events (
         event_id, type, participant_id, payload_json, client_clock_ms,
         server_clock_ms, call_offset_ms, created_at, d1_synced
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      eventId,
      type,
      participantId,
      canonicalJson(payload),
      clientClockMs,
      serverClockMs,
      callOffsetMs,
      createdAt,
    );
    await this.syncPendingEvents();
  }

  private async syncPendingEvents(): Promise<void> {
    const meta = this.readMeta();
    if (!meta) return;
    const pending = this.ctx.storage.sql
      .exec<StoredEventRow>(
        `SELECT sequence, event_id, type, participant_id, payload_json,
           client_clock_ms, server_clock_ms, call_offset_ms, created_at
         FROM room_events WHERE d1_synced = 0 ORDER BY sequence`,
      )
      .toArray();
    for (const event of pending) {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO call_events (
           id, call_id, sequence, type, participant_id, payload_json,
           client_clock_ms, server_clock_ms, call_offset_ms, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          event.event_id,
          meta.call_id,
          event.sequence,
          event.type,
          event.participant_id,
          event.payload_json,
          event.client_clock_ms,
          event.server_clock_ms,
          event.call_offset_ms,
          event.created_at,
        )
        .run();
      this.ctx.storage.sql.exec(
        "UPDATE room_events SET d1_synced = 1 WHERE sequence = ?",
        event.sequence,
      );
    }
  }

  private readMeta(): RoomMetaRow | null {
    return this.ctx.storage.sql
      .exec<RoomMetaRow>(
        `SELECT call_id, experiment_id, experiment_version_id, config_version,
           config_sha256, config_json, state, call_clock_start_ms,
           schedule_revision, schedule_json, ended_at_ms
         FROM room_meta WHERE singleton = 1`,
      )
      .toArray()[0] ?? null;
  }

  private requireMeta(): RoomMetaRow {
    const meta = this.readMeta();
    if (!meta) throw new Error("Call room is not initialized");
    return meta;
  }

  private readSchedule(meta: RoomMetaRow): ExperimentSchedule | null {
    if (!meta.schedule_json) return null;
    const parsed = ExperimentScheduleSchema.safeParse(JSON.parse(meta.schedule_json));
    return parsed.success ? parsed.data : null;
  }

  private attachment(socket: WebSocket): ConnectionAttachment | null {
    const attachment = socket.deserializeAttachment();
    if (!attachment || typeof attachment !== "object") return null;
    const candidate = attachment as Partial<ConnectionAttachment>;
    if (
      candidate.version !== 1 ||
      typeof candidate.participantId !== "string" ||
      typeof candidate.connectionId !== "string"
    ) {
      return null;
    }
    return candidate as ConnectionAttachment;
  }

  private activeConnections(): ConnectionAttachment[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = this.attachment(socket);
      return attachment ? [attachment] : [];
    });
  }

  private connectedParticipants(): Array<ReturnType<CallRoom["publicParticipant"]>> {
    return this.activeConnections().map((connection) => this.publicParticipant(connection));
  }

  private publicParticipant(connection: ConnectionAttachment) {
    return {
      id: connection.participantId,
      participantConfigId: connection.participantConfigId,
      name: connection.name,
      role: connection.role,
      joinedAt: new Date(connection.joinedAt).toISOString(),
    };
  }

  private socketForParticipant(participantId: string): WebSocket | null {
    return (
      this.ctx.getWebSockets().find(
        (socket) => this.attachment(socket)?.participantId === participantId,
      ) ?? null
    );
  }

  private broadcast(message: unknown, excludedParticipantId?: string): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment || attachment.participantId === excludedParticipantId) continue;
      try {
        socket.send(payload);
      } catch (error) {
        console.error(JSON.stringify({
          message: "call_room_broadcast_failed",
          participantId: attachment.participantId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    try {
      socket.send(JSON.stringify({ type: "error", code, message }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "call_room_error_delivery_failed",
        code,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
