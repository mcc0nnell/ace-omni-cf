import { describe, expect, it } from "vitest";
import type { ExperimentConfig } from "@ace-omni/domain";
import { expandExperimentSchedule } from "./index";

const config: ExperimentConfig = {
  version: 1,
  trsType: "IP_CTS",
  participants: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      name: "Caller",
      role: "caller",
      captions: { engine: "mock" },
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      name: "Callee",
      role: "callee",
      captions: { engine: "mock" },
    },
  ],
  timing: { callTimeoutSec: 30, mockCaptionIntervalMs: 500 },
  manipulations: [
    {
      id: "noise-1",
      type: "background_noise",
      targetRole: "callee",
      targetStream: "incoming",
      startOffsetMs: 1000,
      durationMs: 2000,
      parameters: { gainDb: -18 },
      seed: 42,
    },
  ],
  evidencePolicy: {},
};

describe("experiment schedule expansion", () => {
  it("derives the same schedule from the pinned config and authoritative clock", () => {
    const input = {
      callId: "00000000-0000-4000-8000-000000000100",
      experimentId: "00000000-0000-4000-8000-000000000101",
      experimentVersionId: "00000000-0000-4000-8000-000000000102",
      configVersion: 2,
      scheduleRevision: 1,
      callClockStartMs: 1_000_000,
      issuedAt: "2026-08-06T00:00:00.000Z",
      config,
      participantIdsByConfigId: {
        "00000000-0000-4000-8000-000000000011": "00000000-0000-4000-8000-000000000021",
        "00000000-0000-4000-8000-000000000012": "00000000-0000-4000-8000-000000000022",
      },
    };

    expect(expandExperimentSchedule(input)).toEqual(expandExperimentSchedule(input));
    expect(expandExperimentSchedule(input).manipulations).toEqual([
      expect.objectContaining({
        id: "noise-1",
        targetParticipantId: "00000000-0000-4000-8000-000000000022",
        startOffsetMs: 1000,
        seed: 42,
      }),
    ]);
  });

  it("rejects a manipulation that runs beyond the configured call timeout", () => {
    expect(() =>
      expandExperimentSchedule({
        callId: "00000000-0000-4000-8000-000000000100",
        experimentId: "00000000-0000-4000-8000-000000000101",
        experimentVersionId: "00000000-0000-4000-8000-000000000102",
        configVersion: 1,
        scheduleRevision: 1,
        callClockStartMs: 1,
        issuedAt: "2026-08-06T00:00:00.000Z",
        participantIdsByConfigId: {
          "00000000-0000-4000-8000-000000000011": "00000000-0000-4000-8000-000000000021",
          "00000000-0000-4000-8000-000000000012": "00000000-0000-4000-8000-000000000022",
        },
        config: {
          ...config,
          manipulations: [
            { ...config.manipulations![0]!, startOffsetMs: 29_500, durationMs: 1000 },
          ],
        },
      }),
    ).toThrow(/call timeout/i);
  });
});
