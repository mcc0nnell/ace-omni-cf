/**
 * ACE Omni Cloudflare Worker
 * Hono API + Durable Object call coordination + static assets.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  hashPassword,
  verifyPassword,
  createToken,
  hashToken,
} from "./security";
import { CallRoom } from "./call-room";
import {
  ExperimentConfigSchema,
  createId,
  type ExperimentConfig,
} from "@ace-omni/domain";

export { CallRoom };

const app = new Hono<{
  Bindings: Env;
  Variables: { userId?: string; role?: string; user?: any };
}>();

app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self)"
  );
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-CSRF-Token"],
  })
);

async function requireSession(c: any, next: any) {
  const sessionId = getCookie(c, "omni_session");
  if (!sessionId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at, u.role, u.display_name, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`
  )
    .bind(sessionId)
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      role: string;
      display_name: string;
      email: string;
    }>();

  if (!row || new Date(row.expires_at) < new Date()) {
    deleteCookie(c, "omni_session", { path: "/" });
    return c.json({ error: "Session expired" }, 401);
  }
  c.set("userId", row.user_id);
  c.set("role", row.role);
  c.set("user", row);
  await next();
}

function requireRole(...roles: string[]) {
  return async (c: any, next: any) => {
    const role = c.get("role");
    if (!roles.includes(role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "ace-omni",
    environment: c.env.ENVIRONMENT || "development",
    time: new Date().toISOString(),
  })
);

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    return c.json({ error: "Email and password required" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, display_name, role, password_hash FROM users WHERE email = ?`
  )
    .bind(body.email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      password_hash: string;
    }>();

  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const sessionId = createId();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(sessionId, user.id, expiresAt, now)
    .run();

  await c.env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(now, user.id)
    .run();

  setCookie(c, "omni_session", sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  const csrf = createToken(16);
  setCookie(c, "omni_csrf", csrf, {
    httpOnly: false,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
    },
    csrf,
  });
});

app.post("/api/auth/logout", requireSession, async (c) => {
  const sessionId = getCookie(c, "omni_session");
  if (sessionId) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  }
  deleteCookie(c, "omni_session", { path: "/" });
  deleteCookie(c, "omni_csrf", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", requireSession, async (c) => {
  const user = c.get("user") as any;
  return c.json({
    user: {
      id: user.user_id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
    },
  });
});

app.get(
  "/api/experiments",
  requireSession,
  requireRole("administrator", "researcher"),
  async (c) => {
    const userId = c.get("userId") as string;
    const role = c.get("role") as string;
    let rows;
    if (role === "administrator") {
      rows = await c.env.DB.prepare(
        `SELECT id, name, alias, description, purpose, phase, config_json, created_by, created_at, updated_at
         FROM experiments ORDER BY updated_at DESC`
      ).all();
    } else {
      rows = await c.env.DB.prepare(
        `SELECT id, name, alias, description, purpose, phase, config_json, created_by, created_at, updated_at
         FROM experiments WHERE created_by = ? ORDER BY updated_at DESC`
      )
        .bind(userId)
        .all();
    }
    const experiments = (rows.results || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      alias: r.alias,
      description: r.description,
      purpose: r.purpose,
      phase: r.phase,
      config: JSON.parse(r.config_json),
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return c.json({ experiments });
  }
);

app.post(
  "/api/experiments",
  requireSession,
  requireRole("administrator", "researcher"),
  async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      name: string;
      alias: string;
      description?: string;
      purpose?: string;
      config: ExperimentConfig;
    }>();

    const parsed = ExperimentConfigSchema.safeParse(body.config);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid experiment configuration", details: parsed.error.flatten() },
        400
      );
    }

    const id = createId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO experiments (id, name, alias, description, purpose, phase, config_json, created_by, modified_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.name,
        body.alias,
        body.description ?? "",
        body.purpose ?? "",
        JSON.stringify(parsed.data),
        userId,
        userId,
        now,
        now
      )
      .run();

    return c.json({ id, name: body.name, alias: body.alias }, 201);
  }
);

app.get(
  "/api/experiments/:id",
  requireSession,
  requireRole("administrator", "researcher"),
  async (c) => {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(`SELECT * FROM experiments WHERE id = ?`)
      .bind(id)
      .first<any>();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({
      id: row.id,
      name: row.name,
      alias: row.alias,
      description: row.description,
      purpose: row.purpose,
      phase: row.phase,
      config: JSON.parse(row.config_json),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
);

app.post(
  "/api/experiments/:id/invitations",
  requireSession,
  requireRole("administrator", "researcher"),
  async (c) => {
    const experimentId = c.req.param("id");
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      participantConfigId: string;
      role: string;
      ttlMinutes?: number;
    }>();

    const exp = await c.env.DB.prepare(
      `SELECT id, config_json FROM experiments WHERE id = ?`
    )
      .bind(experimentId)
      .first<{ id: string; config_json: string }>();
    if (!exp) return c.json({ error: "Experiment not found" }, 404);

    const config = JSON.parse(exp.config_json) as ExperimentConfig;
    const participant = config.participants.find(
      (p: any, idx: number) => (p.id || String(idx)) === body.participantConfigId
    );
    if (!participant) {
      return c.json({ error: "Participant config not found" }, 400);
    }

    const inviteId = createId();
    const rawToken = createToken(24);
    const tokenHash = await hashToken(rawToken);
    const ttl = body.ttlMinutes ?? 60;
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO invitations (id, experiment_id, participant_config_id, role, token_hash, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        inviteId,
        experimentId,
        body.participantConfigId,
        body.role,
        tokenHash,
        expiresAt,
        userId,
        now
      )
      .run();

    return c.json({
      invitationId: inviteId,
      token: rawToken,
      expiresAt,
      joinUrl: `/join/${rawToken}`,
    });
  }
);

app.post("/api/invitations/redeem", async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) return c.json({ error: "Token required" }, 400);

  const tokenHash = await hashToken(body.token);
  const inv = await c.env.DB.prepare(
    `SELECT i.*, e.config_json, e.name as experiment_name
     FROM invitations i JOIN experiments e ON e.id = i.experiment_id
     WHERE i.token_hash = ?`
  )
    .bind(tokenHash)
    .first<any>();

  if (!inv) return c.json({ error: "Invalid invitation" }, 404);
  if (inv.redeemed_at) return c.json({ error: "Invitation already used" }, 410);
  if (new Date(inv.expires_at) < new Date()) {
    return c.json({ error: "Invitation expired" }, 410);
  }

  await c.env.DB.prepare(`UPDATE invitations SET redeemed_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), inv.id)
    .run();

  const config = JSON.parse(inv.config_json) as ExperimentConfig;
  const participant = config.participants.find(
    (p: any, idx: number) => (p.id || String(idx)) === inv.participant_config_id
  );

  const participantId = createId();

  return c.json({
    experimentId: inv.experiment_id,
    experimentName: inv.experiment_name,
    participantId,
    participantName: participant?.name ?? "Participant",
    role: inv.role,
    config: participant,
    dataCollection: config.dataCollection,
  });
});

app.post(
  "/api/calls",
  requireSession,
  requireRole("administrator", "researcher"),
  async (c) => {
    const body = await c.req.json<{ experimentId: string; name?: string }>();

    const exp = await c.env.DB.prepare(
      `SELECT id, config_json FROM experiments WHERE id = ?`
    )
      .bind(body.experimentId)
      .first<{ id: string; config_json: string }>();
    if (!exp) return c.json({ error: "Experiment not found" }, 404);

    const callId = createId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO calls (id, experiment_id, experiment_config_version, name, state, participants_json, created_at)
       VALUES (?, ?, 1, ?, 'pending', '[]', ?)`
    )
      .bind(
        callId,
        body.experimentId,
        body.name ?? `Call ${new Date().toISOString()}`,
        now
      )
      .run();

    const id = c.env.CALL_ROOM.idFromName(callId);
    const stub = c.env.CALL_ROOM.get(id);
    await stub.fetch("https://do/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId,
        experimentId: body.experimentId,
        configVersion: 1,
      }),
    });

    return c.json({ callId, experimentId: body.experimentId }, 201);
  }
);

app.get("/api/calls/:id", requireSession, async (c) => {
  const callId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM calls WHERE id = ?`)
    .bind(callId)
    .first<any>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({
    id: row.id,
    experimentId: row.experiment_id,
    name: row.name,
    state: row.state,
    participants: JSON.parse(row.participants_json || "[]"),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    evidenceManifestKey: row.evidence_manifest_key,
    createdAt: row.created_at,
  });
});

app.get("/api/calls/:id/ws", async (c) => {
  const callId = c.req.param("id");
  const url = new URL(c.req.url);
  const id = c.env.CALL_ROOM.idFromName(callId);
  const stub = c.env.CALL_ROOM.get(id);
  return stub.fetch(
    new Request(`https://do/ws?${url.searchParams.toString()}`, {
      headers: c.req.raw.headers,
    })
  );
});

app.post("/api/calls/:id/evidence/upload-url", requireSession, async (c) => {
  const callId = c.req.param("id");
  const body = await c.req.json<{
    type: string;
    participantId?: string;
    contentType: string;
  }>();

  const objectKey = `calls/${callId}/${body.type}/${createId()}`;
  return c.json({
    uploadUrl: `/api/calls/${callId}/evidence/upload?key=${encodeURIComponent(objectKey)}`,
    objectKey,
  });
});

app.put("/api/calls/:id/evidence/upload", async (c) => {
  const callId = c.req.param("id");
  const key = c.req.query("key");
  if (!key || !key.startsWith(`calls/${callId}/`)) {
    return c.json({ error: "Invalid key" }, 400);
  }
  const body = await c.req.arrayBuffer();
  await c.env.EVIDENCE.put(key, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "application/octet-stream",
    },
  });
  return c.json({ ok: true, key });
});

app.get("/api/calls/:id/evidence/:key{.+}", requireSession, async (c) => {
  const callId = c.req.param("id");
  const key = c.req.param("key");
  if (!key.startsWith(`calls/${callId}/`)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const obj = await c.env.EVIDENCE.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
    },
  });
});

app.get("*", async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("ACE Omni Worker — web assets not bound in this environment", 200);
});

export default app;
