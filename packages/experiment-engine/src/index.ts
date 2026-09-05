/**
 * Pure deterministic expansion of a pinned experiment version into a call schedule.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import {
  ExperimentConfigSchema,
  ExperimentScheduleBodySchema,
  type ExperimentConfig,
  type ExperimentScheduleBody,
  type ScheduledManipulation,
} from "@ace-omni/domain";

export * from "./emulytics";
export * from "./observation-ledger";

export interface ScheduleExpansionInput {
  callId: string;
  experimentId: string;
  experimentVersionId: string;
  configVersion: number;
  scheduleRevision: number;
  callClockStartMs: number;
  issuedAt: string;
  config: ExperimentConfig;
  participantIdsByConfigId: Record<string, string>;
}

export function expandExperimentSchedule(input: ScheduleExpansionInput): ExperimentScheduleBody {
  const config = ExperimentConfigSchema.parse(input.config);
  const configuredIds = config.participants.map((participant) => participant.id).sort();
  const mappedIds = Object.keys(input.participantIdsByConfigId).sort();
  if (
    configuredIds.length !== mappedIds.length ||
    configuredIds.some((configuredId, index) => configuredId !== mappedIds[index])
  ) {
    throw new Error("The schedule requires exactly one runtime participant ID for each configured participant");
  }
  const runtimeParticipantIds = Object.values(input.participantIdsByConfigId);
  if (new Set(runtimeParticipantIds).size !== runtimeParticipantIds.length) {
    throw new Error("Runtime participant IDs must be unique");
  }
  const manipulations: ScheduledManipulation[] = [];

  for (const definition of config.manipulations) {
    const targets = config.participants.filter(
      (participant) =>
        definition.targetRole === "both" || participant.role === definition.targetRole,
    );

    for (const target of targets) {
      const targetParticipantId = input.participantIdsByConfigId[target.id];
      if (!targetParticipantId) {
        throw new Error(`Missing runtime participant ID for configuration ${target.id}`);
      }
      const id = definition.targetRole === "both" ? `${definition.id}:${target.role}` : definition.id;
      manipulations.push({
        id,
        type: definition.type,
        targetParticipantId,
        targetRole: target.role as "caller" | "callee",
        targetStream: definition.targetStream,
        startOffsetMs: definition.startOffsetMs,
        durationMs: definition.durationMs,
        parameters: definition.parameters,
        seed: definition.seed,
      });
    }
  }

  manipulations.sort(
    (left, right) =>
      left.startOffsetMs - right.startOffsetMs ||
      left.id.localeCompare(right.id) ||
      left.targetParticipantId.localeCompare(right.targetParticipantId),
  );

  return ExperimentScheduleBodySchema.parse({
    version: 1,
    callId: input.callId,
    experimentId: input.experimentId,
    experimentVersionId: input.experimentVersionId,
    configVersion: input.configVersion,
    scheduleRevision: input.scheduleRevision,
    callClockStartMs: input.callClockStartMs,
    issuedAt: input.issuedAt,
    manipulations,
  });
}
