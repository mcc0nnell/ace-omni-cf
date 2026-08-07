import { describe, expect, it } from "vitest";
import {
  SyntheticLoopbackAdapter,
  compileExecutionPlan,
  createObservationEnvelope,
  deduplicateObservationEnvelopes,
  digestExecutionPlan,
  type ExperimentRun,
  type ObservationEnvelope,
  type PlannedCommandDefinition,
} from "./emulytics";

const baseRun = (): ExperimentRun => ({
  version: 1,
  runId: "run-001",
  experimentId: "experiment-001",
  experimentVersionId: "experiment-version-003",
  configVersion: 3,
  seed: 26,
  issuedAt: "2026-08-06T23:00:00.000Z",
  adapters: [
    {
      id: "synthetic-loopback",
      kind: "synthetic-loopback",
      protocolVersion: 1,
      capabilities: ["simulation", "custom"],
    },
    {
      id: "network-lab",
      kind: "network-emulator",
      protocolVersion: 1,
      capabilities: ["network", "cyber"],
    },
  ],
});

const commands: PlannedCommandDefinition[] = [
  {
    id: "net-loss",
    adapterId: "network-lab",
    capability: "network",
    scheduledOffsetMs: 5_000,
    operation: "set_packet_loss",
    parameters: { percent: 7.5 },
  },
  {
    id: "inject-event",
    adapterId: "synthetic-loopback",
    capability: "simulation",
    scheduledOffsetMs: 1_000,
    operation: "inject_event",
    parameters: { event: "warning" },
  },
];

describe("Emulytics experiment protocol", () => {
  it("compiles semantically identical pinned inputs into the same plan and digest", async () => {
    const first = compileExecutionPlan({ run: baseRun(), planRevision: 1, commands });
    const reorderedRun = baseRun();
    reorderedRun.adapters.reverse();
    reorderedRun.adapters[1]!.capabilities.reverse();
    const second = compileExecutionPlan({
      run: reorderedRun,
      planRevision: 1,
      commands: [...commands].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.commands.map((command) => command.id)).toEqual(["inject-event", "net-loss"]);
    expect(await digestExecutionPlan(second)).toBe(await digestExecutionPlan(first));
  });

  it("copies command parameters into the immutable compiled plan", () => {
    const mutableParameters = { nested: { enabled: true } };
    const plan = compileExecutionPlan({
      run: baseRun(),
      planRevision: 1,
      commands: [
        {
          id: "copy-check",
          adapterId: "synthetic-loopback",
          capability: "custom",
          scheduledOffsetMs: 0,
          operation: "copy_check",
          parameters: mutableParameters,
        },
      ],
    });

    mutableParameters.nested.enabled = false;
    expect(plan.commands[0]!.parameters).toEqual({ nested: { enabled: true } });
  });

  it("rejects a command when an adapter did not declare the required capability", () => {
    expect(() =>
      compileExecutionPlan({
        run: baseRun(),
        planRevision: 1,
        commands: [
          {
            id: "bad-command",
            adapterId: "synthetic-loopback",
            capability: "network",
            scheduledOffsetMs: 0,
            operation: "drop_packets",
          },
        ],
      }),
    ).toThrow(/does not declare/);
  });

  it("deduplicates exact observation replays and rejects timestamp or payload mutation", async () => {
    const original = await createObservationEnvelope({
      observationId: "sensor-0001",
      runId: "run-001",
      adapterId: "network-lab",
      sourceId: "sensor-a",
      observedAt: "2026-08-06T23:00:01.000Z",
      payload: { state: "up", latencyMs: 12 },
    });
    const replay = { ...original };
    const timestampConflict = { ...original, observedAt: "2026-08-06T23:00:02.000Z" };
    const payloadConflict = await createObservationEnvelope({
      observationId: "sensor-0001",
      runId: "run-001",
      adapterId: "network-lab",
      sourceId: "sensor-a",
      observedAt: "2026-08-06T23:00:01.000Z",
      payload: { state: "down", latencyMs: 12 },
    });
    const otherSource = await createObservationEnvelope({
      observationId: "sensor-0001",
      runId: "run-001",
      adapterId: "network-lab",
      sourceId: "sensor-b",
      observedAt: "2026-08-06T23:00:01.000Z",
      payload: { state: "up", latencyMs: 12 },
    });

    expect(deduplicateObservationEnvelopes([original, replay])).toEqual([original]);
    expect(deduplicateObservationEnvelopes([original, otherSource])).toEqual([original, otherSource]);
    expect(() => deduplicateObservationEnvelopes([original, timestampConflict])).toThrow(/conflicting replay/);
    expect(() => deduplicateObservationEnvelopes([original, payloadConflict])).toThrow(/conflicting replay/);
  });

  it("provides a synthetic adapter that proves prepare-start-command-observe-stop", async () => {
    const adapter = new SyntheticLoopbackAdapter(
      "synthetic-loopback",
      () => "2026-08-06T23:00:02.000Z",
    );
    const plan = compileExecutionPlan({
      run: baseRun(),
      planRevision: 1,
      commands: [commands[1]!],
    });

    await adapter.prepare(plan.run);
    await adapter.start(plan);
    await adapter.command(plan.commands[0]!);
    const observations: ObservationEnvelope[] = [];
    for await (const observation of adapter.observe()) {
      observations.push(observation);
    }
    await adapter.stop("test complete");

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      observationId: "command:inject-event",
      runId: "run-001",
      adapterId: "synthetic-loopback",
      sourceId: "loopback",
      observedAt: "2026-08-06T23:00:02.000Z",
    });
    expect(observations[0]!.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
