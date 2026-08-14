import { describe, expect, it } from "vitest";
import {
  compileRegime,
  type ControlAssertion,
  type RegimeLayer,
} from "@ace-omni/domain/regime";
import {
  AssessmentCompileError,
  compileAssessmentPack,
  compileScanAndEvaluatePlan,
  evaluateAssessmentGate,
  type AssessmentPack,
} from "./assessment";

function regimeLayer(): RegimeLayer {
  return {
    schemaVersion: 1,
    id: "synthetic-baseline",
    title: "Synthetic baseline",
    version: "1.0.0",
    precedence: 10,
    authority: {
      issuer: "Synthetic authority",
      sources: [
        {
          id: "synthetic-catalog",
          kind: "oscal_catalog",
          title: "Synthetic OSCAL catalog",
          revision: "fixture-1",
        },
      ],
    },
    appliesTo: ["synthetic-system"],
    imports: [],
    controls: [
      {
        mode: "define",
        id: "ac-2",
        title: "Synthetic account-management control",
        sourceRefs: ["synthetic-catalog"],
        assessmentObjectiveIds: ["ac-2.a"],
        evidenceRequirements: [
          {
            id: "account-config",
            kind: "configuration",
            description: "Current account configuration",
            required: true,
            producerCapabilities: ["config.read"],
            mediaTypes: ["application/json"],
          },
        ],
        evaluatorBindings: [
          {
            id: "evaluate-account-control",
            capability: "grc.evaluate",
            command: "EVALUATE_CONTROL",
            evidenceRequirementIds: ["account-config"],
            parameters: { method: "synthetic" },
          },
        ],
        parameters: {},
        decision: { gateOn: ["fail"], missingEvidenceStatus: "needs_review" },
        applicability: "required",
      },
    ],
    metadata: { fixture: true },
  };
}

function pack(regimeId: string, regimeSha256: string): AssessmentPack {
  return {
    version: 1,
    id: "synthetic-assessment",
    targetId: "sut-1",
    regimeId,
    regimeSha256,
    runtimeBindings: [
      {
        regimeCapability: "grc.evaluate",
        adapterId: "grc-adapter",
        adapterCapability: "custom",
        operation: "EVALUATE_CONTROL",
        parameters: { evaluator: "synthetic" },
      },
      {
        regimeCapability: "config.read",
        adapterId: "config-adapter",
        adapterCapability: "cyber",
        operation: "COLLECT_CONFIGURATION",
      },
    ],
  };
}

async function effectiveRegime() {
  return compileRegime({
    schemaVersion: 1,
    id: "synthetic-effective",
    title: "Synthetic effective regime",
    layers: [regimeLayer()],
  });
}

describe("regime assessment packs", () => {
  it("compiles 14ten-style scan-and-evaluate into canonical Omni command tasks", async () => {
    const regime = await effectiveRegime();
    const compiled = await compileScanAndEvaluatePlan(regime, pack(regime.id, regime.sha256));

    expect(compiled.tasks.map((task) => task.phase)).toEqual(["collect", "evaluate"]);
    expect(compiled.tasks[0]).toMatchObject({
      id: "collect:ac-2:account-config",
      sourceKind: "evidence_requirement",
      command: {
        id: "collect:ac-2:account-config",
        adapterId: "config-adapter",
        capability: "cyber",
        operation: "COLLECT_CONFIGURATION",
      },
    });
    expect(compiled.tasks[1]).toMatchObject({
      id: "evaluate:ac-2:evaluate-account-control",
      sourceKind: "evaluator_binding",
      dependsOn: ["collect:ac-2:account-config"],
      command: {
        id: "evaluate:ac-2:evaluate-account-control",
        adapterId: "grc-adapter",
        capability: "custom",
        operation: "EVALUATE_CONTROL",
      },
    });
  });

  it("is deterministic across runtime-binding input order", async () => {
    const regime = await effectiveRegime();
    const firstPack = pack(regime.id, regime.sha256);
    const secondPack = { ...firstPack, runtimeBindings: [...firstPack.runtimeBindings].reverse() };

    const first = await compileAssessmentPack(regime, firstPack);
    const second = await compileAssessmentPack(regime, secondPack);

    expect(second.sha256).toBe(first.sha256);
    expect(second).toEqual(first);
  });

  it("fails closed when a pack targets the wrong regime or cannot collect required evidence", async () => {
    const regime = await effectiveRegime();
    await expect(
      compileAssessmentPack(regime, pack(regime.id, "0".repeat(64))),
    ).rejects.toThrow("is not bound to effective regime");

    const missingCollector = pack(regime.id, regime.sha256);
    missingCollector.runtimeBindings = missingCollector.runtimeBindings.filter(
      (binding) => binding.regimeCapability !== "config.read",
    );
    await expect(compileAssessmentPack(regime, missingCollector)).rejects.toThrow(
      "has no mapped producer capability",
    );
  });

  it("rejects required evidence that no evaluator actually consumes", async () => {
    const layer = regimeLayer();
    const control = layer.controls[0];
    if (!control || control.mode === "exclude") throw new Error("fixture unexpectedly excluded");
    control.evidenceRequirements.push({
      id: "account-log",
      kind: "log",
      description: "Required lifecycle log not consumed by the evaluator",
      required: true,
      producerCapabilities: ["config.read"],
      mediaTypes: ["application/jsonl"],
    });

    const regime = await compileRegime({
      schemaVersion: 1,
      id: "invalid-effective",
      title: "Invalid effective regime",
      layers: [layer],
    });
    await expect(compileAssessmentPack(regime, pack(regime.id, regime.sha256))).rejects.toThrow(
      "Required evidence ac-2/account-log is not consumed by any evaluator binding",
    );
  });

  it("keeps absent assertions as needs_review, then allows or blocks from regime policy", async () => {
    const regime = await effectiveRegime();
    const noAssertions = evaluateAssessmentGate(regime, []);
    expect(noAssertions).toMatchObject({
      status: "needs_review",
      blocked: false,
      unresolvedControlIds: ["ac-2"],
    });

    const baseAssertion = {
      schemaVersion: 1 as const,
      regimeId: regime.id,
      regimeSha256: regime.sha256,
      controlId: "ac-2",
      evaluatorId: "synthetic-evaluator",
      evidence: [{ requirementId: "account-config", evidenceIds: ["evidence-1"] }],
      rationale: "Synthetic result",
      observedAt: "2026-08-14T05:00:00Z",
    };

    const pass: ControlAssertion = { ...baseAssertion, status: "pass" };
    expect(evaluateAssessmentGate(regime, [pass])).toMatchObject({
      status: "allow",
      blocked: false,
      blockingControlIds: [],
      unresolvedControlIds: [],
    });

    const fail: ControlAssertion = { ...baseAssertion, status: "fail" };
    expect(evaluateAssessmentGate(regime, [fail])).toMatchObject({
      status: "block",
      blocked: true,
      blockingControlIds: ["ac-2"],
    });
  });

  it("rejects duplicate runtime capability routing rather than selecting one implicitly", async () => {
    const regime = await effectiveRegime();
    const duplicate = pack(regime.id, regime.sha256);
    duplicate.runtimeBindings.push({
      regimeCapability: "config.read",
      adapterId: "other-config-adapter",
      adapterCapability: "cyber",
      operation: "COLLECT_CONFIGURATION",
    });

    await expect(compileAssessmentPack(regime, duplicate)).rejects.toThrow(AssessmentCompileError);
  });
});
