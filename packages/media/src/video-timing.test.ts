import { describe, expect, it } from "vitest";
import type { ExperimentSchedule, ScheduledManipulation } from "@ace-omni/domain";
import {
  composeVideoDecisions,
  createVideoTimingController,
  decideVideoFrameTiming,
} from "./video-timing";

function manip(
  partial: Partial<ScheduledManipulation> & Pick<ScheduledManipulation, "id" | "type">,
): ScheduledManipulation {
  return {
    targetParticipantId: "11111111-1111-1111-1111-111111111111",
    targetRole: "callee",
    targetStream: "video",
    startOffsetMs: 0,
    durationMs: 10_000,
    parameters: {},
    seed: 7,
    ...partial,
  };
}

const scheduleStub = {
  version: 1 as const,
  callId: "22222222-2222-2222-2222-222222222222",
  experimentId: "33333333-3333-3333-3333-333333333333",
  experimentVersionId: "44444444-4444-4444-4444-444444444444",
  configVersion: 1,
  scheduleRevision: 1,
  callClockStartMs: 1_000_000,
  issuedAt: new Date().toISOString(),
  manipulations: [] as ScheduledManipulation[],
  algorithm: "HMAC-SHA-256" as const,
  signature: "a".repeat(43),
} satisfies ExperimentSchedule;

describe("VRS video timing", () => {
  it("applies constant lag inside the window", () => {
    const lag = manip({
      id: "lag-1",
      type: "video_lag",
      parameters: { delayMs: 250 },
    });
    const decisions = decideVideoFrameTiming([lag], {
      sourceOffsetMs: 500,
      observedAtMs: Date.now(),
      frameIndex: 12,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.delayMs).toBe(250);
    expect(decisions[0]?.presentOffsetMs).toBe(750);
  });

  it("ignores manipulations outside the window", () => {
    const lag = manip({
      id: "lag-1",
      type: "video_lag",
      startOffsetMs: 2_000,
      durationMs: 1_000,
      parameters: { delayMs: 250 },
    });
    const decisions = decideVideoFrameTiming([lag], {
      sourceOffsetMs: 500,
      observedAtMs: Date.now(),
      frameIndex: 1,
    });
    expect(decisions).toHaveLength(0);
  });

  it("produces deterministic jitter for the same seed and frame", () => {
    const jitter = manip({
      id: "jit-1",
      type: "video_jitter",
      parameters: { meanDelayMs: 100, jitterMs: 40, minDelayMs: 0 },
      seed: 42,
    });
    const a = decideVideoFrameTiming([jitter], {
      sourceOffsetMs: 100,
      observedAtMs: 0,
      frameIndex: 9,
    });
    const b = decideVideoFrameTiming([jitter], {
      sourceOffsetMs: 100,
      observedAtMs: 0,
      frameIndex: 9,
    });
    expect(a[0]?.delayMs).toBe(b[0]?.delayMs);
    expect(a[0]?.delayMs).toBeGreaterThanOrEqual(80);
    expect(a[0]?.delayMs).toBeLessThanOrEqual(120);
  });

  it("marks freeze frames as holdPrevious", () => {
    const freeze = manip({
      id: "frz-1",
      type: "video_freeze",
      parameters: { holdMs: 300 },
    });
    const decisions = decideVideoFrameTiming([freeze], {
      sourceOffsetMs: 50,
      observedAtMs: 0,
      frameIndex: 3,
    });
    expect(decisions[0]?.holdPrevious).toBe(true);
  });

  it("composes max delay and any hold", () => {
    const composed = composeVideoDecisions([
      {
        manipulationId: "a",
        type: "video_lag",
        delayMs: 100,
        holdPrevious: false,
        presentOffsetMs: 200,
      },
      {
        manipulationId: "b",
        type: "video_freeze",
        delayMs: 0,
        holdPrevious: true,
        presentOffsetMs: 150,
      },
    ]);
    expect(composed.delayMs).toBe(100);
    expect(composed.holdPrevious).toBe(true);
    expect(composed.presentOffsetMs).toBe(200);
  });

  it("controller only returns assigned participant manipulations", () => {
    const mine = manip({ id: "mine", type: "video_lag", parameters: { delayMs: 50 } });
    const other = manip({
      id: "other",
      type: "video_lag",
      targetParticipantId: "99999999-9999-9999-9999-999999999999",
      parameters: { delayMs: 999 },
    });
    const controller = createVideoTimingController(
      { ...scheduleStub, manipulations: [mine, other] },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(controller.assigned).toHaveLength(1);
    const decision = controller.decide({
      sourceOffsetMs: 10,
      observedAtMs: 0,
      frameIndex: 0,
    });
    expect(decision.delayMs).toBe(50);
  });
});
