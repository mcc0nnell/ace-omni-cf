/**
 * Shared, versioned research-domain contracts for ACE Omni.
 *
 * This work preserves the original ACE Omni government notice:
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import { z } from "zod";

const IsoDateSchema = z.string().datetime({ offset: true });
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const Base64UrlSchema = z
  .string()
  .min(32)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected unpadded base64url data");
const StableIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const RoleSchema = z.enum(["administrator", "researcher", "participant"]);
export type Role = z.infer<typeof RoleSchema>;

export const ResearcherRoleSchema = z.enum(["administrator", "researcher"]);
export const ParticipantRoleSchema = z.enum([
  "caller",
  "callee",
  "communications_assistant",
]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const TrsTypeSchema = z.enum([
  "IP_CTS",
  "IP_RELAY",
  "STS",
  "VCO",
  "VRS",
  "CUSTOM",
]);
export type TrsType = z.infer<typeof TrsTypeSchema>;

export const BackgroundNoiseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  source: z.enum(["white", "pink", "file"]).default("white"),
  fileId: z.string().uuid().optional(),
  gainDb: z.number().min(-60).max(0).default(-18),
});

export const PacketDropConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    durationMs: z.number().int().min(1).max(30_000).default(250),
    intervalMs: z.number().int().min(1).max(60_000).default(5_000),
  })
  .refine((value) => value.durationMs <= value.intervalMs, {
    message: "Packet-drop duration cannot exceed its interval",
    path: ["durationMs"],
  });

export const AudioFilterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(["lowpass", "highpass", "bandpass", "notch", "none"]).default("none"),
  frequencyHz: z.number().min(20).max(20_000).default(3_000),
  quality: z.number().min(0.0001).max(1_000).default(1),
  gainDb: z.number().min(-40).max(20).default(0),
});

export const AudioConditionSchema = z.object({
  backgroundNoise: BackgroundNoiseConfigSchema.default({}),
  packetDrop: PacketDropConfigSchema.default({}),
  filter: AudioFilterConfigSchema.default({}),
  mono: z.boolean().default(false),
  outputGainDb: z.number().min(-60).max(20).default(0),
});

export const AsrEngineSchema = z.enum([
  "mock",
  "workers_ai",
  "google",
  "ibm_watson",
  "azure",
  "amazon",
]);
export type AsrEngine = z.infer<typeof AsrEngineSchema>;

export const CaptionConfigSchema = z.object({
  engine: AsrEngineSchema.default("mock"),
  showFinalizedOnly: z.boolean().default(false),
  punctuation: z.boolean().default(true),
  baseDelayMs: z.number().int().min(0).max(10_000).default(0),
  language: z.string().min(2).max(35).default("en-US"),
  appearance: z
    .object({
      fontSize: z.enum(["small", "medium", "large"]).default("medium"),
      highContrast: z.boolean().default(false),
      attribution: z.boolean().default(true),
    })
    .default({}),
});

export const ParticipantConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  role: ParticipantRoleSchema,
  extension: z.string().trim().max(20).optional(),
  captions: CaptionConfigSchema.default({}),
  incomingAudio: AudioConditionSchema.default({}),
  outgoingAudio: AudioConditionSchema.default({}),
  media: z
    .object({
      audio: z.boolean().default(true),
      video: z.boolean().default(true),
    })
    .default({}),
});
export type ParticipantConfig = z.infer<typeof ParticipantConfigSchema>;

export const ManipulationTypeSchema = z.enum([
  "background_noise",
  "packet_drop",
  "audio_filter",
  "caption_delay",
  "caption_dropout",
  "caption_error",
  "gain",
  "video_lag",
  "video_jitter",
  "video_freeze",
]);
export type ManipulationType = z.infer<typeof ManipulationTypeSchema>;

export const ManipulationDefinitionSchema = z.object({
  id: StableIdSchema,
  type: ManipulationTypeSchema,
  targetRole: z.enum(["caller", "callee", "both"]),
  targetStream: z.enum(["incoming", "outgoing", "captions", "video"]),
  startOffsetMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().min(1).max(3_600_000),
  parameters: z.record(z.unknown()).default({}),
  seed: z.number().int().min(0).max(2_147_483_647),
});
export type ManipulationDefinition = z.infer<typeof ManipulationDefinitionSchema>;

export const ExperimentTimingSchema = z.object({
  startRule: z.literal("both_participants_ready").default("both_participants_ready"),
  callTimeoutSec: z.number().int().min(5).max(3_600).default(600),
  mockCaptionIntervalMs: z.number().int().min(250).max(30_000).default(4_500),
  scheduleLeadMs: z.number().int().min(0).max(10_000).default(250),
});

export const EvidencePolicySchema = z.object({
  microphoneAudio: z.boolean().default(true),
  receivedAudio: z.boolean().default(true),
  manipulatedAudio: z.boolean().default(true),
  localVideo: z.boolean().default(false),
  remoteVideo: z.boolean().default(false),
  rawCaptions: z.boolean().default(true),
  displayedCaptions: z.boolean().default(true),
  experimentEvents: z.boolean().default(true),
  maxArtifactBytes: z.number().int().min(1_024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),
  retentionDays: z.number().int().min(1).max(3_650).default(365),
});
export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;

export const ExperimentConfigSchema = z
  .object({
    version: z.literal(1),
    trsType: TrsTypeSchema.default("CUSTOM"),
    participants: z.array(ParticipantConfigSchema).length(2),
    timing: ExperimentTimingSchema.default({}),
    manipulations: z.array(ManipulationDefinitionSchema).max(100).default([]),
    evidencePolicy: EvidencePolicySchema.default({}),
    mockAsr: z
      .object({
        utterances: z.array(z.string().min(1).max(500)).min(1).max(100).optional(),
      })
      .default({}),
  })
  .superRefine((config, context) => {
    const participantIds = new Set(config.participants.map((participant) => participant.id));
    if (participantIds.size !== config.participants.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Participant configuration IDs must be unique",
      });
    }

    const callerCount = config.participants.filter((participant) => participant.role === "caller").length;
    const calleeCount = config.participants.filter((participant) => participant.role === "callee").length;
    if (callerCount !== 1 || calleeCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Version 1 requires exactly one caller and one callee",
      });
    }

    const manipulationIds = new Set<string>();
    const callTimeoutMs = config.timing.callTimeoutSec * 1_000;
    config.manipulations.forEach((manipulation, index) => {
      if (manipulationIds.has(manipulation.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index, "id"],
          message: "Manipulation IDs must be unique",
        });
      }
      manipulationIds.add(manipulation.id);
      if (manipulation.startOffsetMs + manipulation.durationMs > callTimeoutMs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index],
          message: "Manipulation exceeds the configured call timeout",
        });
      }
      if (manipulation.type.startsWith("caption_") && manipulation.targetStream !== "captions") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index, "targetStream"],
          message: "Caption manipulations must target the caption stream",
        });
      }
      if (manipulation.type.startsWith("video_") && manipulation.targetStream !== "video") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index, "targetStream"],
          message: "Video manipulations must target the video stream",
        });
      }
      if (!manipulation.type.startsWith("caption_") && manipulation.targetStream === "captions") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index, "targetStream"],
          message: "Non-caption manipulations cannot target the caption stream",
        });
      }
      if (!manipulation.type.startsWith("video_") && manipulation.targetStream === "video") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manipulations", index, "targetStream"],
          message: "Non-video manipulations cannot target the video stream",
        });
      }
    });
  });
export type ExperimentConfig = z.input<typeof ExperimentConfigSchema>;
export type NormalizedExperimentConfig = z.output<typeof ExperimentConfigSchema>;

export const ExperimentPhaseSchema = z.enum(["draft", "active", "archived"]);
export const ExperimentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  alias: z.string().trim().min(1).max(80),
  description: z.string().max(2_000),
  purpose: z.string().max(2_000),
  phase: ExperimentPhaseSchema,
  currentVersion: z.number().int().positive(),
  createdBy: z.string().uuid(),
  modifiedBy: z.string().uuid(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const ExperimentVersionSchema = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid(),
  version: z.number().int().positive(),
  schemaVersion: z.literal(1),
  config: ExperimentConfigSchema,
  configSha256: Sha256HexSchema,
  revisionNote: z.string().max(500),
  createdBy: z.string().uuid(),
  createdAt: IsoDateSchema,
});
export type ExperimentVersion = z.infer<typeof ExperimentVersionSchema>;

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  participantConfigId: z.string().uuid(),
  role: ParticipantRoleSchema,
  expiresAt: IsoDateSchema,
  redeemedAt: IsoDateSchema.nullable(),
  createdBy: z.string().uuid(),
  createdAt: IsoDateSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const CallStateSchema = z.enum([
  "pending",
  "waiting",
  "active",
  "ended",
  "failed",
]);
export type CallState = z.infer<typeof CallStateSchema>;

export const CallParticipantSchema = z.object({
  id: z.string().uuid(),
  participantConfigId: z.string().uuid(),
  name: z.string().min(1).max(120),
  role: ParticipantRoleSchema,
  joinedAt: IsoDateSchema.nullable(),
  leftAt: IsoDateSchema.nullable(),
});

export const CallSchema = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  experimentConfigVersion: z.number().int().positive(),
  createdBy: z.string().uuid(),
  name: z.string().max(200),
  state: CallStateSchema,
  participants: z.array(CallParticipantSchema),
  startedAt: IsoDateSchema.nullable(),
  endedAt: IsoDateSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  evidenceManifestKey: z.string().nullable(),
  createdAt: IsoDateSchema,
});
export type Call = z.infer<typeof CallSchema>;

export const ScheduledManipulationSchema = z.object({
  id: StableIdSchema,
  type: ManipulationTypeSchema,
  targetParticipantId: z.string().uuid(),
  targetRole: z.enum(["caller", "callee"]),
  targetStream: z.enum(["incoming", "outgoing", "captions", "video"]),
  startOffsetMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().positive().max(3_600_000),
  parameters: z.record(z.unknown()),
  seed: z.number().int().min(0).max(2_147_483_647),
});
export type ScheduledManipulation = z.infer<typeof ScheduledManipulationSchema>;

export const ExperimentScheduleBodySchema = z.object({
  version: z.literal(1),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  configVersion: z.number().int().positive(),
  scheduleRevision: z.number().int().positive(),
  callClockStartMs: z.number().int().nonnegative(),
  issuedAt: IsoDateSchema,
  manipulations: z.array(ScheduledManipulationSchema).max(200),
});
export type ExperimentScheduleBody = z.infer<typeof ExperimentScheduleBodySchema>;

export const ExperimentScheduleSchema = ExperimentScheduleBodySchema.extend({
  algorithm: z.literal("HMAC-SHA-256"),
  signature: Base64UrlSchema,
});
export type ExperimentSchedule = z.infer<typeof ExperimentScheduleSchema>;

export const CallEventTypeSchema = z.enum([
  "room_initialized",
  "participant_joined",
  "participant_ready",
  "participant_left",
  "offer",
  "answer",
  "ice_candidate",
  "call_started",
  "schedule_issued",
  "observation",
  "manipulation_ack",
  "manipulation_executed",
  "caption_raw",
  "caption_displayed",
  "recording_started",
  "recording_stopped",
  "evidence_uploaded",
  "call_ended",
  "call_failed",
  "error",
]);
export type CallEventType = z.infer<typeof CallEventTypeSchema>;

export const CallEventSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: CallEventTypeSchema,
  participantId: z.string().uuid().nullable(),
  payload: z.record(z.unknown()),
  clientClockMs: z.number().int().nonnegative().nullable(),
  serverClockMs: z.number().int().nonnegative(),
  callOffsetMs: z.number().int().nullable(),
  createdAt: IsoDateSchema,
});
export type CallEvent = z.infer<typeof CallEventSchema>;

export const EvidenceArtifactTypeSchema = z.enum([
  "microphone_audio",
  "received_audio",
  "manipulated_audio",
  "local_video",
  "remote_video",
  "captions_raw",
  "captions_displayed",
  "experiment_events",
  "config_snapshot",
  "schedule",
]);
export type EvidenceArtifactType = z.infer<typeof EvidenceArtifactTypeSchema>;

export const EvidenceArtifactSchema = z.object({
  id: z.string().uuid(),
  type: EvidenceArtifactTypeSchema,
  participantId: z.string().uuid().nullable(),
  objectKey: z.string().min(1).max(1_024),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  sha256: Sha256HexSchema,
  etag: z.string().min(1),
  capturedAt: IsoDateSchema,
  uploadedAt: IsoDateSchema,
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const EvidenceManifestSchema = z.object({
  version: z.literal(1),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  experimentConfigVersion: z.number().int().positive(),
  configSha256: Sha256HexSchema,
  configSnapshot: ExperimentConfigSchema,
  schedule: ExperimentScheduleSchema,
  participants: z.array(CallParticipantSchema).length(2),
  startedAt: IsoDateSchema,
  endedAt: IsoDateSchema,
  durationMs: z.number().int().nonnegative(),
  artifacts: z.array(EvidenceArtifactSchema),
  events: z.array(CallEventSchema),
  eventsSha256: Sha256HexSchema,
  generatedAt: IsoDateSchema,
  generatedBy: z.string().uuid(),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: RoleSchema,
  createdAt: IsoDateSchema,
  lastLoginAt: IsoDateSchema.nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const ParticipantAccessClaimsSchema = z.object({
  version: z.literal(1),
  kind: z.literal("participant_access"),
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
  participantConfigId: z.string().uuid(),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentVersionId: z.string().uuid(),
  role: ParticipantRoleSchema,
  name: z.string().min(1).max(120),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type ParticipantAccessClaims = z.infer<typeof ParticipantAccessClaimsSchema>;

export const RoomCredentialClaimsSchema = ParticipantAccessClaimsSchema.omit({
  kind: true,
  sessionId: true,
}).extend({
  kind: z.literal("room"),
  credentialId: z.string().uuid(),
});
export type RoomCredentialClaims = z.infer<typeof RoomCredentialClaimsSchema>;

export function createId(): string {
  return crypto.randomUUID();
}
