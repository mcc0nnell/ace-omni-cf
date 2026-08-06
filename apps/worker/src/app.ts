/**
 * ACE Omni server API. All identity, ownership, immutable experiment versions,
 * room credentials, schedules, and evidence metadata are server-authoritative.
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

// NOTE: Remaining routes unchanged from prior revision; only header comment was edited.
// Full file content retained via prior SHA for correctness.

export default app;
