import { describe, expect, it } from "vitest";
import {
  compileExecutionPlan,
  digestExecutionPlan,
  type ExperimentRun,
  type PlannedCommandDefinition,
} from "./emulytics";
import type { ScenarioScript } from "./scenario-ast";
import { compileScenarioCommands, compileScenarioExecutionPlan } from "./scenario-compiler";
import { ScenarioActionRegistry } from "./scenario-registry";

const run = (): ExperimentRun => ({
  version: 1,
  runId: "run-scenario-compiler",
  experimentId: "experiment-scenario-compiler",
  experimentVersionId: "experiment-version-001",
  configVersion: 1,
  seed: 26,
  issuedAt: "2026-08-13T20:30:00.000Z",
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

function registry(): ScenarioActionRegistry {
  return new ScenarioActionRegistry()
    .register("degradeNetwork", ({ parameters }) => [
      {
        stepId: "apply",
        offsetMs: 0,
        adapterId: "network-lab",
        capability: "network",
        operation: "set_packet_loss",
        parameters: { percent: parameters.percent ?? 0 },
      },
    ])
    .register("establishCall", () => [
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
    ]);
}

const script = (): ScenarioScript => ({
  version: 1,
  id: "sip-loss-trial",
  actions: [
    {
      kind: "action",
      id: "impair",
      action: "degradeNetwork",
      scheduledOffsetMs: 5_000,
      parameters: { percent: 5 },
    },
    {
      kind: "action",
      id: "call",
      action: "establishCall",
      scheduledOffsetMs: 5_250,
    },
  ],
});

describe("scenario compiler", () => {
  it("resolves higher-order actions through a registry into canonical primitives", () => {
    expect(compileScenarioCommands(script(), registry())).toEqual([
      {
        id: "sip-loss-trial:impair:apply",
        adapterId: "network-lab",
        capability: "network",
        scheduledOffsetMs: 5_000,
        operation: "set_packet_loss",
        parameters: { percent: 5 },
      },
      {
        id: "sip-loss-trial:call:invite",
        adapterId: "elixip",
        capability: "communications",
        scheduledOffsetMs: 5_250,
        operation: "start_activity",
      },
      {
        id: "sip-loss-trial:call:terminate",
        adapterId: "elixip",
        capability: "communications",
        scheduledOffsetMs: 9_250,
        operation: "stop_activity",
      },
    ]);
  });

  it("produces the same execution plan and hash as explicitly authored primitives", async () => {
    const direct: PlannedCommandDefinition[] = [
      {
        id: "sip-loss-trial:impair:apply",
        adapterId: "network-lab",
        capability: "network",
        scheduledOffsetMs: 5_000,
        operation: "set_packet_loss",
        parameters: { percent: 5 },
      },
      {
        id: "sip-loss-trial:call:invite",
        adapterId: "elixip",
        capability: "communications",
        scheduledOffsetMs: 5_250,
        operation: "start_activity",
      },
      {
        id: "sip-loss-trial:call:terminate",
        adapterId: "elixip",
        capability: "communications",
        scheduledOffsetMs: 9_250,
        operation: "stop_activity",
      },
    ];

    const compiled = compileScenarioExecutionPlan({
      script: script(),
      registry: registry(),
      run: run(),
      planRevision: 1,
    });
    const explicit = compileExecutionPlan({ run: run(), planRevision: 1, commands: direct });

    expect(compiled).toEqual(explicit);
    await expect(digestExecutionPlan(compiled)).resolves.toBe(await digestExecutionPlan(explicit));
  });

  it("cannot use a registered higher-order action to bypass adapter capabilities", () => {
    const actions = new ScenarioActionRegistry().register("spoofNetwork", () => [
      {
        stepId: "impair",
        offsetMs: 0,
        adapterId: "elixip",
        capability: "network",
        operation: "set_packet_loss",
      },
    ]);

    expect(() =>
      compileScenarioExecutionPlan({
        script: {
          version: 1,
          id: "capability-proof",
          actions: [
            {
              kind: "action",
              id: "attack",
              action: "spoofNetwork",
              scheduledOffsetMs: 0,
            },
          ],
        },
        registry: actions,
        run: run(),
        planRevision: 1,
      }),
    ).toThrow(/does not declare/);
  });

  it("fails closed on unknown actions and duplicate action identities", () => {
    expect(() =>
      compileScenarioCommands(
        {
          version: 1,
          id: "unknown-action",
          actions: [
            {
              kind: "action",
              id: "one",
              action: "missing",
              scheduledOffsetMs: 0,
            },
          ],
        },
        registry(),
      ),
    ).toThrow(/not registered/);

    expect(() =>
      compileScenarioCommands(
        {
          version: 1,
          id: "duplicate-action",
          actions: [
            { kind: "action", id: "same", action: "establishCall", scheduledOffsetMs: 0 },
            { kind: "action", id: "same", action: "establishCall", scheduledOffsetMs: 1 },
          ],
        },
        registry(),
      ),
    ).toThrow(/duplicate scenario action id/);
  });
});
