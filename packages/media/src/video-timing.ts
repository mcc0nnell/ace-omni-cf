/**
 * Deterministic VRS video timing manipulations (application-layer).
 * Constant lag, seeded jitter, and freeze holds for TRS research calls.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import type { ExperimentSchedule, ScheduledManipulation } from "@ace-omni/domain";

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type VideoManipulationType = "video_lag" | "video_jitter" | "video_freeze";

export function isVideoManipulation(
  manipulation: ScheduledManipulation,
): manipulation is ScheduledManipulation & { type: VideoManipulationType } {
  return (
    manipulation.type === "video_lag" ||
    manipulation.type === "video_jitter" ||
    manipulation.type === "video_freeze"
  );
}

export interface VideoTimingObservation {
  sourceOffsetMs: number;
  observedAtMs: number;
  frameIndex: number;
}

export interface VideoFrameDecision {
  manipulationId: string;
  type: VideoManipulationType;
  delayMs: number;
  holdPrevious: boolean;
  presentOffsetMs: number;
}

export interface VideoLagParameters {
  delayMs: number;
}

export interface VideoJitterParameters {
  meanDelayMs: number;
  jitterMs: number;
  minDelayMs?: number;
}

export interface VideoFreezeParameters {
  holdMs: number;
  maxHeldFrames?: number;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function decideVideoFrameTiming(
  active: ScheduledManipulation[],
  observation: VideoTimingObservation,
): VideoFrameDecision[] {
  const decisions: VideoFrameDecision[] = [];
  for (const manipulation of active) {
    if (!isVideoManipulation(manipulation)) continue;
    const start = manipulation.startOffsetMs;
    const end = start + manipulation.durationMs;
    if (observation.sourceOffsetMs < start || observation.sourceOffsetMs >= end) {
      continue;
    }

    if (manipulation.type === "video_lag") {
      const delayMs = Math.max(0, num(manipulation.parameters.delayMs, 0));
      decisions.push({
        manipulationId: manipulation.id,
        type: "video_lag",
        delayMs,
        holdPrevious: false,
        presentOffsetMs: observation.sourceOffsetMs + delayMs,
      });
      continue;
    }

    if (manipulation.type === "video_jitter") {
      const mean = Math.max(0, num(manipulation.parameters.meanDelayMs, 0));
      const spread = Math.max(0, num(manipulation.parameters.jitterMs, 0));
      const minDelay = Math.max(0, num(manipulation.parameters.minDelayMs, 0));
      const random = createSeededRandom(
        (manipulation.seed + observation.frameIndex * 997) >>> 0,
      );
      const offset = spread <= 0 ? 0 : (random() * 2 - 1) * (spread / 2);
      const delayMs = Math.max(minDelay, mean + offset);
      decisions.push({
        manipulationId: manipulation.id,
        type: "video_jitter",
        delayMs,
        holdPrevious: false,
        presentOffsetMs: observation.sourceOffsetMs + delayMs,
      });
      continue;
    }

    if (manipulation.type === "video_freeze") {
      decisions.push({
        manipulationId: manipulation.id,
        type: "video_freeze",
        delayMs: 0,
        holdPrevious: true,
        presentOffsetMs: observation.sourceOffsetMs,
      });
    }
  }
  return decisions;
}

export function composeVideoDecisions(decisions: VideoFrameDecision[]): {
  delayMs: number;
  holdPrevious: boolean;
  presentOffsetMs: number;
  applied: VideoFrameDecision[];
} {
  if (decisions.length === 0) {
    return { delayMs: 0, holdPrevious: false, presentOffsetMs: 0, applied: [] };
  }
  let delayMs = 0;
  let holdPrevious = false;
  let presentOffsetMs = decisions[0]!.presentOffsetMs;
  for (const decision of decisions) {
    delayMs = Math.max(delayMs, decision.delayMs);
    holdPrevious = holdPrevious || decision.holdPrevious;
    presentOffsetMs = Math.max(presentOffsetMs, decision.presentOffsetMs);
  }
  return { delayMs, holdPrevious, presentOffsetMs, applied: decisions };
}

export interface VideoTimingControllerHandlers {
  onDecision(frameIndex: number, composed: ReturnType<typeof composeVideoDecisions>): void;
}

export function createVideoTimingController(
  schedule: ExperimentSchedule,
  participantId: string,
  handlers?: VideoTimingControllerHandlers,
) {
  const assigned = schedule.manipulations.filter(
    (m) => m.targetParticipantId === participantId && isVideoManipulation(m),
  );

  return {
    assigned,
    activeAt(sourceOffsetMs: number): ScheduledManipulation[] {
      return assigned.filter(
        (m) =>
          sourceOffsetMs >= m.startOffsetMs &&
          sourceOffsetMs < m.startOffsetMs + m.durationMs,
      );
    },
    decide(observation: VideoTimingObservation) {
      const active = this.activeAt(observation.sourceOffsetMs);
      const decisions = decideVideoFrameTiming(active, observation);
      const composed = composeVideoDecisions(decisions);
      handlers?.onDecision(observation.frameIndex, composed);
      return composed;
    },
  };
}
