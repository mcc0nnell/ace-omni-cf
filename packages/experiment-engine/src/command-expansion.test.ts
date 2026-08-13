import { describe, expect, it } from "vitest";
import { compileExecutionPlan, type ExperimentRun } from "./emulytics";
import { expandCommandSequence } from "./command-expansion";

const run = (): ExperimentRun => ({
  version: 1,
  runId: "run-command-expansion",
  experimentId: "experiment-command-expansion",
  experimentVersionId: "experiment-version-001",
  configVersion: 1,
  seed: 26,
  issuedAt: "2026-08-13T20:00:00.000Z",
  adapters: [
    {
      id: "elixip",
      kind: "elixip",
      protocolVersion: 1,
      capabilities: ["communications"],
    },
    {
      id: "network-lab",
      kind: "network-emulator",
      protocolVersion: 1,
      capabilities: ["network"],
    },
  ],
});

describe("command expansion", () => {
  it("expands higher-order intent into stable ordinary planned commands", () => {
    expect(
      expandCommandSequence({
        id: "sip-call-under-loss",
        scheduledOffsetMs: 5_000,
        steps: [
          {
            stepId: "impair",
            offsetMs: 0,
            adapterId: "network-lab",
            capability: "network",
            operation: "set_packet_loss",
            parameters: { percent: 5 },
          },
          {
            stepId: "invite",
            offsetMs: 250,
            adapterId: "elixip",
            capability: "communications",
            operation: "start_activity",
          },
        ],
      }),
    ).toEqual([
      {
        id: "sip-call-under-loss:impair",
        adapterId: "network-lab",
        capability: "network",
        scheduledOffsetMs: 5_000,
        operation: "set_packet_loss",
        parameters: { percent: 5 },
      },
      {
        id: "sip-call-under-loss:invite",
        adapterId: "elixip",
        capability: "communications",
        scheduledOffsetMs: 5_250,
        operation: "start_activity",
      },
    ]);
  });

  it("compiles identically to the equivalent explicitly authored primitive commands", () => {
    const expanded = expandCommandSequence({
      id: "establish-call",
      scheduledOffsetMs: 1_000,
      steps: [
        {
          stepId: "invite",
          offsetMs: 0,
          adapterId: "elixip",
          capability: "communications",
          operation: "start_activity",
        },
        {
          stepId: "terminate",
          offsetMs: 4_000,
          adapterId: "elixip",
          capability: "communications",
          operation: "stop_activity",
        },
      ],
    });

    const direct = [
      {
        id: "establish-call:invite",
        adapterId: "elixip",
        capability: "communications" as const,
        scheduledOffsetMs: 1_000,
        operation: "start_activity",
      },
      {
        id: "establish-call:terminate",
        adapterId: "elixip",
        capability: "communications" as const,
        scheduledOffsetMs: 5_000,
        operation: "stop_activity",
      },
    ];

    expect(
      compileExecutionPlan({ run: run(), planRevision: 1, commands: expanded }),
    ).toEqual(
      compileExecutionPlan({ run: run(), planRevision: 1, commands: direct }),
    );
  });

  it("does not bypass the normal adapter capability gate", () => {
    const expanded = expandCommandSequence({
      id: "bad-sequence",
      scheduledOffsetMs: 0,
      steps: [
        {
          offsetMs: 0,
          adapterId: "elixip",
          capability: "network",
          operation: "set_packet_loss",
        },
      ],
    });

    expect(() =>
      compileExecutionPlan({ run: run(), planRevision: 1, commands: expanded }),
    ).toThrow(/does not declare/);
  });

  it("rejects empty sequences and negative relative timing", () => {
    expect(() =>
      expandCommandSequence({ id: "empty", scheduledOffsetMs: 0, steps: [] }),
    ).toThrow(/at least one step/);

    expect(() =>
      expandCommandSequence({
        id: "negative",
        scheduledOffsetMs: 0,
        steps: [
          {
            offsetMs: -1,
            adapterId: "elixip",
            capability: "communications",
            operation: "start_activity",
          },
        ],
      }),
    ).toThrow(/non-negative integer/);
  });
});
