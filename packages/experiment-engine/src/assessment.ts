import {
  validateControlAssertion,
  type ControlAssertion,
  type EffectiveRegime,
} from "@ace-omni/domain/regime";
import {
  sha256Canonical,
  type AdapterCapability,
  type JsonValue,
  type PlannedCommandDefinition,
} from "./emulytics";

const StableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export interface AssessmentRuntimeBinding {
  regimeCapability: string;
  adapterId: string;
  adapterCapability: AdapterCapability;
  operation: string;
  parameters?: Record<string, JsonValue>;
}

export interface AssessmentPack {
  version: 1;
  id: string;
  targetId: string;
  regimeId: string;
  regimeSha256: string;
  runtimeBindings: AssessmentRuntimeBinding[];
}

export interface AssessmentTask {
  version: 1;
  id: string;
  phase: "collect" | "evaluate";
  controlId: string;
  sourceKind: "evidence_requirement" | "evaluator_binding";
  sourceId: string;
  dependsOn: string[];
  command: PlannedCommandDefinition;
}

export interface CompiledAssessmentPlan {
  version: 1;
  packId: string;
  targetId: string;
  regimeId: string;
  regimeSha256: string;
  tasks: AssessmentTask[];
  sha256: string;
}

export interface AssessmentControlDecision {
  controlId: string;
  status: "pass" | "fail" | "needs_review" | "not_applicable";
  gated: boolean;
  assertionCount: number;
}

export interface AssessmentGateDecision {
  version: 1;
  regimeId: string;
  regimeSha256: string;
  status: "allow" | "block" | "needs_review";
  blocked: boolean;
  controls: AssessmentControlDecision[];
  blockingControlIds: string[];
  unresolvedControlIds: string[];
}

export class AssessmentCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentCompileError";
  }
}

function assertStableId(value: string, label: string): void {
  if (!StableIdPattern.test(value)) {
    throw new AssessmentCompileError(`${label} must be a stable identifier`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new AssessmentCompileError(`${label} must be a SHA-256 hex digest`);
  }
}

function normalizeJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AssessmentCompileError(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJsonValue(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (entry === undefined) throw new AssessmentCompileError(`${path}.${key} is undefined`);
      out[key] = normalizeJsonValue(entry, `${path}.${key}`);
    }
    return out;
  }
  throw new AssessmentCompileError(`${path} is not JSON serializable`);
}

function normalizeJsonRecord(value: Record<string, unknown>, path: string): Record<string, JsonValue> {
  return normalizeJsonValue(value, path) as Record<string, JsonValue>;
}

function normalizeRuntimeBindings(bindings: AssessmentRuntimeBinding[]): AssessmentRuntimeBinding[] {
  const capabilities = new Set<string>();
  const normalized = bindings.map((binding, index) => {
    assertStableId(binding.regimeCapability, `runtimeBindings[${index}].regimeCapability`);
    assertStableId(binding.adapterId, `runtimeBindings[${index}].adapterId`);
    assertStableId(binding.operation, `runtimeBindings[${index}].operation`);
    if (capabilities.has(binding.regimeCapability)) {
      throw new AssessmentCompileError(
        `Assessment pack has multiple runtime bindings for regime capability ${binding.regimeCapability}`,
      );
    }
    capabilities.add(binding.regimeCapability);
    return {
      ...binding,
      parameters: binding.parameters ? normalizeJsonRecord(binding.parameters, `runtimeBindings[${index}].parameters`) : {},
    };
  });
  return normalized.sort((a, b) => a.regimeCapability.localeCompare(b.regimeCapability));
}

function mergeParameters(
  runtime: Record<string, JsonValue>,
  authored: Record<string, unknown>,
  generated: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return {
    ...runtime,
    ...normalizeJsonRecord(authored, "regime parameters"),
    ...generated,
  };
}

function runtimeBindingFor(
  bindings: Map<string, AssessmentRuntimeBinding>,
  regimeCapability: string,
  context: string,
): AssessmentRuntimeBinding {
  const binding = bindings.get(regimeCapability);
  if (!binding) {
    throw new AssessmentCompileError(`${context} requires unmapped regime capability ${regimeCapability}`);
  }
  return binding;
}

function taskId(prefix: "collect" | "evaluate", controlId: string, sourceId: string): string {
  const id = `${prefix}:${controlId}:${sourceId}`;
  assertStableId(id, "assessment task id");
  return id;
}

export async function compileAssessmentPack(
  regime: EffectiveRegime,
  pack: AssessmentPack,
): Promise<CompiledAssessmentPlan> {
  if (pack.version !== 1) throw new AssessmentCompileError("assessment pack version must be 1");
  assertStableId(pack.id, "assessment pack id");
  assertStableId(pack.targetId, "assessment target id");
  assertStableId(pack.regimeId, "assessment regime id");
  assertSha256(pack.regimeSha256, "assessment regime digest");
  if (pack.regimeId !== regime.id || pack.regimeSha256 !== regime.sha256) {
    throw new AssessmentCompileError(
      `Assessment pack ${pack.id} is not bound to effective regime ${regime.id}@${regime.sha256}`,
    );
  }

  const normalizedBindings = normalizeRuntimeBindings(pack.runtimeBindings);
  const bindingsByCapability = new Map(normalizedBindings.map((binding) => [binding.regimeCapability, binding] as const));
  const tasks: AssessmentTask[] = [];

  for (const control of [...regime.controls].sort((a, b) => a.id.localeCompare(b.id))) {
    if (control.applicability === "excluded") continue;
    if (control.evaluatorBindings.length === 0) {
      throw new AssessmentCompileError(`Control ${control.id} has no evaluator binding`);
    }

    const evaluatorRequirementIds = new Set(
      control.evaluatorBindings.flatMap((binding) => binding.evidenceRequirementIds),
    );
    for (const requirement of control.evidenceRequirements.filter((candidate) => candidate.required)) {
      if (!evaluatorRequirementIds.has(requirement.id)) {
        throw new AssessmentCompileError(
          `Required evidence ${control.id}/${requirement.id} is not consumed by any evaluator binding`,
        );
      }
    }

    const collectionTaskIds = new Map<string, string>();
    const collectionRequirements = control.evidenceRequirements
      .filter((requirement) => requirement.required || evaluatorRequirementIds.has(requirement.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const requirement of collectionRequirements) {
      const matchedCapability = [...requirement.producerCapabilities]
        .sort()
        .find((capability) => bindingsByCapability.has(capability));
      if (!matchedCapability) {
        throw new AssessmentCompileError(
          `Evidence ${control.id}/${requirement.id} has no mapped producer capability`,
        );
      }
      const runtime = runtimeBindingFor(
        bindingsByCapability,
        matchedCapability,
        `Evidence ${control.id}/${requirement.id}`,
      );
      const id = taskId("collect", control.id, requirement.id);
      collectionTaskIds.set(requirement.id, id);
      tasks.push({
        version: 1,
        id,
        phase: "collect",
        controlId: control.id,
        sourceKind: "evidence_requirement",
        sourceId: requirement.id,
        dependsOn: [],
        command: {
          id,
          adapterId: runtime.adapterId,
          capability: runtime.adapterCapability,
          scheduledOffsetMs: 0,
          operation: runtime.operation,
          parameters: mergeParameters(runtime.parameters ?? {}, {}, {
            assessmentPackId: pack.id,
            targetId: pack.targetId,
            regimeId: regime.id,
            regimeSha256: regime.sha256,
            controlId: control.id,
            evidenceRequirementId: requirement.id,
            evidenceKind: requirement.kind,
          }),
        },
      });
    }

    for (const evaluator of [...control.evaluatorBindings].sort((a, b) => a.id.localeCompare(b.id))) {
      const runtime = runtimeBindingFor(
        bindingsByCapability,
        evaluator.capability,
        `Evaluator ${control.id}/${evaluator.id}`,
      );
      const dependsOn = [...evaluator.evidenceRequirementIds]
        .sort()
        .map((requirementId) => {
          const dependency = collectionTaskIds.get(requirementId);
          if (!dependency) {
            throw new AssessmentCompileError(
              `Evaluator ${control.id}/${evaluator.id} depends on unplanned evidence ${requirementId}`,
            );
          }
          return dependency;
        });
      const id = taskId("evaluate", control.id, evaluator.id);
      tasks.push({
        version: 1,
        id,
        phase: "evaluate",
        controlId: control.id,
        sourceKind: "evaluator_binding",
        sourceId: evaluator.id,
        dependsOn,
        command: {
          id,
          adapterId: runtime.adapterId,
          capability: runtime.adapterCapability,
          scheduledOffsetMs: 0,
          operation: runtime.operation,
          parameters: mergeParameters(runtime.parameters ?? {}, evaluator.parameters, {
            assessmentPackId: pack.id,
            targetId: pack.targetId,
            regimeId: regime.id,
            regimeSha256: regime.sha256,
            controlId: control.id,
            evaluatorBindingId: evaluator.id,
            evidenceRequirementIds: [...evaluator.evidenceRequirementIds].sort(),
          }),
        },
      });
    }
  }

  tasks.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === "collect" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const unsigned = {
    version: 1 as const,
    packId: pack.id,
    targetId: pack.targetId,
    regimeId: regime.id,
    regimeSha256: regime.sha256,
    tasks,
  };
  const sha256 = await sha256Canonical(unsigned as unknown as JsonValue);
  return { ...unsigned, sha256 };
}

/** Historical 14ten name retained as an explicit architectural bridge. */
export const compileScanAndEvaluatePlan = compileAssessmentPack;

const StatusRank: Record<ControlAssertion["status"], number> = {
  pass: 0,
  not_applicable: 0,
  needs_review: 1,
  fail: 2,
};

export function evaluateAssessmentGate(
  regime: EffectiveRegime,
  assertionInputs: ControlAssertion[],
): AssessmentGateDecision {
  const assertions = assertionInputs.map((assertion) => validateControlAssertion(regime, assertion));
  const byControl = new Map<string, ControlAssertion[]>();
  for (const assertion of assertions) {
    const bucket = byControl.get(assertion.controlId) ?? [];
    bucket.push(assertion);
    byControl.set(assertion.controlId, bucket);
  }

  const controls: AssessmentControlDecision[] = [];
  for (const control of [...regime.controls].sort((a, b) => a.id.localeCompare(b.id))) {
    if (control.applicability === "excluded") {
      controls.push({ controlId: control.id, status: "not_applicable", gated: false, assertionCount: 0 });
      continue;
    }

    const controlAssertions = byControl.get(control.id) ?? [];
    const status = controlAssertions.length === 0
      ? "needs_review"
      : [...controlAssertions]
          .sort((a, b) => StatusRank[b.status] - StatusRank[a.status] || a.evaluatorId.localeCompare(b.evaluatorId))[0]
          .status;
    controls.push({
      controlId: control.id,
      status,
      gated: control.decision.gateOn.includes(status),
      assertionCount: controlAssertions.length,
    });
  }

  const blockingControlIds = controls.filter((control) => control.gated).map((control) => control.controlId);
  const unresolvedControlIds = controls
    .filter((control) => control.status === "needs_review")
    .map((control) => control.controlId);
  const blocked = blockingControlIds.length > 0;
  const status = blocked ? "block" : unresolvedControlIds.length > 0 ? "needs_review" : "allow";

  return {
    version: 1,
    regimeId: regime.id,
    regimeSha256: regime.sha256,
    status,
    blocked,
    controls,
    blockingControlIds,
    unresolvedControlIds,
  };
}
