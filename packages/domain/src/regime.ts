import { z } from "zod";

const StableIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Expected a stable identifier");
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const IsoDateSchema = z.string().datetime({ offset: true });

export const RegimeSourceKindSchema = z.enum([
  "oscal_catalog",
  "oscal_profile",
  "oscal_component_definition",
  "oscal_system_security_plan",
  "oscal_assessment_plan",
  "oscal_assessment_results",
  "oscal_poam",
  "statute",
  "regulation",
  "standard",
  "policy",
  "contract",
  "custom",
]);
export type RegimeSourceKind = z.infer<typeof RegimeSourceKindSchema>;

export const RegimeSourceSchema = z.object({
  id: StableIdSchema,
  kind: RegimeSourceKindSchema,
  title: z.string().trim().min(1).max(500),
  uri: z.string().url().optional(),
  version: z.string().trim().min(1).max(120).optional(),
  revision: z.string().trim().min(1).max(160).optional(),
  sha256: Sha256HexSchema.optional(),
});
export type RegimeSource = z.infer<typeof RegimeSourceSchema>;

export const RegimeAuthoritySchema = z.object({
  issuer: z.string().trim().min(1).max(300),
  jurisdiction: z.string().trim().min(1).max(200).optional(),
  sources: z.array(RegimeSourceSchema).min(1),
});
export type RegimeAuthority = z.infer<typeof RegimeAuthoritySchema>;

export const EvidenceRequirementKindSchema = z.enum([
  "observation",
  "artifact",
  "configuration",
  "log",
  "scan",
  "attestation",
  "interview",
  "test_result",
  "manual_review",
  "custom",
]);
export type EvidenceRequirementKind = z.infer<typeof EvidenceRequirementKindSchema>;

export const EvidenceRequirementSchema = z.object({
  id: StableIdSchema,
  kind: EvidenceRequirementKindSchema,
  description: z.string().trim().min(1).max(2_000),
  required: z.boolean().default(true),
  freshnessSeconds: z.number().int().positive().optional(),
  producerCapabilities: z.array(StableIdSchema).default([]),
  mediaTypes: z.array(z.string().trim().min(1).max(160)).default([]),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

export const RegimeEvaluatorBindingSchema = z.object({
  id: StableIdSchema,
  capability: StableIdSchema,
  command: StableIdSchema,
  evidenceRequirementIds: z.array(StableIdSchema).min(1),
  parameters: z.record(z.unknown()).default({}),
});
export type RegimeEvaluatorBinding = z.infer<typeof RegimeEvaluatorBindingSchema>;

export const AssertionStatusSchema = z.enum([
  "pass",
  "fail",
  "needs_review",
  "not_applicable",
]);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

export const RegimeDecisionRuleSchema = z.object({
  gateOn: z.array(AssertionStatusSchema).default(["fail"]),
  missingEvidenceStatus: z.literal("needs_review").default("needs_review"),
});
export type RegimeDecisionRule = z.infer<typeof RegimeDecisionRuleSchema>;

const ControlBodyShape = {
  id: StableIdSchema,
  title: z.string().trim().min(1).max(500),
  statement: z.string().trim().min(1).max(8_000).optional(),
  applicability: z.enum(["required", "conditional"]).default("required"),
  sourceRefs: z.array(StableIdSchema).min(1),
  assessmentObjectiveIds: z.array(StableIdSchema).default([]),
  evidenceRequirements: z.array(EvidenceRequirementSchema).default([]),
  evaluatorBindings: z.array(RegimeEvaluatorBindingSchema).default([]),
  parameters: z.record(z.unknown()).default({}),
  decision: RegimeDecisionRuleSchema.default({}),
};

export const RegimeControlDefinitionSchema = z.object({
  mode: z.literal("define"),
  ...ControlBodyShape,
});
export type RegimeControlDefinition = z.infer<typeof RegimeControlDefinitionSchema>;

export const RegimeControlOverrideSchema = z.object({
  mode: z.literal("override"),
  ...ControlBodyShape,
});
export type RegimeControlOverride = z.infer<typeof RegimeControlOverrideSchema>;

export const RegimeControlExclusionSchema = z.object({
  mode: z.literal("exclude"),
  id: StableIdSchema,
  rationale: z.string().trim().min(1).max(2_000),
  sourceRefs: z.array(StableIdSchema).min(1),
});
export type RegimeControlExclusion = z.infer<typeof RegimeControlExclusionSchema>;

export const RegimeControlSchema = z.discriminatedUnion("mode", [
  RegimeControlDefinitionSchema,
  RegimeControlOverrideSchema,
  RegimeControlExclusionSchema,
]);
export type RegimeControl = z.infer<typeof RegimeControlSchema>;

export const RegimeLayerSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: StableIdSchema,
    title: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(120),
    precedence: z.number().int().min(0).max(1_000_000),
    authority: RegimeAuthoritySchema,
    appliesTo: z.array(z.string().trim().min(1).max(500)).default([]),
    imports: z.array(StableIdSchema).default([]),
    controls: z.array(RegimeControlSchema).min(1),
    metadata: z.record(z.unknown()).default({}),
  })
  .superRefine((layer, context) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of layer.authority.sources.entries()) {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authority", "sources", index, "id"],
          message: `Duplicate regime source id: ${source.id}`,
        });
      }
      sourceIds.add(source.id);
    }

    const controlIds = new Set<string>();
    for (const [controlIndex, control] of layer.controls.entries()) {
      if (controlIds.has(control.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["controls", controlIndex, "id"],
          message: `Duplicate control operation in one layer: ${control.id}`,
        });
      }
      controlIds.add(control.id);

      for (const sourceRef of control.sourceRefs) {
        if (!sourceIds.has(sourceRef)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["controls", controlIndex, "sourceRefs"],
            message: `Unknown sourceRef ${sourceRef} in layer ${layer.id}`,
          });
        }
      }

      if (control.mode === "exclude") continue;

      const requirementIds = new Set<string>();
      for (const [requirementIndex, requirement] of control.evidenceRequirements.entries()) {
        if (requirementIds.has(requirement.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["controls", controlIndex, "evidenceRequirements", requirementIndex, "id"],
            message: `Duplicate evidence requirement id: ${requirement.id}`,
          });
        }
        requirementIds.add(requirement.id);
      }

      const evaluatorIds = new Set<string>();
      for (const [bindingIndex, binding] of control.evaluatorBindings.entries()) {
        if (evaluatorIds.has(binding.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["controls", controlIndex, "evaluatorBindings", bindingIndex, "id"],
            message: `Duplicate evaluator binding id: ${binding.id}`,
          });
        }
        evaluatorIds.add(binding.id);
        for (const requirementId of binding.evidenceRequirementIds) {
          if (!requirementIds.has(requirementId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["controls", controlIndex, "evaluatorBindings", bindingIndex, "evidenceRequirementIds"],
              message: `Evaluator ${binding.id} references unknown evidence requirement ${requirementId}`,
            });
          }
        }
      }
    }
  });
export type RegimeLayer = z.infer<typeof RegimeLayerSchema>;

export const RegimeCompilationInputSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string().trim().min(1).max(500),
  layers: z.array(RegimeLayerSchema).min(1),
});
export type RegimeCompilationInput = z.input<typeof RegimeCompilationInputSchema>;

export const EffectiveControlProvenanceSchema = z.object({
  layerId: StableIdSchema,
  layerVersion: z.string().min(1),
  precedence: z.number().int().nonnegative(),
  operation: z.enum(["define", "override", "exclude"]),
  sourceRefs: z.array(StableIdSchema),
});
export type EffectiveControlProvenance = z.infer<typeof EffectiveControlProvenanceSchema>;

export const EffectiveRegimeControlSchema = z.object({
  id: StableIdSchema,
  title: z.string().trim().min(1).max(500),
  statement: z.string().trim().min(1).max(8_000).optional(),
  applicability: z.enum(["required", "conditional", "excluded"]),
  sourceRefs: z.array(StableIdSchema),
  assessmentObjectiveIds: z.array(StableIdSchema),
  evidenceRequirements: z.array(EvidenceRequirementSchema),
  evaluatorBindings: z.array(RegimeEvaluatorBindingSchema),
  parameters: z.record(z.unknown()),
  decision: RegimeDecisionRuleSchema,
  effectiveLayerId: StableIdSchema,
  effectivePrecedence: z.number().int().nonnegative(),
  provenance: z.array(EffectiveControlProvenanceSchema).min(1),
});
export type EffectiveRegimeControl = z.infer<typeof EffectiveRegimeControlSchema>;

export const EffectiveRegimeLayerSchema = z.object({
  id: StableIdSchema,
  title: z.string().min(1),
  version: z.string().min(1),
  precedence: z.number().int().nonnegative(),
  sha256: Sha256HexSchema,
});

export const EffectiveRegimeSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string().min(1),
  layers: z.array(EffectiveRegimeLayerSchema).min(1),
  controls: z.array(EffectiveRegimeControlSchema),
  sha256: Sha256HexSchema,
});
export type EffectiveRegime = z.infer<typeof EffectiveRegimeSchema>;

export class RegimeCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegimeCompileError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

export function canonicalRegimeJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeEvidenceRequirement(requirement: EvidenceRequirement): EvidenceRequirement {
  return {
    ...requirement,
    producerCapabilities: [...requirement.producerCapabilities].sort(),
    mediaTypes: [...requirement.mediaTypes].sort(),
  };
}

function normalizeEvaluatorBinding(binding: RegimeEvaluatorBinding): RegimeEvaluatorBinding {
  return {
    ...binding,
    evidenceRequirementIds: [...binding.evidenceRequirementIds].sort(),
  };
}

function normalizeControl(control: RegimeControl): RegimeControl {
  if (control.mode === "exclude") {
    return { ...control, sourceRefs: [...control.sourceRefs].sort() };
  }

  return {
    ...control,
    sourceRefs: [...control.sourceRefs].sort(),
    assessmentObjectiveIds: [...control.assessmentObjectiveIds].sort(),
    evidenceRequirements: [...control.evidenceRequirements]
      .map(normalizeEvidenceRequirement)
      .sort((a, b) => a.id.localeCompare(b.id)),
    evaluatorBindings: [...control.evaluatorBindings]
      .map(normalizeEvaluatorBinding)
      .sort((a, b) => a.id.localeCompare(b.id)),
    decision: { ...control.decision, gateOn: [...control.decision.gateOn].sort() },
  };
}

function normalizeLayer(layer: RegimeLayer): RegimeLayer {
  return {
    ...layer,
    authority: {
      ...layer.authority,
      sources: [...layer.authority.sources].sort((a, b) => a.id.localeCompare(b.id)),
    },
    appliesTo: [...layer.appliesTo].sort(),
    imports: [...layer.imports].sort(),
    controls: [...layer.controls].map(normalizeControl).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function provenanceFor(
  layer: RegimeLayer,
  control: RegimeControl,
): EffectiveControlProvenance {
  return {
    layerId: layer.id,
    layerVersion: layer.version,
    precedence: layer.precedence,
    operation: control.mode,
    sourceRefs: [...control.sourceRefs],
  };
}

function effectiveFromDefinition(
  layer: RegimeLayer,
  control: RegimeControlDefinition | RegimeControlOverride,
  provenance: EffectiveControlProvenance[],
): EffectiveRegimeControl {
  return {
    id: control.id,
    title: control.title,
    statement: control.statement,
    applicability: control.applicability,
    sourceRefs: [...control.sourceRefs],
    assessmentObjectiveIds: [...control.assessmentObjectiveIds],
    evidenceRequirements: [...control.evidenceRequirements],
    evaluatorBindings: [...control.evaluatorBindings],
    parameters: control.parameters,
    decision: control.decision,
    effectiveLayerId: layer.id,
    effectivePrecedence: layer.precedence,
    provenance,
  };
}

function assertLayerGraph(layers: RegimeLayer[]): void {
  const byId = new Map<string, RegimeLayer>();
  for (const layer of layers) {
    if (byId.has(layer.id)) throw new RegimeCompileError(`Duplicate regime layer id: ${layer.id}`);
    byId.set(layer.id, layer);
  }

  for (const layer of layers) {
    for (const importedId of layer.imports) {
      const imported = byId.get(importedId);
      if (!imported) {
        throw new RegimeCompileError(`Regime layer ${layer.id} imports missing layer ${importedId}`);
      }
      if (imported.precedence >= layer.precedence) {
        throw new RegimeCompileError(
          `Regime layer ${layer.id} must have higher precedence than imported layer ${importedId}`,
        );
      }
    }
  }
}

export async function compileRegime(input: RegimeCompilationInput): Promise<EffectiveRegime> {
  const parsed = RegimeCompilationInputSchema.parse(input);
  const layers = parsed.layers
    .map(normalizeLayer)
    .sort((a, b) => a.precedence - b.precedence || a.id.localeCompare(b.id));

  assertLayerGraph(layers);

  const controls = new Map<string, EffectiveRegimeControl>();

  for (const layer of layers) {
    for (const operation of layer.controls) {
      const existing = controls.get(operation.id);

      if (operation.mode === "define") {
        if (existing) {
          throw new RegimeCompileError(
            `Control ${operation.id} is already defined; layer ${layer.id} must use an explicit override or exclusion`,
          );
        }
        controls.set(
          operation.id,
          effectiveFromDefinition(layer, operation, [provenanceFor(layer, operation)]),
        );
        continue;
      }

      if (!existing) {
        throw new RegimeCompileError(
          `Control ${operation.id} cannot be ${operation.mode}d by layer ${layer.id} before it is defined`,
        );
      }
      if (layer.precedence <= existing.effectivePrecedence) {
        throw new RegimeCompileError(
          `Control ${operation.id} ${operation.mode} in layer ${layer.id} does not have higher precedence`,
        );
      }

      const provenance = [...existing.provenance, provenanceFor(layer, operation)];

      if (operation.mode === "override") {
        controls.set(operation.id, effectiveFromDefinition(layer, operation, provenance));
        continue;
      }

      controls.set(operation.id, {
        ...existing,
        applicability: "excluded",
        sourceRefs: [...new Set([...existing.sourceRefs, ...operation.sourceRefs])].sort(),
        evidenceRequirements: [],
        evaluatorBindings: [],
        effectiveLayerId: layer.id,
        effectivePrecedence: layer.precedence,
        provenance,
      });
    }
  }

  const layerSummaries = await Promise.all(
    layers.map(async (layer) => ({
      id: layer.id,
      title: layer.title,
      version: layer.version,
      precedence: layer.precedence,
      sha256: await sha256Hex(canonicalRegimeJson(layer)),
    })),
  );

  const unsigned = {
    schemaVersion: 1 as const,
    id: parsed.id,
    title: parsed.title,
    layers: layerSummaries,
    controls: [...controls.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const sha256 = await sha256Hex(canonicalRegimeJson(unsigned));
  return EffectiveRegimeSchema.parse({ ...unsigned, sha256 });
}

export const EvidenceBindingSchema = z.object({
  requirementId: StableIdSchema,
  evidenceIds: z.array(StableIdSchema).min(1),
});
export type EvidenceBinding = z.infer<typeof EvidenceBindingSchema>;

export type EvidenceReadiness = {
  status: "ready" | "needs_review" | "not_applicable";
  satisfiedRequirementIds: string[];
  missingRequirementIds: string[];
};

export function checkControlEvidenceReadiness(
  regime: EffectiveRegime,
  controlId: string,
  bindings: EvidenceBinding[],
): EvidenceReadiness {
  const control = regime.controls.find((candidate) => candidate.id === controlId);
  if (!control) throw new RegimeCompileError(`Unknown control ${controlId} in regime ${regime.id}`);
  if (control.applicability === "excluded") {
    return { status: "not_applicable", satisfiedRequirementIds: [], missingRequirementIds: [] };
  }

  const knownRequirements = new Map(control.evidenceRequirements.map((requirement) => [requirement.id, requirement]));
  const supplied = new Set<string>();
  for (const rawBinding of bindings) {
    const binding = EvidenceBindingSchema.parse(rawBinding);
    if (!knownRequirements.has(binding.requirementId)) {
      throw new RegimeCompileError(
        `Evidence binding ${binding.requirementId} does not belong to control ${controlId}`,
      );
    }
    supplied.add(binding.requirementId);
  }

  const required = control.evidenceRequirements.filter((requirement) => requirement.required);
  const missingRequirementIds = required
    .filter((requirement) => !supplied.has(requirement.id))
    .map((requirement) => requirement.id)
    .sort();
  const satisfiedRequirementIds = [...supplied].sort();

  return {
    status: missingRequirementIds.length === 0 ? "ready" : "needs_review",
    satisfiedRequirementIds,
    missingRequirementIds,
  };
}

export const ControlAssertionSchema = z.object({
  schemaVersion: z.literal(1),
  regimeId: StableIdSchema,
  regimeSha256: Sha256HexSchema,
  controlId: StableIdSchema,
  status: AssertionStatusSchema,
  evaluatorId: StableIdSchema,
  evidence: z.array(EvidenceBindingSchema).default([]),
  rationale: z.string().trim().min(1).max(8_000),
  observedAt: IsoDateSchema,
});
export type ControlAssertion = z.infer<typeof ControlAssertionSchema>;

export function validateControlAssertion(
  regime: EffectiveRegime,
  assertionInput: ControlAssertion,
): ControlAssertion {
  const assertion = ControlAssertionSchema.parse(assertionInput);
  if (assertion.regimeId !== regime.id || assertion.regimeSha256 !== regime.sha256) {
    throw new RegimeCompileError(
      `Assertion for control ${assertion.controlId} is not bound to effective regime ${regime.id}@${regime.sha256}`,
    );
  }

  const control = regime.controls.find((candidate) => candidate.id === assertion.controlId);
  if (!control) {
    throw new RegimeCompileError(`Assertion references unknown control ${assertion.controlId}`);
  }

  const readiness = checkControlEvidenceReadiness(regime, control.id, assertion.evidence);
  if (assertion.status === "pass" && readiness.status !== "ready") {
    throw new RegimeCompileError(
      `Control ${control.id} cannot pass with missing evidence requirements: ${readiness.missingRequirementIds.join(", ")}`,
    );
  }
  if (assertion.status === "not_applicable" && control.applicability === "required") {
    throw new RegimeCompileError(`Required control ${control.id} cannot be asserted not_applicable`);
  }
  if (control.applicability === "excluded" && assertion.status !== "not_applicable") {
    throw new RegimeCompileError(`Excluded control ${control.id} can only be asserted not_applicable`);
  }

  return assertion;
}
