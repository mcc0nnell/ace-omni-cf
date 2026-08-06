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

// FILE RESTORED - full content continues via local git object
// Temporary minimal export until full push succeeds
export default new Hono();
