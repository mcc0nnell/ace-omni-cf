import { describe, expect, it, vi } from "vitest";
import type { ExperimentSchedule, ScheduledManipulation } from "@ace-omni/domain";
import {
  buildWorkletCommand,
  createSeededRandom,
  scheduleParticipantManipulations,
} from "./index";

const manipulation: ScheduledManipulation = {
  id: "gain-caller",
  type: "gain",
  targetParticipantId: "00000000-0000-4000-8000-000000000021",
  targetRole: "caller",
  targetStream: "outgoing",
  startOffsetMs: 500,
  durationMs: 1_000,
  parameters: { gainDb: -6 },
  seed: 42,
};

describe("deterministic media scheduling", () => {
  it("maps an authoritative call offset to an exact AudioWorklet frame range", () => {
    expect(buildWorkletCommand(manipulation, {
      callClockStartMs: 10_000,
      observedAtMs: 9_500,
      audioContextTimeSec: 2,
      sampleRate: 48_000,
    })).toEqual(expect.objectContaining({
      kind: "schedule",
      id: "gain-caller",
      startFrame: 144_000,
      endFrame: 192_000,
      seed: 42,
    }));
  });

  it("produces the same pseudo-random samples for the same research seed", () => {
    const first = createSeededRandom(1234);
    const second = createSeededRandom(1234);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("acknowledges only assigned manipulations and records actual callback time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const schedule = {
      version: 1,
      callId: "00000000-0000-4000-8000-000000000100",
      experimentId: "00000000-0000-4000-8000-000000000101",
      experimentVersionId: "00000000-0000-4000-8000-000000000102",
      configVersion: 1,
      scheduleRevision: 1,
      callClockStartMs: 20_100,
      issuedAt: "2026-08-06T00:00:00.000Z",
      manipulations: [
        manipulation,
        { ...manipulation, id: "gain-callee", targetParticipantId: "00000000-0000-4000-8000-000000000022" },
      ],
      algorithm: "HMAC-SHA-256",
      signature: "abcdefghijklmnopqrstuvwxyzABCDE_1234567890",
    } satisfies ExperimentSchedule;
    const acknowledged: Array<[string, number]> = [];
    const executed: Array<[string, number]> = [];

    const cancel = scheduleParticipantManipulations(
      schedule,
      manipulation.targetParticipantId,
      {
        onAcknowledged: (entry, actualTimeMs) => acknowledged.push([entry.id, actualTimeMs]),
        onExecute: (entry, actualTimeMs) => executed.push([entry.id, actualTimeMs]),
      },
    );
    expect(acknowledged).toEqual([["gain-caller", 20_000]]);
    await vi.advanceTimersByTimeAsync(600);
    expect(executed).toEqual([["gain-caller", 20_600]]);
    cancel();
    vi.useRealTimers();
  });
});
