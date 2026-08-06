/**
 * ACE Omni server API. All identity, ownership, immutable experiment versions,
 * room credentials, schedules, and evidence metadata are server-authoritative.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z, type ZodType } from "zod";
import {
  CallEventSchema,
  EvidenceArtifactSchema,
  EvidenceArtifactTypeSchema,
  EvidenceManifestSchema,
  ExperimentConfigSchema,
  ExperimentScheduleSchema,
  ParticipantAccessClaimsSchema,
  RoomCredentialClaimsSchema,
  type EvidenceArtifact,
  type EvidenceArtifactType,
  type ParticipantAccessClaims,
} from "@ace-omni/domain";
import type { WorkerEnv } from "./env";
import {
  assertRuntimeSecrets,
  canonicalJson,
  createToken,
  hashToken,
  sha256Hex,
  signClaims,
  verifyClaims,
  verifyPassword,
} from "./security";

const SESSION_COOKIE = "omni_session";
const CSRF_COOKIE = "omni_csrf";
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const PARTICIPANT_TTL_MS = 4 * 60 * 60 * 1_000;
const ROOM_CREDENTIAL_TTL_MS = 60 * 1_000;
const UPLOAD_CREDENTIAL_TTL_MS = 10 * 60 * 1_000;

interface ResearcherContext {
  userId: string;
  email: string;
  displayName: string;
  role: "administrator" | "researcher";
  sessionId: string;
  csrfHash: string;
}

type AppBindings = {
  Bindings: WorkerEnv;
  Variables: {
    researcher: ResearcherContext;
    participant: ParticipantAccessClaims;
    participantToken: string;
  };
};

type AppContext = Context<AppBindings>;

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1_024),
}).strict();

const CreateExperimentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  alias: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().max(2_000).default(""),
  purpose: z.string().max(2_000).default(""),
  config: ExperimentConfigSchema,
}).strict();

const CreateVersionSchema = z.object({
  config: ExperimentConfigSchema,
  revisionNote: z.string().trim().min(1).max(500),
}).strict();

const CreateCallSchema = z.object({
  experimentId: z.string().uuid(),
  version: z.number().int().positive().optional(),
  name: z.string().trim().max(200).optional(),
}).strict();

const CreateInvitationsSchema = z.object({
  ttlMinutes: z.number().int().min(1).max(24 * 60).default(120),
}).strict();

const RedeemInvitationSchema = z.object({ token: z.string().min(64).max(4_096) }).strict();

const InviteClaimsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("invitation"),
  invitationId: z.string().uuid(),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  participantConfigId: z.string().uuid(),
  role: z.enum(["caller", "callee", "communications_assistant"]),
  nonce: z.string().min(32),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

const CreateEvidenceUploadSchema = z.object({
  artifactType: EvidenceArtifactTypeSchema,
  contentType: z.enum(["audio/webm", "video/webm", "application/json"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
}).strict();

interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: string;
  csrf_hash: string | null;
  role: string;
  display_name: string;
  email: string;
}

interface ExperimentRow {
  id: string;
  name: string;
  alias: string;
  description: string;
  purpose: string;
  phase: string;
  config_json: string;
  current_version: number;
  created_by: string;
  modified_by: string;
  created_at: string;
  updated_at: string;
}

interface ExperimentVersionRow {
  id: string;
  experiment_id: string;
  version: number;
  schema_version: number;
  config_json: string;
  config_sha256: string;
  revision_note: string;
  created_by: string;
  created_at: string;
}

interface PinnedVersionRow extends ExperimentVersionRow {
  experiment_name: string;
  experiment_created_by: string;
}

interface CallRow {
  id: string;
  experiment_id: string;
  experiment_version_id: string;
  experiment_config_version: number;
  created_by: string;
  name: string;
  state: string;
  config_snapshot_json: string;
  config_sha256: string;
  schedule_json: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  failed_reason: string | null;
  evidence_manifest_key: string | null;
  replay_of_call_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ParticipantSessionRow {
  id: string;
  token_hash: string;
  invitation_id: string;
  call_id: string;
  experiment_id: string;
  experiment_version_id: string;
  participant_id: string;
  participant_config_id: string;
  display_name: string;
  role: "caller" | "callee" | "communications_assistant";
  expires_at: string;
}

interface CallParticipantRow {
  id: string;
  participant_config_id: string;
  display_name: string;
  role: "caller" | "callee" | "communications_assistant";
  joined_at: string | null;
  left_at: string | null;
}

interface CallEventRow {
  id: string;
  call_id: string;
  sequence: number;
  type: string;
  participant_id: string | null;
  payload_json: string;
  client_clock_ms: number | null;
  server_clock_ms: number;
  call_offset_ms: number | null;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  call_id: string;
  participant_id: string | null;
  artifact_type: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  etag: string;
  captured_at: string;
  uploaded_at: string;
}

interface ManifestRow {
  object_key: string;
  sha256: string;
  manifest_json: string;
  generated_at: string;
}

interface UploadCredentialRow {
  id: string;
  call_id: string;
  participant_id: string;
  artifact_type: string;
  object_key: string;
  expected_content_type: string;
  expected_sha256: string;
  expected_size_bytes: number;
  captured_at: string;
  max_bytes: number;
}

interface JsonReadSuccess<T> { success: true; data: T }
interface JsonReadFailure { success: false; message: string; details?: unknown }

async function readJson<T>(request: Request, schema: ZodType<T>): Promise<JsonReadSuccess<T> | JsonReadFailure> {
  try {
    const parsed = schema.safeParse(await request.json<unknown>());
    if (!parsed.success) {
      return { success: false, message: "Request validation failed", details: parsed.error.flatten() };
    }
    return { success: true, data: parsed.data };
  } catch {
    return { success: false, message: "Request body must be valid JSON" };
  }
}

function cookieOptions(environment: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "Strict" as const,
    path: "/",
    maxAge,
  };
}

function allowedOrigins(environment: WorkerEnv): Set<string> {
  return new Set(environment.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function mapExperiment(row: ExperimentRow) {
  return {
    id: row.id,
    name: row.name,
    alias: row.alias,
    description: row.description,
    purpose: row.purpose,
    phase: row.phase,
    config: ExperimentConfigSchema.parse(JSON.parse(row.config_json)),
    currentVersion: row.current_version,
    createdBy: row.created_by,
    modifiedBy: row.modified_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: ExperimentVersionRow) {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    version: row.version,
    schemaVersion: row.schema_version,
    config: ExperimentConfigSchema.parse(JSON.parse(row.config_json)),
    configSha256: row.config_sha256,
    revisionNote: row.revision_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapArtifact(row: ArtifactRow): EvidenceArtifact {
  return EvidenceArtifactSchema.parse({
    id: row.id,
    type: row.artifact_type,
    participantId: row.participant_id,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    etag: row.etag,
    capturedAt: row.captured_at,
    uploadedAt: row.uploaded_at,
  });
}

function mapCallEvent(row: CallEventRow) {
  return CallEventSchema.parse({
    id: row.id,
    callId: row.call_id,
    sequence: row.sequence,
    type: row.type,
    participantId: row.participant_id,
    payload: JSON.parse(row.payload_json),
    clientClockMs: row.client_clock_ms,
    serverClockMs: row.server_clock_ms,
    callOffsetMs: row.call_offset_ms,
    createdAt: row.created_at,
  });
}

async function audit(
  environment: WorkerEnv,
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await environment.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, action, resource_type, resource_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      resourceType,
      resourceId,
      canonicalJson(details),
      new Date().toISOString(),
    )
    .run();
}

async function researcherCanAccessExperiment(
  environment: WorkerEnv,
  experimentId: string,
  researcher: ResearcherContext,
): Promise<boolean> {
  const row = await environment.DB.prepare(
    `SELECT id FROM experiments
     WHERE id = ? AND (? = 'administrator' OR created_by = ?)`,
  )
    .bind(experimentId, researcher.role, researcher.userId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function getAuthorizedCall(
  environment: WorkerEnv,
  callId: string,
  researcher: ResearcherContext,
): Promise<CallRow | null> {
  return environment.DB.prepare(
    `SELECT id, experiment_id, experiment_version_id, experiment_config_version,
       created_by, name, state, config_snapshot_json, config_sha256, schedule_json,
       started_at, ended_at, duration_ms, failed_reason, evidence_manifest_key, replay_of_call_id,
       created_at, updated_at
     FROM calls
     WHERE id = ? AND (? = 'administrator' OR created_by = ?)`,
  )
    .bind(callId, researcher.role, researcher.userId)
    .first<CallRow>();
}

async function createPinnedCall(
  environment: WorkerEnv,
  researcher: ResearcherContext,
  version: PinnedVersionRow,
  name: string,
  replayOfCallId: string | null = null,
): Promise<string> {
  const callId = crypto.randomUUID();
  const now = new Date().toISOString();
  await environment.DB.prepare(
    `INSERT INTO calls (
       id, experiment_id, experiment_config_version, experiment_version_id,
       created_by, name, state, participants_json, config_snapshot_json,
       config_sha256, replay_of_call_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?, ?, ?, ?)`,
  )
    .bind(
      callId,
      version.experiment_id,
      version.version,
      version.id,
      researcher.userId,
      name,
      version.config_json,
      version.config_sha256,
      replayOfCallId,
      now,
      now,
    )
    .run();

  try {
    await environment.CALL_ROOM.getByName(callId).initialize({
      callId,
      experimentId: version.experiment_id,
      experimentVersionId: version.id,
      configVersion: version.version,
      configSha256: version.config_sha256,
      config: ExperimentConfigSchema.parse(JSON.parse(version.config_json)),
    });
  } catch (error) {
    await environment.DB.prepare(
      `UPDATE calls SET state = 'failed', failed_reason = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(error instanceof Error ? error.message : String(error), new Date().toISOString(), callId)
      .run();
    throw error;
  }
  return callId;
}

const securityMiddleware: MiddlewareHandler<AppBindings> = async (context, next) => {
  try {
    assertRuntimeSecrets(context.env);
  } catch (error) {
    console.error(JSON.stringify({
      message: "runtime_secret_validation_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return context.json({ error: "Service configuration is incomplete" }, 503);
  }

  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Cache-Control", "no-store");
  context.header("Cross-Origin-Opener-Policy", "same-origin");
  context.header("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );

  const origin = context.req.header("Origin");
  const allowed = allowedOrigins(context.env);
  if (origin && !allowed.has(origin)) {
    return context.json({ error: "Origin is not allowed" }, 403);
  }
  if (context.req.header("Sec-Fetch-Site") === "cross-site" && !["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    return context.json({ error: "Cross-site request rejected" }, 403);
  }
  if (origin) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Access-Control-Allow-Credentials", "true");
    context.header("Vary", "Origin");
  }
  if (context.req.method === "OPTIONS") {
    context.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    context.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
    return context.body(null, 204);
  }
  await next();
};

const requireResearcher: MiddlewareHandler<AppBindings> = async (context, next) => {
  const sessionToken = getCookie(context, SESSION_COOKIE);
  if (!sessionToken) return context.json({ error: "Unauthorized" }, 401);
  const row = await context.env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.csrf_hash,
       u.role, u.display_name, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
  )
    .bind(await hashToken(sessionToken))
    .first<SessionRow>();
  if (
    !row ||
    !row.csrf_hash ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    (row.role !== "administrator" && row.role !== "researcher")
  ) {
    deleteCookie(context, SESSION_COOKIE, { path: "/" });
    deleteCookie(context, CSRF_COOKIE, { path: "/" });
    return context.json({ error: "Unauthorized" }, 401);
  }
  context.set("researcher", {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    sessionId: row.session_id,
    csrfHash: row.csrf_hash,
  });
  await next();
};

const requireCsrf: MiddlewareHandler<AppBindings> = async (context, next) => {
  const researcher = context.get("researcher");
  const cookie = getCookie(context, CSRF_COOKIE);
  const header = context.req.header("X-CSRF-Token");
  if (
    !cookie ||
    !header ||
    (await hashToken(cookie)) !== researcher.csrfHash ||
    (await hashToken(header)) !== researcher.csrfHash
  ) {
    return context.json({ error: "CSRF validation failed" }, 403);
  }
  await next();
};

const requireParticipant: MiddlewareHandler<AppBindings> = async (context, next) => {
  const token = bearerToken(context.req.raw);
  if (!token) return context.json({ error: "Participant authorization required" }, 401);
  const claims = await verifyClaims(
    context.env.TOKEN_SIGNING_SECRET,
    token,
    ParticipantAccessClaimsSchema,
  );
  if (!claims) return context.json({ error: "Invalid participant credential" }, 401);
  const row = await context.env.DB.prepare(
    `SELECT id, token_hash, invitation_id, call_id, experiment_id,
       experiment_version_id, participant_id, participant_config_id,
       display_name, role, expires_at
     FROM participant_sessions
     WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(claims.sessionId, await hashToken(token), new Date().toISOString())
    .first<ParticipantSessionRow>();
  if (
    !row ||
    row.call_id !== claims.callId ||
    row.participant_id !== claims.participantId ||
    row.participant_config_id !== claims.participantConfigId ||
    row.role !== claims.role
  ) {
    return context.json({ error: "Invalid participant credential" }, 401);
  }
  context.set("participant", claims);
  context.set("participantToken", token);
  await next();
};

const app = new Hono<AppBindings>();
app.use("*", securityMiddleware);

app.onError((error, context) => {
  console.error(JSON.stringify({
    message: "unhandled_request_error",
    path: context.req.path,
    error: error.message,
  }));
  return context.json({ error: "Internal server error" }, 500);
});

app.get("/api/health", (context) =>
  context.json({
    status: "ok",
    service: "ace-omni",
    environment: context.env.ENVIRONMENT,
    time: new Date().toISOString(),
  }),
);

app.post("/api/auth/login", async (context) => {
  const body = await readJson(context.req.raw, LoginSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const user = await context.env.DB.prepare(
    `SELECT id, email, display_name, role, password_hash
     FROM users WHERE email = ? AND role IN ('administrator', 'researcher')`,
  )
    .bind(body.data.email.toLowerCase())
    .first<{ id: string; email: string; display_name: string; role: string; password_hash: string }>();
  if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
    return context.json({ error: "Invalid credentials" }, 401);
  }

  const sessionId = crypto.randomUUID();
  const sessionToken = createToken();
  const csrfToken = createToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO sessions (
         id, user_id, token_hash, csrf_hash, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      user.id,
      await hashToken(sessionToken),
      await hashToken(csrfToken),
      expiresAt.toISOString(),
      now.toISOString(),
    ),
    context.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(
      now.toISOString(),
      user.id,
    ),
  ]);
  setCookie(context, SESSION_COOKIE, sessionToken, cookieOptions(context.env.ENVIRONMENT, SESSION_TTL_MS / 1_000));
  setCookie(context, CSRF_COOKIE, csrfToken, {
    ...cookieOptions(context.env.ENVIRONMENT, SESSION_TTL_MS / 1_000),
    httpOnly: false,
  });
  await audit(context.env, user.id, "auth.login", "session", sessionId);
  return context.json({
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
    csrfToken,
    expiresAt: expiresAt.toISOString(),
  });
});

app.get("/api/auth/me", requireResearcher, (context) => {
  const researcher = context.get("researcher");
  return context.json({
    user: {
      id: researcher.userId,
      email: researcher.email,
      displayName: researcher.displayName,
      role: researcher.role,
    },
  });
});

app.post("/api/auth/logout", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  await context.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), researcher.sessionId)
    .run();
  deleteCookie(context, SESSION_COOKIE, { path: "/" });
  deleteCookie(context, CSRF_COOKIE, { path: "/" });
  await audit(context.env, researcher.userId, "auth.logout", "session", researcher.sessionId);
  return context.json({ ok: true });
});

app.get("/api/experiments", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const rows = await context.env.DB.prepare(
    `SELECT id, name, alias, description, purpose, phase, config_json,
       current_version, created_by, modified_by, created_at, updated_at
     FROM experiments
     WHERE ? = 'administrator' OR created_by = ?
     ORDER BY updated_at DESC`,
  )
    .bind(researcher.role, researcher.userId)
    .all<ExperimentRow>();
  return context.json({ experiments: rows.results.map(mapExperiment) });
});

app.post("/api/experiments", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const body = await readJson(context.req.raw, CreateExperimentSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const config = ExperimentConfigSchema.parse(body.data.config);
  const configJson = canonicalJson(config);
  const configSha256 = await sha256Hex(configJson);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO experiments (
           id, name, alias, description, purpose, phase, config_json, current_version,
           created_by, modified_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?)`,
      ).bind(
        id,
        body.data.name,
        body.data.alias,
        body.data.description,
        body.data.purpose,
        configJson,
        researcher.userId,
        researcher.userId,
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO experiment_versions (
           id, experiment_id, version, schema_version, config_json, config_sha256,
           revision_note, created_by, created_at
         ) VALUES (?, ?, 1, 1, ?, ?, 'Initial immutable version', ?, ?)`,
      ).bind(versionId, id, configJson, configSha256, researcher.userId, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return context.json({ error: "Experiment alias already exists" }, 409);
    }
    throw error;
  }
  await audit(context.env, researcher.userId, "experiment.create", "experiment", id, {
    versionId,
    configSha256,
  });
  return context.json({ id, versionId, version: 1, configSha256 }, 201);
});

app.get("/api/experiments/:id", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const row = await context.env.DB.prepare(
    `SELECT id, name, alias, description, purpose, phase, config_json,
       current_version, created_by, modified_by, created_at, updated_at
     FROM experiments
     WHERE id = ? AND (? = 'administrator' OR created_by = ?)`,
  )
    .bind(context.req.param("id"), researcher.role, researcher.userId)
    .first<ExperimentRow>();
  if (!row) return context.json({ error: "Experiment not found" }, 404);
  const versions = await context.env.DB.prepare(
    `SELECT id, experiment_id, version, schema_version, config_json, config_sha256,
       revision_note, created_by, created_at
     FROM experiment_versions WHERE experiment_id = ? ORDER BY version DESC`,
  )
    .bind(row.id)
    .all<ExperimentVersionRow>();
  return context.json({ ...mapExperiment(row), versions: versions.results.map(mapVersion) });
});

app.post("/api/experiments/:id/versions", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const experimentId = context.req.param("id");
  const body = await readJson(context.req.raw, CreateVersionSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const config = ExperimentConfigSchema.parse(body.data.config);
  const configJson = canonicalJson(config);
  const configSha256 = await sha256Hex(configJson);
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO experiment_versions (
         id, experiment_id, version, schema_version, config_json, config_sha256,
         revision_note, created_by, created_at
       )
       SELECT ?, id, current_version + 1, 1, ?, ?, ?, ?, ?
       FROM experiments
       WHERE id = ? AND (? = 'administrator' OR created_by = ?)`,
    ).bind(
      versionId,
      configJson,
      configSha256,
      body.data.revisionNote,
      researcher.userId,
      now,
      experimentId,
      researcher.role,
      researcher.userId,
    ),
    context.env.DB.prepare(
      `UPDATE experiments SET current_version = current_version + 1,
         config_json = ?, modified_by = ?, updated_at = ?
       WHERE id = ? AND (? = 'administrator' OR created_by = ?)`,
    ).bind(configJson, researcher.userId, now, experimentId, researcher.role, researcher.userId),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return context.json({ error: "Experiment not found" }, 404);
  const version = await context.env.DB.prepare(
    "SELECT version FROM experiment_versions WHERE id = ?",
  ).bind(versionId).first<{ version: number }>();
  await audit(context.env, researcher.userId, "experiment.version", "experiment", experimentId, {
    versionId,
    version: version?.version,
    configSha256,
  });
  return context.json({ versionId, version: version?.version, configSha256 }, 201);
});

app.post("/api/calls", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const body = await readJson(context.req.raw, CreateCallSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const version = await context.env.DB.prepare(
    `SELECT ev.id, ev.experiment_id, ev.version, ev.schema_version, ev.config_json,
       ev.config_sha256, ev.revision_note, ev.created_by, ev.created_at,
       e.name AS experiment_name, e.created_by AS experiment_created_by
     FROM experiment_versions ev JOIN experiments e ON e.id = ev.experiment_id
     WHERE ev.experiment_id = ?
       AND ev.version = COALESCE(?, e.current_version)
       AND (? = 'administrator' OR e.created_by = ?)`,
  )
    .bind(body.data.experimentId, body.data.version ?? null, researcher.role, researcher.userId)
    .first<PinnedVersionRow>();
  if (!version) return context.json({ error: "Experiment version not found" }, 404);
  const callId = await createPinnedCall(
    context.env,
    researcher,
    version,
    body.data.name || `${version.experiment_name} — ${new Date().toISOString()}`,
  );
  await audit(context.env, researcher.userId, "call.create", "call", callId, {
    experimentVersionId: version.id,
    configSha256: version.config_sha256,
  });
  return context.json({ callId, experimentId: version.experiment_id, version: version.version }, 201);
});

app.post("/api/calls/:id/invitations", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  if (!['pending', 'waiting'].includes(call.state)) {
    return context.json({ error: "Invitations can only be issued before a call starts" }, 409);
  }
  const body = await readJson(context.req.raw, CreateInvitationsSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const config = ExperimentConfigSchema.parse(JSON.parse(call.config_snapshot_json));
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (body.data.ttlMinutes ?? 120) * 60_000;
  const invitations: Array<{
    invitationId: string;
    participantConfigId: string;
    role: string;
    token: string;
    joinUrl: string;
    expiresAt: string;
  }> = [];
  const statements: D1PreparedStatement[] = [];
  for (const participant of config.participants) {
    const invitationId = crypto.randomUUID();
    const claims = {
      version: 1 as const,
      kind: "invitation" as const,
      invitationId,
      callId: call.id,
      experimentId: call.experiment_id,
      experimentVersionId: call.experiment_version_id,
      participantConfigId: participant.id,
      role: participant.role,
      nonce: createToken(24),
      issuedAt,
      expiresAt,
    };
    const token = await signClaims(context.env.TOKEN_SIGNING_SECRET, claims);
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO invitations (
           id, experiment_id, experiment_version_id, call_id, participant_config_id,
           role, token_hash, expires_at, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        invitationId,
        call.experiment_id,
        call.experiment_version_id,
        call.id,
        participant.id,
        participant.role,
        await hashToken(token),
        new Date(expiresAt).toISOString(),
        researcher.userId,
        new Date(issuedAt).toISOString(),
      ),
    );
    invitations.push({
      invitationId,
      participantConfigId: participant.id,
      role: participant.role,
      token,
      // Keep the bearer token in the URL fragment so it is never sent in the
      // participant's initial HTTP request or written to Worker access logs.
      joinUrl: `/join#token=${encodeURIComponent(token)}`,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
  await context.env.DB.batch(statements);
  await audit(context.env, researcher.userId, "invitation.issue", "call", call.id, {
    invitationIds: invitations.map((invitation) => invitation.invitationId),
    expiresAt: new Date(expiresAt).toISOString(),
  });
  return context.json({ callId: call.id, invitations }, 201);
});

app.post("/api/invitations/redeem", async (context) => {
  const body = await readJson(context.req.raw, RedeemInvitationSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const claims = await verifyClaims(
    context.env.TOKEN_SIGNING_SECRET,
    body.data.token,
    InviteClaimsSchema,
  );
  if (!claims) return context.json({ error: "Invalid or expired invitation" }, 410);
  const call = await context.env.DB.prepare(
    `SELECT id, experiment_id, experiment_version_id, experiment_config_version,
       created_by, name, state, config_snapshot_json, config_sha256, schedule_json,
       started_at, ended_at, duration_ms, failed_reason, evidence_manifest_key, replay_of_call_id,
       created_at, updated_at
     FROM calls WHERE id = ? AND experiment_id = ? AND experiment_version_id = ?`,
  )
    .bind(claims.callId, claims.experimentId, claims.experimentVersionId)
    .first<CallRow>();
  if (!call || !['pending', 'waiting'].includes(call.state)) {
    return context.json({ error: "Invitation call is unavailable" }, 410);
  }
  const config = ExperimentConfigSchema.parse(JSON.parse(call.config_snapshot_json));
  const configuredParticipant = config.participants.find(
    (participant) => participant.id === claims.participantConfigId,
  );
  if (!configuredParticipant || configuredParticipant.role !== claims.role) {
    return context.json({ error: "Invitation does not match the pinned experiment" }, 410);
  }

  const participantId = crypto.randomUUID();
  const participantSessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  // Invitation expiry is the single-redemption deadline, not a lease on an
  // admitted participant. Redemption starts a separate, revocable session.
  const participantExpiresAt = issuedAt + PARTICIPANT_TTL_MS;
  const participantClaims: ParticipantAccessClaims = {
    version: 1,
    kind: "participant_access",
    sessionId: participantSessionId,
    participantId,
    participantConfigId: claims.participantConfigId,
    callId: claims.callId,
    experimentId: claims.experimentId,
    experimentVersionId: claims.experimentVersionId,
    role: claims.role,
    name: configuredParticipant.name,
    issuedAt,
    expiresAt: participantExpiresAt,
  };
  const participantToken = await signClaims(context.env.TOKEN_SIGNING_SECRET, participantClaims);
  const redeemedAt = new Date(issuedAt).toISOString();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE invitations SET redeemed_at = ?, participant_id = ?
       WHERE id = ? AND token_hash = ? AND call_id = ?
         AND participant_config_id = ? AND role = ?
         AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(
      redeemedAt,
      participantId,
      claims.invitationId,
      await hashToken(body.data.token),
      claims.callId,
      claims.participantConfigId,
      claims.role,
      redeemedAt,
    ),
    context.env.DB.prepare(
      `INSERT INTO participant_sessions (
         id, token_hash, invitation_id, call_id, experiment_id, experiment_version_id,
         participant_id, participant_config_id, display_name, role, expires_at, created_at
       )
       SELECT ?, ?, id, call_id, experiment_id, experiment_version_id,
         participant_id, participant_config_id, ?, role, ?, ?
       FROM invitations WHERE id = ? AND participant_id = ? AND redeemed_at = ?`,
    ).bind(
      participantSessionId,
      await hashToken(participantToken),
      configuredParticipant.name,
      new Date(participantExpiresAt).toISOString(),
      redeemedAt,
      claims.invitationId,
      participantId,
      redeemedAt,
    ),
    context.env.DB.prepare(
      `INSERT INTO call_participants (
         id, call_id, participant_session_id, participant_config_id,
         display_name, role, created_at
       )
       SELECT participant_id, call_id, id, participant_config_id,
         display_name, role, ? FROM participant_sessions WHERE id = ?`,
    ).bind(redeemedAt, participantSessionId),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
    return context.json({ error: "Invitation already used or expired" }, 410);
  }
  await audit(context.env, participantId, "invitation.redeem", "invitation", claims.invitationId, {
    callId: claims.callId,
    participantConfigId: claims.participantConfigId,
  });
  return context.json({
    callId: call.id,
    callName: call.name,
    experimentId: call.experiment_id,
    experimentVersionId: call.experiment_version_id,
    experimentConfigVersion: call.experiment_config_version,
    participantId,
    participantConfigId: configuredParticipant.id,
    participantName: configuredParticipant.name,
    role: configuredParticipant.role,
    config,
    participantToken,
    expiresAt: new Date(participantExpiresAt).toISOString(),
  });
});

app.post("/api/calls/:id/room-credentials", requireParticipant, async (context) => {
  const participant = context.get("participant");
  const callId = context.req.param("id");
  if (participant.callId !== callId) return context.json({ error: "Cross-room access denied" }, 403);
  const credentialId = crypto.randomUUID();
  const issuedAt = Date.now();
  const roomClaims = RoomCredentialClaimsSchema.parse({
    version: 1,
    kind: "room",
    credentialId,
    participantId: participant.participantId,
    participantConfigId: participant.participantConfigId,
    callId,
    experimentId: participant.experimentId,
    experimentVersionId: participant.experimentVersionId,
    role: participant.role,
    name: participant.name,
    issuedAt,
    expiresAt: issuedAt + ROOM_CREDENTIAL_TTL_MS,
  });
  const credential = await signClaims(context.env.TOKEN_SIGNING_SECRET, roomClaims);
  await context.env.DB.prepare(
    `INSERT INTO room_credentials (
       id, token_hash, participant_session_id, call_id, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      credentialId,
      await hashToken(credential),
      participant.sessionId,
      callId,
      new Date(roomClaims.expiresAt).toISOString(),
      new Date(issuedAt).toISOString(),
    )
    .run();
  return context.json({ credential, expiresAt: new Date(roomClaims.expiresAt).toISOString() });
});

app.get("/api/calls/:id/ws", async (context) => {
  if (context.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return context.json({ error: "WebSocket upgrade required" }, 426);
  }
  const protocols = (context.req.header("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim());
  const encodedCredential = protocols.find((protocol) => protocol.startsWith("credential."));
  const credential = encodedCredential?.slice("credential.".length);
  if (!credential) return context.json({ error: "Room credential required" }, 401);
  const claims = await verifyClaims(
    context.env.TOKEN_SIGNING_SECRET,
    credential,
    RoomCredentialClaimsSchema,
  );
  const callId = context.req.param("id");
  if (!claims || claims.callId !== callId) return context.json({ error: "Invalid room credential" }, 401);
  const usedAt = new Date().toISOString();
  const consumed = await context.env.DB.prepare(
    `UPDATE room_credentials SET used_at = ?
     WHERE id = ? AND token_hash = ? AND call_id = ?
       AND used_at IS NULL AND expires_at > ?
       AND EXISTS (
         SELECT 1 FROM participant_sessions ps
         WHERE ps.id = room_credentials.participant_session_id
           AND ps.participant_id = ? AND ps.revoked_at IS NULL AND ps.expires_at > ?
       )
     RETURNING id`,
  )
    .bind(
      usedAt,
      claims.credentialId,
      await hashToken(credential),
      callId,
      usedAt,
      claims.participantId,
      usedAt,
    )
    .first<{ id: string }>();
  if (!consumed) return context.json({ error: "Room credential expired or already used" }, 401);

  const headers = new Headers();
  headers.set("Upgrade", "websocket");
  headers.set("Connection", "Upgrade");
  headers.set("Sec-WebSocket-Protocol", "ace-omni.v1");
  headers.set("X-Omni-Room-Credential", credential);
  return context.env.CALL_ROOM.getByName(callId).fetch(
    new Request("https://call-room/connect", { headers }),
  );
});

app.get("/api/calls/:id", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  const [participants, artifacts, events, manifest] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, participant_config_id, display_name, role, joined_at, left_at
       FROM call_participants WHERE call_id = ? ORDER BY role`,
    ).bind(call.id).all<CallParticipantRow>(),
    context.env.DB.prepare(
      `SELECT id, call_id, participant_id, artifact_type, object_key, content_type,
         size_bytes, sha256, etag, captured_at, uploaded_at
       FROM evidence_artifacts WHERE call_id = ? ORDER BY uploaded_at`,
    ).bind(call.id).all<ArtifactRow>(),
    context.env.DB.prepare(
      `SELECT id, call_id, sequence, type, participant_id, payload_json,
         client_clock_ms, server_clock_ms, call_offset_ms, created_at
       FROM call_events WHERE call_id = ? ORDER BY sequence`,
    ).bind(call.id).all<CallEventRow>(),
    context.env.DB.prepare(
      `SELECT object_key, sha256, manifest_json, generated_at
       FROM evidence_manifests WHERE call_id = ?`,
    ).bind(call.id).first<ManifestRow>(),
  ]);
  return context.json({
    call: {
      id: call.id,
      experimentId: call.experiment_id,
      experimentVersionId: call.experiment_version_id,
      experimentConfigVersion: call.experiment_config_version,
      name: call.name,
      state: call.state,
      configSha256: call.config_sha256,
      configSnapshot: ExperimentConfigSchema.parse(JSON.parse(call.config_snapshot_json)),
      schedule: call.schedule_json ? ExperimentScheduleSchema.parse(JSON.parse(call.schedule_json)) : null,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      durationMs: call.duration_ms,
      failedReason: call.failed_reason,
      replayOfCallId: call.replay_of_call_id,
      evidenceManifestKey: call.evidence_manifest_key,
      createdAt: call.created_at,
      updatedAt: call.updated_at,
    },
    participants: participants.results.map((participant) => ({
      id: participant.id,
      participantConfigId: participant.participant_config_id,
      name: participant.display_name,
      role: participant.role,
      joinedAt: participant.joined_at,
      leftAt: participant.left_at,
    })),
    artifacts: artifacts.results.map(mapArtifact),
    events: events.results.map(mapCallEvent),
    manifest: manifest ? EvidenceManifestSchema.parse(JSON.parse(manifest.manifest_json)) : null,
  });
});

app.get("/api/experiments/:id/calls", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const experimentId = context.req.param("id");
  if (!(await researcherCanAccessExperiment(context.env, experimentId, researcher))) {
    return context.json({ error: "Experiment not found" }, 404);
  }
  const calls = await context.env.DB.prepare(
    `SELECT id, experiment_id, experiment_version_id, experiment_config_version,
       created_by, name, state, config_snapshot_json, config_sha256, schedule_json,
       started_at, ended_at, duration_ms, failed_reason, evidence_manifest_key, replay_of_call_id,
       created_at, updated_at
     FROM calls WHERE experiment_id = ? ORDER BY created_at DESC`,
  ).bind(experimentId).all<CallRow>();
  return context.json({
    calls: calls.results.map((call) => ({
      id: call.id,
      name: call.name,
      state: call.state,
      experimentVersionId: call.experiment_version_id,
      experimentConfigVersion: call.experiment_config_version,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      failedReason: call.failed_reason,
      artifactManifestKey: call.evidence_manifest_key,
      createdAt: call.created_at,
    })),
  });
});

function policyAllowsArtifact(config: z.output<typeof ExperimentConfigSchema>, type: EvidenceArtifactType): boolean {
  const policy = config.evidencePolicy;
  const mapping: Record<EvidenceArtifactType, boolean> = {
    microphone_audio: policy.microphoneAudio,
    received_audio: policy.receivedAudio,
    manipulated_audio: policy.manipulatedAudio,
    local_video: policy.localVideo,
    remote_video: policy.remoteVideo,
    captions_raw: policy.rawCaptions,
    captions_displayed: policy.displayedCaptions,
    experiment_events: false,
    config_snapshot: false,
    schedule: false,
  };
  return mapping[type];
}

app.post("/api/calls/:id/evidence/uploads", requireParticipant, async (context) => {
  const participant = context.get("participant");
  const callId = context.req.param("id");
  if (participant.callId !== callId) return context.json({ error: "Cross-room access denied" }, 403);
  const body = await readJson(context.req.raw, CreateEvidenceUploadSchema);
  if (!body.success) return context.json({ error: body.message, details: body.details }, 400);
  const call = await context.env.DB.prepare(
    `SELECT config_snapshot_json, state FROM calls WHERE id = ? AND experiment_version_id = ?`,
  ).bind(callId, participant.experimentVersionId).first<{ config_snapshot_json: string; state: string }>();
  if (!call) return context.json({ error: "Call not found" }, 404);
  const config = ExperimentConfigSchema.parse(JSON.parse(call.config_snapshot_json));
  if (!policyAllowsArtifact(config, body.data.artifactType)) {
    return context.json({ error: "Artifact is not authorized by the pinned evidence policy" }, 403);
  }
  if (body.data.sizeBytes > config.evidencePolicy.maxArtifactBytes) {
    return context.json({ error: "Artifact exceeds the evidence policy size limit" }, 413);
  }
  const uploadId = crypto.randomUUID();
  const uploadToken = createToken();
  const extension = body.data.contentType === "application/json" ? "json" : "webm";
  const objectKey = `calls/${callId}/participants/${participant.participantId}/${body.data.artifactType}/${uploadId}.${extension}`;
  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO evidence_upload_credentials (
       id, token_hash, call_id, participant_id, artifact_type, object_key,
       expected_content_type, expected_sha256, expected_size_bytes, captured_at,
       max_bytes, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uploadId,
      await hashToken(uploadToken),
      callId,
      participant.participantId,
      body.data.artifactType,
      objectKey,
      body.data.contentType,
      body.data.sha256,
      body.data.sizeBytes,
      body.data.capturedAt,
      config.evidencePolicy.maxArtifactBytes,
      new Date(now + UPLOAD_CREDENTIAL_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    )
    .run();
  return context.json({
    uploadId,
    uploadUrl: `/api/evidence/uploads/${uploadId}`,
    uploadToken,
    objectKey,
    expiresAt: new Date(now + UPLOAD_CREDENTIAL_TTL_MS).toISOString(),
  }, 201);
});

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function arrayBufferToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hexToArrayBuffer(hex));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

app.put("/api/evidence/uploads/:id", async (context) => {
  const token = bearerToken(context.req.raw);
  if (!token) return context.json({ error: "Evidence upload credential required" }, 401);
  const now = new Date().toISOString();
  const upload = await context.env.DB.prepare(
    `UPDATE evidence_upload_credentials SET used_at = ?
     WHERE id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING id, call_id, participant_id, artifact_type, object_key,
       expected_content_type, expected_sha256, expected_size_bytes, captured_at,
       max_bytes`,
  )
    .bind(now, context.req.param("id"), await hashToken(token), now)
    .first<UploadCredentialRow>();
  if (!upload) return context.json({ error: "Upload credential expired or already used" }, 401);
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0];
  const contentLength = Number(context.req.header("Content-Length"));
  if (contentType !== upload.expected_content_type) {
    return context.json({ error: "Evidence content type does not match its authorization" }, 400);
  }
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength !== upload.expected_size_bytes ||
    contentLength > upload.max_bytes
  ) {
    return context.json({ error: "Evidence size does not match its authorization" }, 400);
  }
  if (!context.req.raw.body) return context.json({ error: "Evidence body is required" }, 400);

  let object: R2Object;
  try {
    object = await context.env.EVIDENCE.put(upload.object_key, context.req.raw.body, {
      httpMetadata: { contentType: upload.expected_content_type },
      customMetadata: {
        callId: upload.call_id,
        participantId: upload.participant_id,
        artifactType: upload.artifact_type,
        sha256: upload.expected_sha256,
        capturedAt: upload.captured_at,
      },
      sha256: hexToArrayBuffer(upload.expected_sha256),
    });
  } catch (error) {
    console.warn(JSON.stringify({
      message: "evidence_checksum_rejected",
      uploadId: upload.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return context.json({ error: "Evidence checksum validation failed" }, 400);
  }
  const artifactId = upload.id;
  const uploadedAt = new Date().toISOString();
  await context.env.DB.prepare(
    `INSERT INTO evidence_artifacts (
       id, call_id, participant_id, artifact_type, object_key, content_type,
       size_bytes, sha256, etag, captured_at, uploaded_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      artifactId,
      upload.call_id,
      upload.participant_id,
      upload.artifact_type,
      upload.object_key,
      upload.expected_content_type,
      object.size,
      upload.expected_sha256,
      object.etag,
      upload.captured_at,
      uploadedAt,
      uploadedAt,
    )
    .run();
  await context.env.CALL_ROOM.getByName(upload.call_id).recordEvidenceUploaded({
    participantId: upload.participant_id,
    artifactId,
    artifactType: upload.artifact_type,
    objectKey: upload.object_key,
    sizeBytes: object.size,
    sha256: upload.expected_sha256,
    uploadedAt,
  });
  return context.json({ ok: true, artifactId, objectKey: upload.object_key, sha256: upload.expected_sha256 });
});

app.get("/api/calls/:id/evidence/:artifactId", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  const artifact = await context.env.DB.prepare(
    `SELECT id, call_id, participant_id, artifact_type, object_key, content_type,
       size_bytes, sha256, etag, captured_at, uploaded_at
     FROM evidence_artifacts WHERE id = ? AND call_id = ?`,
  ).bind(context.req.param("artifactId"), call.id).first<ArtifactRow>();
  if (!artifact) return context.json({ error: "Evidence artifact not found" }, 404);
  const object = await context.env.EVIDENCE.get(artifact.object_key);
  if (!object) return context.json({ error: "Evidence object is missing" }, 404);
  const storedSha256 = object.checksums.sha256
    ? arrayBufferToHex(object.checksums.sha256)
    : null;
  if (
    object.size !== artifact.size_bytes ||
    object.etag !== artifact.etag ||
    storedSha256 !== artifact.sha256 ||
    object.customMetadata?.sha256 !== artifact.sha256 ||
    object.customMetadata?.callId !== call.id ||
    object.customMetadata?.participantId !== artifact.participant_id
  ) {
    console.error(JSON.stringify({
      message: "evidence_integrity_mismatch",
      callId: call.id,
      artifactId: artifact.id,
      objectKey: artifact.object_key,
    }));
    return context.json({ error: "Evidence integrity validation failed" }, 409);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Digest", `SHA-256=${hexToBase64(artifact.sha256)}`);
  headers.set("Content-Disposition", `attachment; filename="${artifact.id}.${artifact.content_type === 'application/json' ? 'json' : 'webm'}"`);
  return new Response(object.body, { headers });
});

function requiredArtifactTypes(config: z.output<typeof ExperimentConfigSchema>): EvidenceArtifactType[] {
  return EvidenceArtifactTypeSchema.options.filter((type) => policyAllowsArtifact(config, type));
}

app.post("/api/calls/:id/finalize", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  const existing = await context.env.DB.prepare(
    `SELECT object_key, sha256, manifest_json, generated_at
     FROM evidence_manifests WHERE call_id = ?`,
  ).bind(call.id).first<ManifestRow>();
  if (existing) return context.json({ manifest: EvidenceManifestSchema.parse(JSON.parse(existing.manifest_json)) });
  if (call.state === "failed") {
    return context.json({
      error: "Call failed before a finalizable evidence record could be completed",
      code: "CALL_FAILED",
      failedReason: call.failed_reason ?? "unspecified_failure",
    }, 422);
  }
  if (call.state !== "ended" || !call.started_at || !call.ended_at || call.duration_ms === null || !call.schedule_json) {
    return context.json({ error: "Call lifecycle is not complete" }, 409);
  }
  const [participantRows, artifactRows, eventRows] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, participant_config_id, display_name, role, joined_at, left_at
       FROM call_participants WHERE call_id = ? ORDER BY role`,
    ).bind(call.id).all<CallParticipantRow>(),
    context.env.DB.prepare(
      `SELECT id, call_id, participant_id, artifact_type, object_key, content_type,
         size_bytes, sha256, etag, captured_at, uploaded_at
       FROM evidence_artifacts WHERE call_id = ? ORDER BY uploaded_at`,
    ).bind(call.id).all<ArtifactRow>(),
    context.env.DB.prepare(
      `SELECT id, call_id, sequence, type, participant_id, payload_json,
         client_clock_ms, server_clock_ms, call_offset_ms, created_at
       FROM call_events WHERE call_id = ? ORDER BY sequence`,
    ).bind(call.id).all<CallEventRow>(),
  ]);
  if (participantRows.results.length !== 2) {
    return context.json({ error: "Both configured participants must redeem invitations" }, 409);
  }
  const config = ExperimentConfigSchema.parse(JSON.parse(call.config_snapshot_json));
  const artifacts = artifactRows.results.map(mapArtifact);
  const required = requiredArtifactTypes(config);
  const missing = participantRows.results.flatMap((participant) =>
    required
      .filter((type) => !artifacts.some((artifact) => artifact.participantId === participant.id && artifact.type === type))
      .map((type) => ({ participantId: participant.id, type })),
  );
  if (missing.length > 0) return context.json({ error: "Configured evidence is incomplete", missing }, 409);
  const participants = participantRows.results.map((participant) => ({
    id: participant.id,
    participantConfigId: participant.participant_config_id,
    name: participant.display_name,
    role: participant.role,
    joinedAt: participant.joined_at,
    leftAt: participant.left_at,
  }));
  const events = eventRows.results.map(mapCallEvent);
  const generatedAt = new Date().toISOString();
  const manifest = EvidenceManifestSchema.parse({
    version: 1,
    callId: call.id,
    experimentId: call.experiment_id,
    experimentVersionId: call.experiment_version_id,
    experimentConfigVersion: call.experiment_config_version,
    configSha256: call.config_sha256,
    configSnapshot: config,
    schedule: ExperimentScheduleSchema.parse(JSON.parse(call.schedule_json)),
    participants,
    startedAt: call.started_at,
    endedAt: call.ended_at,
    durationMs: call.duration_ms,
    artifacts,
    events,
    eventsSha256: await sha256Hex(canonicalJson(events)),
    generatedAt,
    generatedBy: researcher.userId,
  });
  const manifestJson = canonicalJson(manifest);
  const manifestSha256 = await sha256Hex(manifestJson);
  const manifestId = crypto.randomUUID();
  const objectKey = `calls/${call.id}/manifest/v1-${manifestSha256}.json`;
  const object = await context.env.EVIDENCE.put(objectKey, manifestJson, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { callId: call.id, sha256: manifestSha256, schemaVersion: "1" },
    sha256: hexToArrayBuffer(manifestSha256),
  });
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO evidence_manifests (
         id, call_id, schema_version, object_key, sha256, manifest_json,
         generated_by, generated_at
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(manifestId, call.id, objectKey, manifestSha256, manifestJson, researcher.userId, generatedAt),
    context.env.DB.prepare(
      `UPDATE calls SET evidence_manifest_key = ?, updated_at = ? WHERE id = ?`,
    ).bind(objectKey, generatedAt, call.id),
  ]);
  await audit(context.env, researcher.userId, "evidence.finalize", "call", call.id, {
    manifestId,
    objectKey,
    manifestSha256,
    etag: object.etag,
  });
  return context.json({ manifest, objectKey, sha256: manifestSha256 }, 201);
});

app.get("/api/calls/:id/manifest", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  const manifest = await context.env.DB.prepare(
    `SELECT object_key, sha256, manifest_json, generated_at
     FROM evidence_manifests WHERE call_id = ?`,
  ).bind(call.id).first<ManifestRow>();
  if (!manifest) return context.json({ error: "Evidence manifest not found" }, 404);
  return new Response(manifest.manifest_json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="ace-omni-${call.id}-manifest-v1.json"`,
      Digest: `sha-256=${manifest.sha256}`,
    },
  });
});

app.get("/api/calls/:id/export", requireResearcher, async (context) => {
  const researcher = context.get("researcher");
  const call = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!call) return context.json({ error: "Call not found" }, 404);
  const [version, manifest, events] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, experiment_id, version, schema_version, config_json, config_sha256,
         revision_note, created_by, created_at
       FROM experiment_versions WHERE id = ?`,
    ).bind(call.experiment_version_id).first<ExperimentVersionRow>(),
    context.env.DB.prepare(
      `SELECT object_key, sha256, manifest_json, generated_at
       FROM evidence_manifests WHERE call_id = ?`,
    ).bind(call.id).first<ManifestRow>(),
    context.env.DB.prepare(
      `SELECT id, call_id, sequence, type, participant_id, payload_json,
         client_clock_ms, server_clock_ms, call_offset_ms, created_at
       FROM call_events WHERE call_id = ? ORDER BY sequence`,
    ).bind(call.id).all<CallEventRow>(),
  ]);
  if (!version) return context.json({ error: "Pinned experiment version is missing" }, 500);
  const exportDocument = {
    version: 1,
    exportedAt: new Date().toISOString(),
    call: {
      id: call.id,
      name: call.name,
      state: call.state,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      durationMs: call.duration_ms,
      replayOfCallId: call.replay_of_call_id,
    },
    experimentVersion: mapVersion(version),
    schedule: call.schedule_json ? ExperimentScheduleSchema.parse(JSON.parse(call.schedule_json)) : null,
    events: events.results.map(mapCallEvent),
    evidenceManifest: manifest ? EvidenceManifestSchema.parse(JSON.parse(manifest.manifest_json)) : null,
  };
  return new Response(canonicalJson(exportDocument), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="ace-omni-${call.id}-research-export-v1.json"`,
    },
  });
});

app.post("/api/calls/:id/replay", requireResearcher, requireCsrf, async (context) => {
  const researcher = context.get("researcher");
  const source = await getAuthorizedCall(context.env, context.req.param("id"), researcher);
  if (!source) return context.json({ error: "Call not found" }, 404);
  const version = await context.env.DB.prepare(
    `SELECT ev.id, ev.experiment_id, ev.version, ev.schema_version, ev.config_json,
       ev.config_sha256, ev.revision_note, ev.created_by, ev.created_at,
       e.name AS experiment_name, e.created_by AS experiment_created_by
     FROM experiment_versions ev JOIN experiments e ON e.id = ev.experiment_id
     WHERE ev.id = ?`,
  ).bind(source.experiment_version_id).first<PinnedVersionRow>();
  if (!version) return context.json({ error: "Pinned experiment version is missing" }, 500);
  const callId = await createPinnedCall(
    context.env,
    researcher,
    version,
    `${source.name} — replay ${new Date().toISOString()}`,
    source.id,
  );
  await audit(context.env, researcher.userId, "call.replay", "call", callId, {
    sourceCallId: source.id,
    experimentVersionId: version.id,
    configSha256: version.config_sha256,
  });
  return context.json({ callId, replayOfCallId: source.id, experimentVersionId: version.id }, 201);
});

app.get("*", async (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
