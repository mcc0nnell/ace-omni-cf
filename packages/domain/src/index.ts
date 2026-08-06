/**
 * Shared domain schemas for ACE Omni Cloudflare resurrection.
 * Recovered and normalized from original MongoDB models.
 * Versioned for future migration.
 */

import { z } from "zod";

export const RoleSchema = z.enum(["administrator", "researcher", "participant"]);
export type Role = z.infer<typeof RoleSchema>;

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
  fileId: z.string().optional(),
  gainDb: z.number().min(-60).max(20).default(-12),
});

export const PacketDropConfigSchema = z.object({
  enabled: z.boolean().default(false),
  durationMs: z.number().int().min(0).max(30000).default(500),
  intervalMs: z.number().int().min(0).max(60000).default(5000),
  fromSec: z.number().min(0).default(0),
  toSec: z.number().min(0).optional(),
});

export const AudioFilterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(["lowpass", "highpass", "bandpass", "notch", "none"]).default("none"),
  frequencyHz: z.number().min(20).max(20000).default(1000),
  rollOffDbPerOctave: z.number().min(6).max(48).default(12),
  gainDb: z.number().min(-40).max(20).default(0),
  pitchShiftSemitones: z.number().min(-12).max(12).default(0),
  quality: z.number().min(0).max(1).default(1),
});

export const IncomingAudioConfigSchema = z.object({
  mono: z.boolean().default(false),
  balanceL: z.number().min(-1).max(1).default(0),
  balanceR: z.number().min(-1).max(1).default(0),
});

export const AudioStreamConfigSchema = z.object({
  backgroundNoise: BackgroundNoiseConfigSchema.default({}),
  packetDrop: PacketDropConfigSchema.default({}),
  filter: AudioFilterConfigSchema.default({}),
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
  errorSimulation: z.boolean().default(false),
  dropoutIntervalMs: z.number().int().min(0).default(0),
  dropoutLengthMs: z.number().int().min(0).default(0),
  captionDelayMs: z.number().int().min(0).max(10000).default(0),
  translationEnabled: z.boolean().default(false),
  targetLanguage: z.string().default("en"),
  appearance: z
    .object({
      fontSize: z.enum(["small", "medium", "large"]).default("medium"),
      highContrast: z.boolean().default(false),
      attribution: z.boolean().default(true),
    })
    .default({}),
});

export const DataCollectionSchema = z.object({
  transcripts: z
    .object({
      asrCaptionStream: z.boolean().default(true),
      rawAsr: z.boolean().default(true),
    })
    .default({}),
  audioRecordings: z
    .object({
      microphone: z.boolean().default(true),
      received: z.boolean().default(true),
      manipulated: z.boolean().default(true),
    })
    .default({}),
  videoRecordings: z
    .object({
      local: z.boolean().default(false),
      remote: z.boolean().default(false),
    })
    .default({}),
  screenRecordings: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
  experimentEvents: z.boolean().default(true),
});

export const ParticipantConfigSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  role: ParticipantRoleSchema,
  extension: z.string().max(20).optional(),
  interface: z
    .object({
      incomingAudio: IncomingAudioConfigSchema.default({}),
    })
    .default({}),
  audioStream: AudioStreamConfigSchema.default({}),
  captions: CaptionConfigSchema.default({}),
});

export const ExperimentConfigSchema = z.object({
  version: z.literal(1),
  trsType: TrsTypeSchema.default("CUSTOM"),
  participants: z.array(ParticipantConfigSchema).min(1).max(8),
  dataCollection: DataCollectionSchema.default({}),
  callTimeoutSec: z.number().int().min(30).max(3600).default(600),
});
export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

export const ExperimentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  alias: z.string().min(1).max(80),
  description: z.string().max(2000).default(""),
  purpose: z.string().max(2000).default(""),
  phase: z.enum(["draft", "active", "archived"]).default("draft"),
  config: ExperimentConfigSchema,
  createdBy: z.string().uuid(),
  modifiedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid(),
  participantConfigId: z.string(),
  role: ParticipantRoleSchema,
  tokenHash: z.string(),
  expiresAt: z.string().datetime(),
  redeemedAt: z.string().datetime().nullable().optional(),
  createdBy: z.string().uuid(),
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
  name: z.string(),
  role: ParticipantRoleSchema,
  joinedAt: z.string().datetime().nullable(),
  leftAt: z.string().datetime().nullable(),
});

export const CallSchema = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid(),
  experimentConfigVersion: z.number().int(),
  name: z.string().max(200).default(""),
  state: CallStateSchema,
  participants: z.array(CallParticipantSchema),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  durationSec: z.number().nullable(),
  evidenceManifestKey: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Call = z.infer<typeof CallSchema>;

export const ManipulationTypeSchema = z.enum([
  "background_noise",
  "packet_drop",
  "audio_filter",
  "caption_delay",
  "caption_dropout",
  "caption_error",
  "gain",
  "pitch",
]);
export type ManipulationType = z.infer<typeof ManipulationTypeSchema>;

export const ScheduledManipulationSchema = z.object({
  id: z.string().uuid(),
  type: ManipulationTypeSchema,
  targetParticipantId: z.string().uuid(),
  targetStream: z.enum(["incoming", "outgoing", "captions"]),
  startOffsetMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  parameters: z.record(z.unknown()),
  seed: z.number().int(),
});

export const ExperimentScheduleSchema = z.object({
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  configVersion: z.number().int(),
  scheduleRevision: z.number().int(),
  callClockStartMs: z.number().int(),
  manipulations: z.array(ScheduledManipulationSchema),
  signature: z.string(),
});
export type ExperimentSchedule = z.infer<typeof ExperimentScheduleSchema>;

export const CallEventTypeSchema = z.enum([
  "participant_joined",
  "participant_left",
  "offer",
  "answer",
  "ice_candidate",
  "schedule_issued",
  "manipulation_ack",
  "manipulation_executed",
  "caption_raw",
  "caption_displayed",
  "recording_started",
  "recording_stopped",
  "call_ended",
  "error",
]);

export const CallEventSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  type: CallEventTypeSchema,
  participantId: z.string().uuid().nullable(),
  payload: z.record(z.unknown()),
  clientClockMs: z.number().int().optional(),
  serverClockMs: z.number().int(),
  createdAt: z.string().datetime(),
});
export type CallEvent = z.infer<typeof CallEventSchema>;

export const EvidenceArtifactSchema = z.object({
  type: z.enum([
    "mic_audio",
    "received_audio",
    "manipulated_audio",
    "local_video",
    "remote_video",
    "screen",
    "asr_raw",
    "captions_displayed",
    "experiment_events",
    "config_snapshot",
  ]),
  participantId: z.string().uuid().nullable(),
  objectKey: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().optional(),
  sha256: z.string().optional(),
});

export const EvidenceManifestSchema = z.object({
  version: z.literal(1),
  callId: z.string().uuid(),
  experimentId: z.string().uuid(),
  configSnapshot: ExperimentConfigSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSec: z.number(),
  artifacts: z.array(EvidenceArtifactSchema),
  events: z.array(CallEventSchema).optional(),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: RoleSchema,
  passwordHash: z.string(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

export function createId(): string {
  return crypto.randomUUID();
}
