import { describe, expect, it } from "vitest";
import {
  compileExperiment,
  ExperimentCompileError,
  type CapabilityProvider,
  type ExperimentDefinition,
} from "./experiment-ir.js";

const regimeSha = "a".repeat(64);

function providers(): CapabilityProvider[] {
  return [
    {
      id: "config-reader",
      capability: "config.read",
      adapter: "synthetic.config",
      allowedCommands: ["READ_CONFIG"],
      metadata: {},
    },
    {
      id: "account-driver",
      capability: "account.exercise",
      adapter: "synthetic.account",
      allowedCommands: ["CREATE_ACCOUNT", "EXPIRE_ACCOUNT"],
      metadata: {},
    },
    {
      id: "evidence-reader",
      capability: "evidence.read",
      adapter: "synthetic.evidence",
      allowedCommands: ["READ_LOG"],
      metadata: {},
    },
  ];
}

function definition(): ExperimentDefinition {
  return {
    schemaVersion: 1,
    id: "ac-2-experiment",
    title: "Synthetic AC-2 assessment experiment",
    regimeId: "effective-regime",
    regimeSha256: regimeSha,
    tasks: [
      {
        id: "exercise-account",
        phase: "exercise",
        dependsOn: ["capture-baseline"],
        commands: [
          {
            capability: "account.exercise",
            name: "CREATE_ACCOUNT",
            parameters: { role: "standard", enabled: true },
          },
        ],
        expectedEvidence: [
          { id: "account-created", kind: "observation", description: "Account creation result" },
        ],
        metadata: {},
      },
      {
        id: "capture-baseline",
        phase: "setup",
        dependsOn: [],
        commands: [
          {
            capability: "config.read",
            name: "READ_CONFIG",
            parameters: { section: "accounts" },
          },
        ],
        expectedEvidence: [
          { id: "baseline-config", kind: "configuration", description: "Pre-exercise account configuration" },
        ],
        metadata: {},
      },
      {
        id: "collect-evidence",
        phase: "exercise",
        dependsOn: ["exercise-account"],
        commands: [
          {
            capability: "evidence.read",
            name: "READ_LOG",
            parameters: { source: "account-events" },
          },
        ],
        expectedEvidence: [
          { id: "account-log", kind: "log", description: "Observed account lifecycle log" },
        ],
        metadata: {},
      },
    ],
    metadata: { fixture: true },
  };
}

describe("experiment IR compiler", () => {
  it("compiles a deterministic authoritative task graph independent of input ordering", () => {
    const first = compileExperiment({ definition: definition(), providers: providers() });
    const reversedDefinition = definition();
    reversedDefinition.tasks = [...reversedDefinition.tasks].reverse();
    const second = compileExperiment({
      definition: reversedDefinition,
      providers: [...providers()].reverse(),
    });

    expect(second.sha256).toBe(first.sha256);
    expect(second).toEqual(first);
    expect(first.orderedTasks.map((task) => task.id)).toEqual([
      "capture-baseline",
      "exercise-account",
      "collect-evidence",
    ]);
    expect(first.edges).toEqual([
      { from: "capture-baseline", to: "exercise-account", kind: "depends_on" },
      { from: "exercise-account", to: "collect-evidence", kind: "depends_on" },
    ]);
  });

  it("seals only setup state into the T=0 baseline digest", () => {
    const compiled = compileExperiment({ definition: definition(), providers: providers() });
    expect(compiled.baselineSeal.setupTaskIds).toEqual(["capture-baseline"]);

    const changedExercise = definition();
    changedExercise.tasks.find((task) => task.id === "exercise-account")!.commands[0].parameters = {
      role: "privileged",
      enabled: true,
    };
    const changed = compileExperiment({ definition: changedExercise, providers: providers() });

    expect(changed.sha256).not.toBe(compiled.sha256);
    expect(changed.baselineSeal.sha256).toBe(compiled.baselineSeal.sha256);
  });

  it("binds every command to an explicit capability provider and adapter", () => {
    const compiled = compileExperiment({ definition: definition(), providers: providers() });
    expect(compiled.capabilityBindings).toEqual([
      {
        taskId: "capture-baseline",
        commandIndex: 0,
        capability: "config.read",
        command: "READ_CONFIG",
        providerId: "config-reader",
        adapter: "synthetic.config",
      },
      {
        taskId: "exercise-account",
        commandIndex: 0,
        capability: "account.exercise",
        command: "CREATE_ACCOUNT",
        providerId: "account-driver",
        adapter: "synthetic.account",
      },
      {
        taskId: "collect-evidence",
        commandIndex: 0,
        capability: "evidence.read",
        command: "READ_LOG",
        providerId: "evidence-reader",
        adapter: "synthetic.evidence",
      },
    ]);
  });

  it("fails closed when a capability has multiple providers unless one is selected", () => {
    const available = providers();
    available.push({
      id: "alternate-config-reader",
      capability: "config.read",
      adapter: "synthetic.config.alternate",
      allowedCommands: ["READ_CONFIG"],
      metadata: {},
    });

    expect(() => compileExperiment({ definition: definition(), providers: available })).toThrow(
      "select one explicitly",
    );

    const compiled = compileExperiment({
      definition: definition(),
      providers: available,
      providerPreferences: { "config.read": "alternate-config-reader" },
    });
    expect(compiled.capabilityBindings[0].providerId).toBe("alternate-config-reader");
  });

  it("rejects commands outside the selected provider's authorization boundary", () => {
    const invalid = definition();
    invalid.tasks.find((task) => task.id === "capture-baseline")!.commands[0].name = "DELETE_CONFIG";
    expect(() => compileExperiment({ definition: invalid, providers: providers() })).toThrow(
      "does not authorize command DELETE_CONFIG",
    );
  });

  it("rejects backward crossings of the T=0 boundary and dependency cycles", () => {
    const backwards = definition();
    backwards.tasks.find((task) => task.id === "capture-baseline")!.dependsOn = ["exercise-account"];
    expect(() => compileExperiment({ definition: backwards, providers: providers() })).toThrow(
      "T=0 is a one-way boundary",
    );

    const cyclic = definition();
    cyclic.tasks.find((task) => task.id === "exercise-account")!.dependsOn = ["collect-evidence"];
    expect(() => compileExperiment({ definition: cyclic, providers: providers() })).toThrow(
      "dependency cycle",
    );
  });

  it("requires regime identity and digest to travel together", () => {
    const invalid = definition();
    delete invalid.regimeSha256;
    expect(() => compileExperiment({ definition: invalid, providers: providers() })).toThrow(
      "regimeId and regimeSha256 must be supplied together",
    );
  });

  it("uses a domain-specific compile error for graph failures", () => {
    const invalid = definition();
    invalid.tasks[0].dependsOn = ["missing-task"];
    expect(() => compileExperiment({ definition: invalid, providers: providers() })).toThrow(
      ExperimentCompileError,
    );
  });
});
