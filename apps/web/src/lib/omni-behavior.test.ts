import { describe, expect, it } from "vitest";
import { SC7_WORKSPACE_EVENTS, composeOmniWorkspace } from "./omni-workspace";
import { SC7_OPERATOR_MANIFEST, composeOperatorDeck } from "./omni-operator";
import {
  SC7_BEHAVIOR_MANIFEST,
  composeBehaviorBindings,
  type OmniBehaviorManifest,
} from "./omni-behavior";

function deck() {
  const workspace = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, SC7_WORKSPACE_EVENTS.length, "mission");
  return composeOperatorDeck(workspace, SC7_OPERATOR_MANIFEST);
}

function cloneManifest(): OmniBehaviorManifest {
  return {
    version: "1",
    specs: SC7_BEHAVIOR_MANIFEST.specs.map((spec) => ({
      ...spec,
      separationFrom: [...spec.separationFrom],
      requiredEvidence: [...spec.requiredEvidence],
      completion: { ...spec.completion },
    })),
    assignments: SC7_BEHAVIOR_MANIFEST.assignments.map((assignment) => ({ ...assignment })),
  };
}

describe("composeBehaviorBindings", () => {
  it("binds versioned behavior specs to governed operator contexts deterministically", () => {
    const first = composeBehaviorBindings(deck(), SC7_BEHAVIOR_MANIFEST);
    const second = composeBehaviorBindings(deck(), SC7_BEHAVIOR_MANIFEST);

    expect(second).toEqual(first);
    expect(first.map((binding) => binding.duty)).toEqual(["collect", "collect", "assess", "approve"]);
    expect(first[2]).toMatchObject({
      contextId: "context:contradiction",
      principalId: "agent:control-assessor",
      reasoningRole: "challenger",
      adapterId: "assurance-graph",
      capability: "evidence.contradiction.evaluate",
    });
  });

  it("keeps execution authority on the operator context rather than the behavior spec", () => {
    const bindings = composeBehaviorBindings(deck(), SC7_BEHAVIOR_MANIFEST);
    const evidenceCollector = bindings.find((binding) => binding.contextId === "context:aws-evidence");

    expect(evidenceCollector?.instructionRef).toBe("fixture://sc7/boundary-evidence-collector/v1");
    expect(evidenceCollector?.reasoningRole).toBe("collector");
    expect(evidenceCollector?.adapterId).toBe("aws-ec2");
    expect(evidenceCollector?.capability).toBe("config.security-group.read");
    expect(SC7_BEHAVIOR_MANIFEST.specs[1]).not.toHaveProperty("adapterId");
    expect(SC7_BEHAVIOR_MANIFEST.specs[1]).not.toHaveProperty("capability");
  });

  it("requests a cognitive role without selecting a provider or model", () => {
    const contradiction = SC7_BEHAVIOR_MANIFEST.specs.find(
      (spec) => spec.id === "behavior:contradiction-assessor",
    );

    expect(contradiction?.reasoningRole).toBe("challenger");
    expect(contradiction).not.toHaveProperty("provider");
    expect(contradiction).not.toHaveProperty("model");
  });

  it("rejects behavior specs that smuggle capability or tool authority", () => {
    const manifest = cloneManifest();
    (manifest.specs[0] as OmniBehaviorManifest["specs"][number] & { capability?: string }).capability =
      "config.write";

    expect(() => composeBehaviorBindings(deck(), manifest)).toThrow(/forbidden authority field capability/);
  });

  it("rejects behavior specs that select their own provider or model", () => {
    const providerManifest = cloneManifest();
    (providerManifest.specs[0] as OmniBehaviorManifest["specs"][number] & { provider?: string }).provider =
      "openai";
    expect(() => composeBehaviorBindings(deck(), providerManifest)).toThrow(/forbidden authority field provider/);

    const modelManifest = cloneManifest();
    (modelManifest.specs[0] as OmniBehaviorManifest["specs"][number] & { model?: string }).model =
      "some-model";
    expect(() => composeBehaviorBindings(deck(), modelManifest)).toThrow(/forbidden authority field model/);
  });

  it("rejects behavior specs that smuggle executable material", () => {
    const manifest = cloneManifest();
    (manifest.specs[0] as OmniBehaviorManifest["specs"][number] & { command?: string }).command = "bash";

    expect(() => composeBehaviorBindings(deck(), manifest)).toThrow(/forbidden authority field command/);
  });

  it("requires versioned instruction provenance", () => {
    const manifest = cloneManifest();
    manifest.specs[0].instructionSha256 = "not-a-digest";

    expect(() => composeBehaviorBindings(deck(), manifest)).toThrow(/instructionSha256/);
  });

  it("enforces declared separation of duties inside a governance group", () => {
    const manifest = cloneManifest();
    const assessor = manifest.assignments.find((assignment) => assignment.contextId === "context:contradiction");
    const collector = manifest.assignments.find((assignment) => assignment.contextId === "context:aws-evidence");
    if (!assessor || !collector) throw new Error("fixture assignments missing");
    assessor.principalId = collector.principalId;

    expect(() => composeBehaviorBindings(deck(), manifest)).toThrow(
      /separation-of-duties violation.*cannot perform both collect and assess|cannot perform both assess and collect/,
    );
  });

  it("does not permit a model reasoning role on approval duty", () => {
    const manifest = cloneManifest();
    const approval = manifest.specs.find((spec) => spec.duty === "approve");
    if (!approval) throw new Error("approval fixture missing");
    approval.reasoningRole = "assessor";

    expect(() => composeBehaviorBindings(deck(), manifest)).toThrow(/may not assign model reasoning role.*approval duty/);
  });

  it("keeps human approval assigned to a distinct principal", () => {
    const bindings = composeBehaviorBindings(deck(), SC7_BEHAVIOR_MANIFEST);
    const approval = bindings.find((binding) => binding.duty === "approve");

    expect(approval).toMatchObject({
      contextId: "context:finding",
      principalId: "human:finding-reviewer",
      completion: {
        kind: "approval-recorded",
        outputContract: "decision/finding-review-v1",
      },
    });
    expect(approval).not.toHaveProperty("reasoningRole");
  });
});
