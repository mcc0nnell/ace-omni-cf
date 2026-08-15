import { describe, expect, it } from "vitest";
import {
  checkControlEvidenceReadiness,
  compileRegime,
  RegimeCompileError,
  type RegimeLayer,
  validateControlAssertion,
} from "./regime.js";

function baseLayer(): RegimeLayer {
  return {
    schemaVersion: 1,
    id: "federal-baseline",
    title: "Synthetic federal baseline",
    version: "1.0.0",
    precedence: 10,
    authority: {
      issuer: "Synthetic test authority",
      jurisdiction: "test-only",
      sources: [
        {
          id: "baseline-catalog",
          kind: "oscal_catalog",
          title: "Synthetic OSCAL catalog",
          uri: "https://example.invalid/catalog.json",
          revision: "abc123",
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
        sourceRefs: ["baseline-catalog"],
        assessmentObjectiveIds: ["ac-2.a", "ac-2.b"],
        evidenceRequirements: [
          {
            id: "account-config",
            kind: "configuration",
            description: "Current account-management configuration",
            required: true,
            producerCapabilities: ["config.read"],
            mediaTypes: ["application/json"],
          },
          {
            id: "account-log",
            kind: "log",
            description: "Account lifecycle events",
            required: true,
            producerCapabilities: ["log.read"],
            mediaTypes: ["application/jsonl", "text/plain"],
          },
          {
            id: "operator-note",
            kind: "attestation",
            description: "Optional operator context",
            required: false,
            producerCapabilities: [],
            mediaTypes: ["text/markdown"],
          },
        ],
        evaluatorBindings: [
          {
            id: "evaluate-account-control",
            capability: "grc.evaluate",
            command: "EVALUATE_CONTROL",
            evidenceRequirementIds: ["account-log", "account-config"],
            parameters: { method: "synthetic" },
          },
        ],
        parameters: { reviewWindowDays: 30 },
        decision: { gateOn: ["fail"], missingEvidenceStatus: "needs_review" },
        applicability: "required",
      },
      {
        mode: "define",
        id: "au-2",
        title: "Synthetic event-logging control",
        sourceRefs: ["baseline-catalog"],
        assessmentObjectiveIds: [],
        evidenceRequirements: [
          {
            id: "audit-config",
            kind: "configuration",
            description: "Audit configuration",
            required: true,
            producerCapabilities: ["config.read"],
            mediaTypes: ["application/json"],
          },
        ],
        evaluatorBindings: [
          {
            id: "evaluate-audit-control",
            capability: "grc.evaluate",
            command: "EVALUATE_CONTROL",
            evidenceRequirementIds: ["audit-config"],
            parameters: {},
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

function overlayLayer(): RegimeLayer {
  return {
    schemaVersion: 1,
    id: "agency-overlay",
    title: "Synthetic agency overlay",
    version: "2026.1",
    precedence: 20,
    authority: {
      issuer: "Synthetic agency",
      jurisdiction: "test-only",
      sources: [
        {
          id: "agency-policy",
          kind: "policy",
          title: "Synthetic agency policy",
          uri: "https://example.invalid/policy",
          version: "2026.1",
        },
      ],
    },
    appliesTo: ["synthetic-system"],
    imports: ["federal-baseline"],
    controls: [
      {
        mode: "exclude",
        id: "au-2",
        rationale: "The synthetic overlay delegates this control outside the fixture boundary.",
        sourceRefs: ["agency-policy"],
      },
      {
        mode: "override",
        id: "ac-2",
        title: "Synthetic agency account-management control",
        statement: "The overlay tightens the evidence requirements for the base control.",
        sourceRefs: ["agency-policy"],
        assessmentObjectiveIds: ["ac-2.a", "ac-2.b", "agency.ac-2.1"],
        evidenceRequirements: [
          {
            id: "account-config",
            kind: "configuration",
            description: "Current account-management configuration",
            required: true,
            producerCapabilities: ["config.read"],
            mediaTypes: ["application/json"],
          },
          {
            id: "account-log",
            kind: "log",
            description: "Account lifecycle events",
            required: true,
            producerCapabilities: ["log.read"],
            mediaTypes: ["text/plain", "application/jsonl"],
          },
        ],
        evaluatorBindings: [
          {
            id: "evaluate-account-control",
            capability: "grc.evaluate",
            command: "EVALUATE_CONTROL",
            evidenceRequirementIds: ["account-config", "account-log"],
            parameters: { method: "synthetic-agency" },
          },
        ],
        parameters: { reviewWindowDays: 15 },
        decision: { gateOn: ["needs_review", "fail"], missingEvidenceStatus: "needs_review" },
        applicability: "required",
      },
    ],
    metadata: { fixture: true },
  };
}

describe("regime compiler", () => {
  it("compiles composable layers deterministically and preserves provenance", async () => {
    const base = baseLayer();
    const overlay = overlayLayer();
    const first = await compileRegime({
      schemaVersion: 1,
      id: "effective-regime",
      title: "Synthetic effective regime",
      layers: [overlay, base],
    });

    const second = await compileRegime({
      schemaVersion: 1,
      id: "effective-regime",
      title: "Synthetic effective regime",
      layers: [
        { ...base, controls: [...base.controls].reverse() },
        { ...overlay, controls: [...overlay.controls].reverse() },
      ],
    });

    expect(second.sha256).toBe(first.sha256);
    expect(second).toEqual(first);
    expect(first.layers.map((layer) => layer.id)).toEqual(["federal-baseline", "agency-overlay"]);

    const account = first.controls.find((control) => control.id === "ac-2");
    expect(account?.title).toBe("Synthetic agency account-management control");
    expect(account?.parameters).toEqual({ reviewWindowDays: 15 });
    expect(account?.provenance.map((item) => item.operation)).toEqual(["define", "override"]);
    expect(account?.effectiveLayerId).toBe("agency-overlay");

    const audit = first.controls.find((control) => control.id === "au-2");
    expect(audit?.applicability).toBe("excluded");
    expect(audit?.evidenceRequirements).toEqual([]);
    expect(audit?.evaluatorBindings).toEqual([]);
    expect(audit?.provenance.map((item) => item.operation)).toEqual(["define", "exclude"]);
  });

  it("fails closed on ambiguous control redefinition", async () => {
    const duplicate = overlayLayer();
    const sourceControl = baseLayer().controls[0];
    if (sourceControl.mode === "exclude") {
      throw new Error("Synthetic baseline fixture unexpectedly excluded ac-2");
    }
    duplicate.controls = [
      {
        ...sourceControl,
        mode: "define",
        sourceRefs: ["agency-policy"],
      },
    ];

    await expect(
      compileRegime({
        schemaVersion: 1,
        id: "ambiguous-regime",
        title: "Ambiguous regime",
        layers: [baseLayer(), duplicate],
      }),
    ).rejects.toThrow("must use an explicit override or exclusion");
  });

  it("requires every imported layer and strictly increasing overlay precedence", async () => {
    const missing = overlayLayer();
    missing.imports = ["not-supplied"];
    await expect(
      compileRegime({
        schemaVersion: 1,
        id: "missing-import",
        title: "Missing import",
        layers: [baseLayer(), missing],
      }),
    ).rejects.toThrow("imports missing layer");

    const badPrecedence = overlayLayer();
    badPrecedence.precedence = 10;
    await expect(
      compileRegime({
        schemaVersion: 1,
        id: "bad-precedence",
        title: "Bad precedence",
        layers: [baseLayer(), badPrecedence],
      }),
    ).rejects.toThrow("must have higher precedence");
  });

  it("treats missing required evidence as needs_review rather than pass", async () => {
    const regime = await compileRegime({
      schemaVersion: 1,
      id: "effective-regime",
      title: "Synthetic effective regime",
      layers: [baseLayer(), overlayLayer()],
    });

    expect(
      checkControlEvidenceReadiness(regime, "ac-2", [
        { requirementId: "account-config", evidenceIds: ["ev-config-1"] },
      ]),
    ).toEqual({
      status: "needs_review",
      satisfiedRequirementIds: ["account-config"],
      missingRequirementIds: ["account-log"],
    });

    expect(
      checkControlEvidenceReadiness(regime, "ac-2", [
        { requirementId: "account-log", evidenceIds: ["ev-log-1"] },
        { requirementId: "account-config", evidenceIds: ["ev-config-1"] },
      ]),
    ).toEqual({
      status: "ready",
      satisfiedRequirementIds: ["account-config", "account-log"],
      missingRequirementIds: [],
    });

    expect(checkControlEvidenceReadiness(regime, "au-2", [])).toEqual({
      status: "not_applicable",
      satisfiedRequirementIds: [],
      missingRequirementIds: [],
    });
  });

  it("binds assertions to the exact effective regime and rejects evidence laundering", async () => {
    const regime = await compileRegime({
      schemaVersion: 1,
      id: "effective-regime",
      title: "Synthetic effective regime",
      layers: [baseLayer(), overlayLayer()],
    });

    const incompletePass = {
      schemaVersion: 1 as const,
      regimeId: regime.id,
      regimeSha256: regime.sha256,
      controlId: "ac-2",
      status: "pass" as const,
      evaluatorId: "synthetic-evaluator",
      evidence: [{ requirementId: "account-config", evidenceIds: ["ev-config-1"] }],
      rationale: "Synthetic pass attempt",
      observedAt: "2026-08-14T05:00:00Z",
    };
    expect(() => validateControlAssertion(regime, incompletePass)).toThrow(
      "cannot pass with missing evidence requirements",
    );

    const needsReview = { ...incompletePass, status: "needs_review" as const };
    expect(validateControlAssertion(regime, needsReview)).toEqual(needsReview);

    const completePass = {
      ...incompletePass,
      evidence: [
        { requirementId: "account-config", evidenceIds: ["ev-config-1"] },
        { requirementId: "account-log", evidenceIds: ["ev-log-1"] },
      ],
    };
    expect(validateControlAssertion(regime, completePass)).toEqual(completePass);

    expect(() =>
      validateControlAssertion(regime, {
        ...completePass,
        regimeSha256: "0".repeat(64),
      }),
    ).toThrow("is not bound to effective regime");

    expect(() =>
      checkControlEvidenceReadiness(regime, "ac-2", [
        { requirementId: "invented-evidence", evidenceIds: ["ev-invented"] },
      ]),
    ).toThrow(RegimeCompileError);
  });
});
