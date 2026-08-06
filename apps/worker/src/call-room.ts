/**
 * CallRoom Durable Object — authoritative real-time coordination for one call.
 * Owns presence, signaling, experiment clock, and schedule issuance.
 * Clients never trust each other for identity or configuration.
 */

import type { Env } from "./env";
import { hmacSign } from "./security";

interface ParticipantConnection {
  id: string;
  name: string;
  role: string;
  ws: WebSocket;
  joinedAt: number;
}

interface RoomState {
  callId: string;
  experimentId: string;
  configVersion: number;
  participants: Map<string, ParticipantConnection>;
  callClockStartMs: number | null;
  scheduleRevision: number;
  state: "waiting" | "active" | "ended";
}

export class CallRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room: RoomState | null = null;
  private sessions: Map<WebSocket, string> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/init" && request.method === "POST") {
      const body = (await request.json()) as {
        callId: string;
        experimentId: string;
        configVersion: number;
      };
      this.room = {
        callId: body.callId,
        experimentId: body.experimentId,
        configVersion: body.configVersion,
        participants: new Map(),
        callClockStartMs: null,
        scheduleRevision: 0,
        state: "waiting",
      };
      await this.state.storage.put("roomMeta", {
        callId: body.callId,
        experimentId: body.experimentId,
        configVersion: body.configVersion,
      });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/status") {
      return Response.json({
        room: this.room
          ? {
              callId: this.room.callId,
              state: this.room.state,
              participantCount: this.room.participants.size,
              callClockStartMs: this.room.callClockStartMs,
            }
          : null,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const participantId = url.searchParams.get("participantId");
    const name = url.searchParams.get("name") ?? "Participant";
    const role = url.searchParams.get("role") ?? "caller";

    if (!token || !participantId) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (!this.room) {
      const meta = await this.state.storage.get<{
        callId: string;
        experimentId: string;
        configVersion: number;
      }>("roomMeta");
      if (!meta) {
        return new Response("Call not initialized", { status: 404 });
      }
      this.room = {
        callId: meta.callId,
        experimentId: meta.experimentId,
        configVersion: meta.configVersion,
        participants: new Map(),
        callClockStartMs: null,
        scheduleRevision: 0,
        state: "waiting",
      };
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.sessions.set(server, participantId);

    const conn: ParticipantConnection = {
      id: participantId,
      name,
      role,
      ws: server,
      joinedAt: Date.now(),
    };
    this.room.participants.set(participantId, conn);

    this.broadcast(
      {
        type: "participant_joined",
        participant: { id: participantId, name, role },
        participants: this.listParticipants(),
      },
      participantId
    );

    server.send(
      JSON.stringify({
        type: "welcome",
        callId: this.room.callId,
        you: { id: participantId, name, role },
        participants: this.listParticipants(),
        callClockStartMs: this.room.callClockStartMs,
        state: this.room.state,
      })
    );

    if (this.room.participants.size >= 2 && this.room.state === "waiting") {
      this.room.state = "active";
      this.room.callClockStartMs = Date.now();
      await this.issueSchedule();
      this.broadcast({
        type: "call_started",
        callClockStartMs: this.room.callClockStartMs,
        participants: this.listParticipants(),
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const participantId = this.sessions.get(ws);
    if (!participantId || !this.room) return;

    let data: any;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (data.participantId && data.participantId !== participantId) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "identity_spoof",
          message: "Identity mismatch",
        })
      );
      return;
    }

    switch (data.type) {
      case "offer":
      case "answer":
      case "ice_candidate": {
        const targetId = data.targetId;
        if (!targetId || !this.room.participants.has(targetId)) return;
        const target = this.room.participants.get(targetId)!;
        target.ws.send(
          JSON.stringify({
            type: data.type,
            fromId: participantId,
            sdp: data.sdp,
            candidate: data.candidate,
          })
        );
        break;
      }
      case "manipulation_ack":
      case "manipulation_executed": {
        this.broadcast(
          {
            type: data.type,
            participantId,
            manipulationId: data.manipulationId,
            atMs: data.atMs ?? Date.now(),
          },
          participantId
        );
        break;
      }
      case "caption": {
        this.broadcast(
          {
            type: "caption",
            fromId: participantId,
            text: data.text,
            isFinal: data.isFinal,
            atMs: data.atMs,
          },
          participantId
        );
        break;
      }
      case "end_call": {
        this.room.state = "ended";
        this.broadcast({ type: "call_ended", endedAt: Date.now() });
        setTimeout(() => {
          for (const p of this.room!.participants.values()) {
            try {
              p.ws.close(1000, "call ended");
            } catch {}
          }
        }, 500);
        break;
      }
      default:
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    const participantId = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (participantId && this.room) {
      this.room.participants.delete(participantId);
      this.broadcast({
        type: "participant_left",
        participantId,
        participants: this.listParticipants(),
      });
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private listParticipants() {
    if (!this.room) return [];
    return Array.from(this.room.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
    }));
  }

  private broadcast(msg: unknown, excludeId?: string) {
    if (!this.room) return;
    const payload = JSON.stringify(msg);
    for (const p of this.room.participants.values()) {
      if (excludeId && p.id === excludeId) continue;
      try {
        p.ws.send(payload);
      } catch {}
    }
  }

  private async issueSchedule() {
    if (!this.room || this.room.callClockStartMs == null) return;

    this.room.scheduleRevision += 1;
    const manipulations = [
      {
        id: crypto.randomUUID(),
        type: "caption_delay",
        targetParticipantId: "*",
        targetStream: "captions",
        startOffsetMs: 5000,
        durationMs: 30000,
        parameters: { delayMs: 800 },
        seed: 42,
      },
      {
        id: crypto.randomUUID(),
        type: "background_noise",
        targetParticipantId: "*",
        targetStream: "incoming",
        startOffsetMs: 10000,
        durationMs: 15000,
        parameters: { gainDb: -18, source: "white" },
        seed: 43,
      },
    ];

    const scheduleBody = {
      callId: this.room.callId,
      experimentId: this.room.experimentId,
      configVersion: this.room.configVersion,
      scheduleRevision: this.room.scheduleRevision,
      callClockStartMs: this.room.callClockStartMs,
      manipulations,
    };

    const signature = await hmacSign(
      this.env.INVITE_SECRET || "dev-invite-secret",
      JSON.stringify(scheduleBody)
    );

    const schedule = { ...scheduleBody, signature };

    this.broadcast({
      type: "schedule_issued",
      schedule,
    });
  }
}
