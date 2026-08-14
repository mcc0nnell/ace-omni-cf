import { describe, expect, it } from "vitest";
import { compileExperiment } from "./experiment-ir";
import {
  compileSceptreWorldBinding,
  type SceptreWorldBindingInput,
} from "./sceptre-world";

function compiledExperiment() {
  return compileExperiment({
    definition: {
      schemaVersion: 1,
      id: "sceptre-demo",
      title: "SCEPTRE lower-world experiment",
      tasks: [
        {
          id: "prepare-world",
          phase: "setup",
          dependsOn: [],
          commands: [
            {
              capability: "simulation",
              name: "world.initialize",
              parameters: {},
            },
          ],
          expectedEvidence: [],
          metadata: {},
        },
        {
          id: "inject-fault",
          phase: "exercise",
          dependsOn: ["prepare-world"],
          commands: [
            {
              capability: "cyber",
              name: "world.inject",
              parameters: { fault: "breaker-trip" },
            },
          ],
          expectedEvidence: [
            {
              id: "world-state",
              kind: "simulation-state",
              description: "Resulting lower-world state",
            },
          ],
          metadata: {},
        },
      ],
      metadata: {},
    },
    providers: [
      {
        id: "sceptre-simulation",
        capability: "simulation",
        adapter: "sceptre-lab",
        allowedCommands: ["world.initialize"],
        metadata: {},
      },
      {
        id: "sceptre-cyber",
        capability: "cyber",
        adapter: "sceptre-lab",
        allowedCommands: ["world.inject"],
        metadata: {},
      },
    ],
    providerPreferences: {},
  });
}

function bindingInput(): SceptreWorldBindingInput {
  const experiment = compiledExperiment();
  return {
    schemaVersion: 1,
    id: "sandia-lab-world",
    experimentSha256: experiment.sha256,
    baselineSha256: experiment.baselineSeal.sha256,
    adapter: "sceptre-lab",
    topology: {
      id: "soap-topology",
      sha256: "1".repeat(64),
    },
    scenario: {
      id: "soap-scenario",
      sha256: "2".repeat(64),
    },
    processModel: {
      provider: "generic-python",
      model: {
        id: "accessibility-infrastructure-model",
        sha256: "3".repeat(64),
      },
    },
    mappings: [
      {
        omniCommand: "world.inject",
        action: "cyber.inject",
        target: "breaker-1",
      },
      {
        omniCommand: "world.initialize",
        action: "process.set",
      },
    ],
    metadata: {
      purpose: "lower-world substrate",
      source: "SCEPTRE",
    },
  };
}

describe("SCEPTRE world binding", () => {
  it("binds a pinned SCEPTRE world to the exact compiled experiment and baseline", () => {
    const experiment = compiledExperiment();
    const binding = compileSceptreWorldBinding(bindingInput(), experiment);

    expect(binding.experimentSha256).toBe(experiment.sha256);
    expect(binding.baselineSha256).toBe(experiment.baselineSeal.sha256);
    expect(binding.mappings.map((mapping) => mapping.omniCommand)).toEqual([
      "world.initialize",
      "world.inject",
    ]);
    expect(binding.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic when mapping input order changes", () => {
    const experiment = compiledExperiment();
    const first = compileSceptreWorldBinding(bindingInput(), experiment);
    const reordered = bindingInput();
    reordered.mappings = [...reordered.mappings].reverse();
    reordered.metadata = { source: "SCEPTRE", purpose: "lower-world substrate" };
    const second = compileSceptreWorldBinding(reordered, experiment);

    expect(second).toEqual(first);
  });

  it("rejects stale experiment or baseline identities", () => {
    const experiment = compiledExperiment();
    const staleExperiment = bindingInput();
    staleExperiment.experimentSha256 = "a".repeat(64);
    expect(() => compileSceptreWorldBinding(staleExperiment, experiment)).toThrow(
      /not compiled experiment/,
    );

    const staleBaseline = bindingInput();
    staleBaseline.baselineSha256 = "b".repeat(64);
    expect(() => compileSceptreWorldBinding(staleBaseline, experiment)).toThrow(
      /not compiled baseline/,
    );
  });

  it("fails closed when an authorized Omni command is not explicitly mapped", () => {
    const experiment = compiledExperiment();
    const input = bindingInput();
    input.mappings = input.mappings.filter(
      (mapping) => mapping.omniCommand !== "world.inject",
    );

    expect(() => compileSceptreWorldBinding(input, experiment)).toThrow(
      /authorized Omni commands without explicit mappings: world.inject/,
    );
  });

  it("rejects mappings for commands the Experiment IR did not authorize", () => {
    const experiment = compiledExperiment();
    const input = bindingInput();
    input.mappings.push({
      omniCommand: "world.shell",
      action: "cyber.inject",
    });

    expect(() => compileSceptreWorldBinding(input, experiment)).toThrow(
      /world.shell is not authorized/,
    );
  });

  it("rejects shell or process-launch authority hidden in metadata", () => {
    const experiment = compiledExperiment();
    const input = bindingInput();
    input.metadata = {
      runtime: {
        shell: "/bin/bash",
      },
    };

    expect(() => compileSceptreWorldBinding(input, experiment)).toThrow(
      /execution-authority-shaped metadata/,
    );
  });
});
