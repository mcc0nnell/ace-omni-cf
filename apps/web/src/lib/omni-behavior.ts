import type { OmniOperatorDeck } from "./omni-operator";

export type OmniBehaviorDuty =
  | "collect"
  | "assess"
  | "remediate"
  | "approve"
  | "report"
  | "provision";

export const OMNI_REASONING_ROLES = [
  "collector",
  "researcher",
  "assessor",
  "challenger",
  "remediator",
  "reporter",
] as const;

export type OmniReasoningRole = (typeof OMNI_REASONING_ROLES)[number];

export type OmniBehaviorCompletionKind =
  | "evidence-emitted"
  | "assertion-recorded"
  | "remediation-recorded"
  | "approval-recorded"
  | "report-produced"
  | "provisioning-verified";

export interface OmniBehaviorCompletionContract {
  kind: OmniBehaviorCompletionKind;
  outputContract: string;
}

export interface OmniBehaviorSpec {
  id: string;
  label: string;
  instructionRef: string;
  instructionSha256: string;
  duty: OmniBehaviorDuty;
  /**
   * Optional cognitive role requested from an external intelligence boundary
   * such as Wintermute. This names the kind of reasoning needed, never a
   * provider/model or execution capability.
   */
  reasoningRole?: OmniReasoningRole;
  separationFrom: OmniBehaviorDuty[];
  requiredEvidence: string[];
  completion: OmniBehaviorCompletionContract;
}

export interface OmniBehaviorAssignment {
  contextId: string;
  behaviorSpecId: string;
  principalId: string;
}

export interface OmniBehaviorManifest {
  version: "1";
  specs: OmniBehaviorSpec[];
  assignments: OmniBehaviorAssignment[];
}

export interface OmniBehaviorBinding {
  contextId: string;
  groupId: string;
  principalId: string;
  behaviorSpecId: string;
  duty: OmniBehaviorDuty;
  reasoningRole?: OmniReasoningRole;
  instructionRef: string;
  instructionSha256: string;
  requiredEvidence: string[];
  completion: OmniBehaviorCompletionContract;
  // These remain authoritative operator bindings. They are copied from the
  // validated deck, never supplied by the behavior spec.
  executor: string;
  adapterId: string;
  capability: string;
}

const DUTIES = new Set<OmniBehaviorDuty>([
  "collect",
  "assess",
  "remediate",
  "approve",
  "report",
  "provision",
]);

const REASONING_ROLES = new Set<OmniReasoningRole>(OMNI_REASONING_ROLES);

const COMPLETION_KINDS = new Set<OmniBehaviorCompletionKind>([
  "evidence-emitted",
  "assertion-recorded",
  "remediation-recorded",
  "approval-recorded",
  "report-produced",
  "provisioning-verified",
]);

// A behavior specification can shape reasoning and completion semantics, but
// it must never grant execution authority or select its own model. These
// fields belong to the authoritative operator/runtime or external model-policy
// layer and are rejected if smuggled into a behavior-spec object at runtime.
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "executor",
  "adapterId",
  "capability",
  "capabilities",
  "tool",
  "tools",
  "allowedTools",
  "command",
  "args",
  "argv",
  "cwd",
  "env",
  "environment",
  "script",
  "executable",
  "shell",
  "provider",
  "providerId",
  "allowedProviders",
  "model",
  "modelId",
  "modelName",
  "modelRoute",
]);

const SHA256 = /^[0-9a-f]{64}$/i;

function assertUnique(values: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.trim()) throw new Error(`Omni behavior ${kind} must not be empty`);
    if (seen.has(value)) throw new Error(`Duplicate Omni behavior ${kind} ${value}`);
    seen.add(value);
  }
}

function assertNoAuthorityMaterial(spec: OmniBehaviorSpec): void {
  for (const key of Object.keys(spec)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
      throw new Error(
        `Omni behavior spec ${spec.id} contains forbidden authority field ${key}; ` +
          "behavior may constrain cognition but may not grant execution authority or select a model",
      );
    }
  }
}

function validateSpec(spec: OmniBehaviorSpec): void {
  assertNoAuthorityMaterial(spec);
  if (!spec.label.trim()) throw new Error(`Omni behavior spec ${spec.id} label must not be empty`);
  if (!spec.instructionRef.trim()) {
    throw new Error(`Omni behavior spec ${spec.id} instructionRef must not be empty`);
  }
  if (!SHA256.test(spec.instructionSha256)) {
    throw new Error(`Omni behavior spec ${spec.id} instructionSha256 must be a 64-character SHA-256 digest`);
  }
  if (!DUTIES.has(spec.duty)) throw new Error(`Omni behavior spec ${spec.id} has unsupported duty ${spec.duty}`);
  if (spec.reasoningRole && !REASONING_ROLES.has(spec.reasoningRole)) {
    throw new Error(`Omni behavior spec ${spec.id} has unsupported reasoning role ${spec.reasoningRole}`);
  }
  if (spec.duty === "approve" && spec.reasoningRole) {
    throw new Error(
      `Omni behavior spec ${spec.id} may not assign model reasoning role ${spec.reasoningRole} to approval duty`,
    );
  }
  if (!COMPLETION_KINDS.has(spec.completion.kind)) {
    throw new Error(`Omni behavior spec ${spec.id} has unsupported completion kind ${spec.completion.kind}`);
  }
  if (!spec.completion.outputContract.trim()) {
    throw new Error(`Omni behavior spec ${spec.id} output contract must not be empty`);
  }
  if (new Set(spec.separationFrom).size !== spec.separationFrom.length) {
    throw new Error(`Omni behavior spec ${spec.id} contains duplicate separation duties`);
  }
  for (const duty of spec.separationFrom) {
    if (!DUTIES.has(duty)) throw new Error(`Omni behavior spec ${spec.id} has unsupported separation duty ${duty}`);
    if (duty === spec.duty) {
      throw new Error(`Omni behavior spec ${spec.id} cannot separate its duty from itself`);
    }
  }
  if (new Set(spec.requiredEvidence).size !== spec.requiredEvidence.length) {
    throw new Error(`Omni behavior spec ${spec.id} contains duplicate evidence requirements`);
  }
  if (spec.requiredEvidence.some((item) => !item.trim())) {
    throw new Error(`Omni behavior spec ${spec.id} contains an empty evidence requirement`);
  }
}

function dutiesConflict(a: OmniBehaviorSpec, b: OmniBehaviorSpec): boolean {
  return a.separationFrom.includes(b.duty) || b.separationFrom.includes(a.duty);
}

export function composeBehaviorBindings(
  deck: OmniOperatorDeck,
  manifest: OmniBehaviorManifest,
): OmniBehaviorBinding[] {
  if (manifest.version !== "1") throw new Error(`Unsupported Omni behavior manifest version ${manifest.version}`);

  assertUnique(manifest.specs.map((spec) => spec.id), "spec id");
  assertUnique(manifest.assignments.map((assignment) => assignment.contextId), "context assignment");
  for (const spec of manifest.specs) validateSpec(spec);

  const paneByContext = new Map(deck.panes.map((pane) => [pane.contextId, pane]));
  const specById = new Map(manifest.specs.map((spec) => [spec.id, spec]));

  const resolved = manifest.assignments.map((assignment) => {
    if (!assignment.principalId.trim()) {
      throw new Error(`Omni behavior assignment ${assignment.contextId} principalId must not be empty`);
    }
    const pane = paneByContext.get(assignment.contextId);
    if (!pane) throw new Error(`Omni behavior assignment references unknown operator context ${assignment.contextId}`);
    const spec = specById.get(assignment.behaviorSpecId);
    if (!spec) throw new Error(`Omni behavior assignment references unknown spec ${assignment.behaviorSpecId}`);
    return { assignment, pane, spec };
  });

  // Separation of duties is evaluated per governance group and principal.
  // One principal may hold several compatible duties, but cannot silently
  // combine roles whose behavior specifications declare separation.
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      if (a.pane.groupId !== b.pane.groupId) continue;
      if (a.assignment.principalId !== b.assignment.principalId) continue;
      if (!dutiesConflict(a.spec, b.spec)) continue;
      throw new Error(
        `Omni behavior separation-of-duties violation: principal ${a.assignment.principalId} ` +
          `cannot perform both ${a.spec.duty} and ${b.spec.duty} in group ${a.pane.groupId}`,
      );
    }
  }

  return resolved.map(({ assignment, pane, spec }) => ({
    contextId: pane.contextId,
    groupId: pane.groupId,
    principalId: assignment.principalId,
    behaviorSpecId: spec.id,
    duty: spec.duty,
    ...(spec.reasoningRole ? { reasoningRole: spec.reasoningRole } : {}),
    instructionRef: spec.instructionRef,
    instructionSha256: spec.instructionSha256,
    requiredEvidence: [...spec.requiredEvidence],
    completion: { ...spec.completion },
    executor: pane.executor,
    adapterId: pane.adapterId,
    capability: pane.capability,
  }));
}

export const SC7_BEHAVIOR_MANIFEST: OmniBehaviorManifest = {
  version: "1",
  specs: [
    {
      id: "behavior:ssp-collector",
      label: "SSP claim collector",
      instructionRef: "fixture://sc7/ssp-collector/v1",
      instructionSha256: "23a050299ea1e1ded12390b8d8770147a6e3e9c0415e3e9df30919e5618cfcb1",
      duty: "collect",
      reasoningRole: "collector",
      separationFrom: ["assess", "remediate", "approve"],
      requiredEvidence: ["ssp-implementation-statement"],
      completion: {
        kind: "evidence-emitted",
        outputContract: "evidence/ssp-claim-v1",
      },
    },
    {
      id: "behavior:boundary-evidence-collector",
      label: "Boundary evidence collector",
      instructionRef: "fixture://sc7/boundary-evidence-collector/v1",
      instructionSha256: "1856d2dc1938cc0a1a9af594345d961731cecef600ee67fba87d1f6eed4a6757",
      duty: "collect",
      reasoningRole: "collector",
      separationFrom: ["assess", "remediate", "approve"],
      requiredEvidence: ["security-group-snapshot"],
      completion: {
        kind: "evidence-emitted",
        outputContract: "evidence/network-boundary-v1",
      },
    },
    {
      id: "behavior:contradiction-assessor",
      label: "Contradiction assessor",
      instructionRef: "fixture://sc7/contradiction-assessor/v1",
      instructionSha256: "3d3516d8c64f5d5b38b1c296b302f14e0f2782d00a029f864b3fbb6db7052fa4",
      duty: "assess",
      reasoningRole: "challenger",
      separationFrom: ["collect", "remediate", "approve"],
      requiredEvidence: ["ssp-implementation-statement", "security-group-snapshot"],
      completion: {
        kind: "assertion-recorded",
        outputContract: "assertion/control-contradiction-v1",
      },
    },
    {
      id: "behavior:finding-approver",
      label: "Human finding approver",
      instructionRef: "fixture://sc7/finding-approver/v1",
      instructionSha256: "cb09f78206931f95046aa1739b647a4ed13255785c65f7e8905f9e771f7262ab",
      duty: "approve",
      separationFrom: ["collect", "assess", "remediate"],
      requiredEvidence: ["control-assertion", "finding-record"],
      completion: {
        kind: "approval-recorded",
        outputContract: "decision/finding-review-v1",
      },
    },
  ],
  assignments: [
    {
      contextId: "context:ssp-claim",
      behaviorSpecId: "behavior:ssp-collector",
      principalId: "agent:ssp-collector",
    },
    {
      contextId: "context:aws-evidence",
      behaviorSpecId: "behavior:boundary-evidence-collector",
      principalId: "agent:boundary-collector",
    },
    {
      contextId: "context:contradiction",
      behaviorSpecId: "behavior:contradiction-assessor",
      principalId: "agent:control-assessor",
    },
    {
      contextId: "context:finding",
      behaviorSpecId: "behavior:finding-approver",
      principalId: "human:finding-reviewer",
    },
  ],
};
