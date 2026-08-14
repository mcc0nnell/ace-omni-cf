import { describe, expect, it } from "vitest";
import {
  bindBaselineCheckpoint,
  compileExperimentBranch,
  StateBranchCompileError,
} from "./state-branching.js";
import {
  compileExperiment,
  type CapabilityProvider,
  type ExperimentDefinition,
} from "./experiment-ir.js";

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
      allowedCommands: ["CREATE_ACCOUNT"],
      metadata: {},
    },
    {
      id: "alternate-account-driver",
      capability: "account.exercise",
      adapter: "synthetic.account.alternate",
      allowedCommands: ["CREATE_ACCOUNT"],
      metadata: {},
    },
  ];
}

function parentExperiment() {
  const definition: ExperimentDefinition = {
    schemaVersion: 1,
    id: "ac-2-branching",
    title: "Synthetic branching experiment",
    regimeId: "effective-regime",
    regimeSha256: "a".repeat(64),
    tasks: [
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
        expectedEvidence: [],
        metadata: {},
      },
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
        expectedEvidence: [],
        metadata: {},
      },
    ],
    metadata: { fixture: true },
  };

  return compileExperiment({
    definition,
    providers: providers(),
    providerPreferences: { "account.exercise": "account-driver" },
  });
}

function checkpoint(parent = parentExperiment()) {
  return bindBaselineCheckpoint(parent, {
    id: "baseline-s0",
    stateArtifact: {
      uri: "r2://snapshots/ac-2/s0",
      sha256: "b".repeat(64),
      mediaType: "application/vnd.ace-omni.state+json",
      metadata: { runtime: "synthetic" },
    },
    metadata: {},
  });
}

describe("state branching", () => {
  it("forks an exercise from the exact sealed baseline without changing setup state", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    const branch = compileExperimentBranch({
      parent,
      checkpoint: sealed,
      providers: [...providers()].reverse(),
      branch: {
        schemaVersion: 1,
        id: "privileged-account",
        title: "Privileged account trial",
        checkpointId: sealed.id,
        variations: [
          {
            taskId: "exercise-account",
            commandIndex: 0,
            parameters: { role: "privileged", enabled: true },
          },
        ],
        metadata: {},
      },
    });

    expect(branch.experiment.sha256).not.toBe(parent.sha256);
    expect(branch.experiment.baselineSeal.sha256).toBe(parent.baselineSeal.sha256);
    expect(branch.lineage.parentExperimentSha256).toBe(parent.sha256);
    expect(branch.lineage.stateArtifactSha256).toBe(sealed.stateArtifact.sha256);
    expect(branch.experiment.capabilityBindings.find((item) => item.capability === "account.exercise")?.providerId)
      .toBe("account-driver");
    expect(branch.experiment.orderedTasks.find((task) => task.id === "exercise-account")?.commands[0].parameters)
      .toEqual({ enabled: true, role: "privileged" });
  });

  it("is deterministic across variation and provider input ordering", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    const baseBranch = {
      schemaVersion: 1 as const,
      id: "two-variation-branch",
      title: "Two variation branch",
      checkpointId: sealed.id,
      variations: [
        { taskId: "exercise-account", commandIndex: 0, parameters: { z: 1, a: 2 } },
      ],
      metadata: { z: true, a: true },
    };

    const first = compileExperimentBranch({
      parent,
      checkpoint: sealed,
      providers: providers(),
      branch: baseBranch,
    });
    const second = compileExperimentBranch({
      parent,
      checkpoint: sealed,
      providers: [...providers()].reverse(),
      branch: {
        ...baseBranch,
        variations: [...baseBranch.variations].reverse(),
        metadata: { a: true, z: true },
      },
    });

    expect(second.sha256).toBe(first.sha256);
    expect(second).toEqual(first);
  });

  it("rejects mutation of setup work because the baseline is immutable", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: sealed,
        providers: providers(),
        branch: {
          schemaVersion: 1,
          id: "bad-setup-branch",
          title: "Bad setup branch",
          checkpointId: sealed.id,
          variations: [
            {
              taskId: "capture-baseline",
              commandIndex: 0,
              parameters: { section: "different" },
            },
          ],
          metadata: {},
        },
      }),
    ).toThrow("sealed baseline is immutable");
  });

  it("rejects stale or foreign checkpoints", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);

    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: { ...sealed, experimentSha256: "c".repeat(64) },
        providers: providers(),
        branch: {
          schemaVersion: 1,
          id: "stale-branch",
          title: "Stale branch",
          checkpointId: sealed.id,
          variations: [
            {
              taskId: "exercise-account",
              commandIndex: 0,
              parameters: { role: "stale" },
            },
          ],
          metadata: {},
        },
      }),
    ).toThrow("exact parent experiment digest");
  });

  it("rejects missing command targets and duplicate mutations", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);

    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: sealed,
        providers: providers(),
        branch: {
          schemaVersion: 1,
          id: "missing-command",
          title: "Missing command",
          checkpointId: sealed.id,
          variations: [
            { taskId: "exercise-account", commandIndex: 9, parameters: {} },
          ],
          metadata: {},
        },
      }),
    ).toThrow("missing command 9");

    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: sealed,
        providers: providers(),
        branch: {
          schemaVersion: 1,
          id: "duplicate-mutation",
          title: "Duplicate mutation",
          checkpointId: sealed.id,
          variations: [
            { taskId: "exercise-account", commandIndex: 0, parameters: { role: "a" } },
            { taskId: "exercise-account", commandIndex: 0, parameters: { role: "b" } },
          ],
          metadata: {},
        },
      }),
    ).toThrow("Duplicate branch variation");
  });

  it("pins provider identity from the parent experiment", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    const missingPinned = providers().filter((provider) => provider.id !== "account-driver");

    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: sealed,
        providers: missingPinned,
        branch: {
          schemaVersion: 1,
          id: "provider-drift",
          title: "Provider drift",
          checkpointId: sealed.id,
          variations: [
            { taskId: "exercise-account", commandIndex: 0, parameters: { role: "privileged" } },
          ],
          metadata: {},
        },
      }),
    ).toThrow("missing pinned provider account-driver");
  });

  it("carries branch ancestry into the branch digest", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    const definition = {
      schemaVersion: 1 as const,
      id: "child-trial",
      title: "Child trial",
      checkpointId: sealed.id,
      variations: [
        { taskId: "exercise-account", commandIndex: 0, parameters: { role: "privileged" } },
      ],
      metadata: {},
    };

    const root = compileExperimentBranch({ parent, checkpoint: sealed, providers: providers(), branch: definition });
    const child = compileExperimentBranch({
      parent,
      checkpoint: sealed,
      providers: providers(),
      branch: { ...definition, parentBranchSha256: "d".repeat(64) },
    });

    expect(child.sha256).not.toBe(root.sha256);
    expect(child.lineage.parentBranchSha256).toBe("d".repeat(64));
  });

  it("uses a domain-specific error for branch validation failures", () => {
    const parent = parentExperiment();
    const sealed = checkpoint(parent);
    expect(() =>
      compileExperimentBranch({
        parent,
        checkpoint: sealed,
        providers: providers(),
        branch: {
          schemaVersion: 1,
          id: "foreign-checkpoint-name",
          title: "Foreign checkpoint name",
          checkpointId: "other-checkpoint",
          variations: [
            { taskId: "exercise-account", commandIndex: 0, parameters: { role: "x" } },
          ],
          metadata: {},
        },
      }),
    ).toThrow(StateBranchCompileError);
  });
});
