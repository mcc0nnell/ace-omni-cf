import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CapabilityProviderSchema,
  CompiledExperimentSchema,
  ExperimentTaskSchema,
  compileExperiment,
  type CapabilityProvider,
  type CompiledExperiment,
  type ExperimentTask,
} from "./experiment-ir.js";

const StableIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const StateArtifactSchema = z.object({
  uri: z.string().min(1).max(2_000),
  sha256: Sha256Schema,
  mediaType: z.string().min(1).max(200),
  metadata: z.record(z.unknown()).default({}),
});
export type StateArtifact = z.infer<typeof StateArtifactSchema>;

export const BaselineCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  experimentId: StableIdSchema,
  experimentSha256: Sha256Schema,
  baselineSha256: Sha256Schema,
  boundary: z.literal("baseline"),
  stateArtifact: StateArtifactSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type BaselineCheckpoint = z.infer<typeof BaselineCheckpointSchema>;

export const BaselineCheckpointInputSchema = z.object({
  id: StableIdSchema,
  stateArtifact: StateArtifactSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type BaselineCheckpointInput = z.input<typeof BaselineCheckpointInputSchema>;

export const BranchVariationSchema = z.object({
  taskId: StableIdSchema,
  commandIndex: z.number().int().nonnegative(),
  parameters: z.record(z.unknown()),
});
export type BranchVariation = z.infer<typeof BranchVariationSchema>;

export const ExperimentBranchDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string().min(1).max(240),
  checkpointId: StableIdSchema,
  parentBranchSha256: Sha256Schema.optional(),
  variations: z.array(BranchVariationSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type ExperimentBranchDefinition = z.infer<typeof ExperimentBranchDefinitionSchema>;

export const ExperimentBranchCompileInputSchema = z.object({
  parent: CompiledExperimentSchema,
  checkpoint: BaselineCheckpointSchema,
  branch: ExperimentBranchDefinitionSchema,
  providers: z.array(CapabilityProviderSchema),
});
export type ExperimentBranchCompileInput = z.input<typeof ExperimentBranchCompileInputSchema>;

export const CompiledExperimentBranchSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string(),
  lineage: z.object({
    parentExperimentSha256: Sha256Schema,
    parentBranchSha256: Sha256Schema.optional(),
    checkpointId: StableIdSchema,
    baselineSha256: Sha256Schema,
    stateArtifactSha256: Sha256Schema,
  }),
  variations: z.array(BranchVariationSchema),
  experiment: CompiledExperimentSchema,
  sha256: Sha256Schema,
  metadata: z.record(z.unknown()),
});
export type CompiledExperimentBranch = z.infer<typeof CompiledExperimentBranchSchema>;

export class StateBranchCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateBranchCompileError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function normalizeVariation(variation: BranchVariation): BranchVariation {
  return {
    ...variation,
    parameters: canonicalize(variation.parameters) as Record<string, unknown>,
  };
}

function providerPreferencesFromParent(parent: CompiledExperiment): Record<string, string> {
  const preferences: Record<string, string> = {};
  for (const binding of parent.capabilityBindings) {
    const existing = preferences[binding.capability];
    if (existing && existing !== binding.providerId) {
      throw new StateBranchCompileError(
        `Parent experiment binds capability ${binding.capability} to multiple providers; V1 branch replay requires one pinned provider per capability`,
      );
    }
    preferences[binding.capability] = binding.providerId;
  }
  return preferences;
}

function assertProviderSetSupportsParent(
  parent: CompiledExperiment,
  providers: CapabilityProvider[],
): void {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  for (const binding of parent.capabilityBindings) {
    const provider = providerById.get(binding.providerId);
    if (!provider) {
      throw new StateBranchCompileError(
        `Branch replay is missing pinned provider ${binding.providerId} for capability ${binding.capability}`,
      );
    }
    if (provider.capability !== binding.capability || provider.adapter !== binding.adapter) {
      throw new StateBranchCompileError(
        `Pinned provider ${binding.providerId} no longer matches parent capability/adapter binding`,
      );
    }
    if (!provider.allowedCommands.includes(binding.command)) {
      throw new StateBranchCompileError(
        `Pinned provider ${binding.providerId} no longer authorizes parent command ${binding.command}`,
      );
    }
  }
}

export function bindBaselineCheckpoint(
  parentInput: CompiledExperiment,
  input: BaselineCheckpointInput,
): BaselineCheckpoint {
  const parent = CompiledExperimentSchema.parse(parentInput);
  const parsed = BaselineCheckpointInputSchema.parse(input);
  return BaselineCheckpointSchema.parse({
    schemaVersion: 1,
    id: parsed.id,
    experimentId: parent.id,
    experimentSha256: parent.sha256,
    baselineSha256: parent.baselineSeal.sha256,
    boundary: "baseline",
    stateArtifact: parsed.stateArtifact,
    metadata: canonicalize(parsed.metadata),
  });
}

function assertCheckpointMatchesParent(
  parent: CompiledExperiment,
  checkpoint: BaselineCheckpoint,
): void {
  if (checkpoint.experimentId !== parent.id) {
    throw new StateBranchCompileError(
      `Checkpoint ${checkpoint.id} belongs to experiment ${checkpoint.experimentId}, not ${parent.id}`,
    );
  }
  if (checkpoint.experimentSha256 !== parent.sha256) {
    throw new StateBranchCompileError(
      `Checkpoint ${checkpoint.id} does not bind to the exact parent experiment digest`,
    );
  }
  if (checkpoint.baselineSha256 !== parent.baselineSeal.sha256) {
    throw new StateBranchCompileError(
      `Checkpoint ${checkpoint.id} does not bind to the exact parent baseline seal`,
    );
  }
}

function applyVariations(
  parent: CompiledExperiment,
  variations: BranchVariation[],
): ExperimentTask[] {
  const taskById = new Map(parent.orderedTasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const replacements = new Map<string, BranchVariation>();

  for (const rawVariation of variations) {
    const variation = normalizeVariation(rawVariation);
    const key = `${variation.taskId}:${variation.commandIndex}`;
    if (seen.has(key)) {
      throw new StateBranchCompileError(`Duplicate branch variation for ${key}`);
    }
    seen.add(key);

    const task = taskById.get(variation.taskId);
    if (!task) {
      throw new StateBranchCompileError(`Branch variation targets missing task ${variation.taskId}`);
    }
    if (task.phase !== "exercise") {
      throw new StateBranchCompileError(
        `Branch variation cannot mutate setup task ${variation.taskId}; the sealed baseline is immutable`,
      );
    }
    if (!task.commands[variation.commandIndex]) {
      throw new StateBranchCompileError(
        `Branch variation targets missing command ${variation.commandIndex} in task ${variation.taskId}`,
      );
    }
    replacements.set(key, variation);
  }

  return parent.orderedTasks.map((task) =>
    ExperimentTaskSchema.parse({
      ...task,
      commands: task.commands.map((command, commandIndex) => {
        const variation = replacements.get(`${task.id}:${commandIndex}`);
        return variation ? { ...command, parameters: variation.parameters } : command;
      }),
    }),
  );
}

export function compileExperimentBranch(input: ExperimentBranchCompileInput): CompiledExperimentBranch {
  const parsed = ExperimentBranchCompileInputSchema.parse(input);
  const { parent, checkpoint, branch, providers } = parsed;

  if (branch.checkpointId !== checkpoint.id) {
    throw new StateBranchCompileError(
      `Branch ${branch.id} names checkpoint ${branch.checkpointId}, not supplied checkpoint ${checkpoint.id}`,
    );
  }

  assertCheckpointMatchesParent(parent, checkpoint);
  assertProviderSetSupportsParent(parent, providers);

  const normalizedVariations = branch.variations
    .map(normalizeVariation)
    .sort((a, b) => `${a.taskId}:${a.commandIndex}`.localeCompare(`${b.taskId}:${b.commandIndex}`));
  const tasks = applyVariations(parent, normalizedVariations);
  const providerPreferences = providerPreferencesFromParent(parent);

  const experiment = compileExperiment({
    definition: {
      schemaVersion: 1,
      id: parent.id,
      title: parent.title,
      regimeId: parent.regimeId,
      regimeSha256: parent.regimeSha256,
      tasks,
      metadata: parent.metadata,
    },
    providers,
    providerPreferences,
  });

  if (experiment.baselineSeal.sha256 !== parent.baselineSeal.sha256) {
    throw new StateBranchCompileError(
      `Branch ${branch.id} changed the sealed baseline; V1 branches may vary exercise parameters only`,
    );
  }

  const withoutDigest = {
    schemaVersion: 1 as const,
    id: branch.id,
    title: branch.title,
    lineage: {
      parentExperimentSha256: parent.sha256,
      parentBranchSha256: branch.parentBranchSha256,
      checkpointId: checkpoint.id,
      baselineSha256: checkpoint.baselineSha256,
      stateArtifactSha256: checkpoint.stateArtifact.sha256,
    },
    variations: normalizedVariations,
    experiment,
    metadata: canonicalize(branch.metadata) as Record<string, unknown>,
  };

  return CompiledExperimentBranchSchema.parse({
    ...withoutDigest,
    sha256: digest(withoutDigest),
  });
}
