import { createHash } from "node:crypto";
import { z } from "zod";

const StableIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const ExperimentPhaseSchema = z.enum(["setup", "exercise"]);
export type ExperimentPhase = z.infer<typeof ExperimentPhaseSchema>;

export const CapabilityProviderSchema = z.object({
  id: StableIdSchema,
  capability: StableIdSchema,
  adapter: StableIdSchema,
  allowedCommands: z.array(StableIdSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type CapabilityProvider = z.infer<typeof CapabilityProviderSchema>;

export const ExperimentCommandSchema = z.object({
  capability: StableIdSchema,
  name: StableIdSchema,
  parameters: z.record(z.unknown()).default({}),
});
export type ExperimentCommand = z.infer<typeof ExperimentCommandSchema>;

export const ExpectedEvidenceSchema = z.object({
  id: StableIdSchema,
  kind: StableIdSchema,
  description: z.string().min(1).max(1_000),
});
export type ExpectedEvidence = z.infer<typeof ExpectedEvidenceSchema>;

export const ExperimentTaskSchema = z.object({
  id: StableIdSchema,
  phase: ExperimentPhaseSchema,
  dependsOn: z.array(StableIdSchema).default([]),
  commands: z.array(ExperimentCommandSchema).default([]),
  expectedEvidence: z.array(ExpectedEvidenceSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type ExperimentTask = z.infer<typeof ExperimentTaskSchema>;

export const ExperimentDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string().min(1).max(240),
  regimeId: StableIdSchema.optional(),
  regimeSha256: Sha256Schema.optional(),
  tasks: z.array(ExperimentTaskSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type ExperimentDefinition = z.infer<typeof ExperimentDefinitionSchema>;

export const ExperimentCompileInputSchema = z.object({
  definition: ExperimentDefinitionSchema,
  providers: z.array(CapabilityProviderSchema),
  providerPreferences: z.record(StableIdSchema).default({}),
});
export type ExperimentCompileInput = z.input<typeof ExperimentCompileInputSchema>;

export const CapabilityBindingSchema = z.object({
  taskId: StableIdSchema,
  commandIndex: z.number().int().nonnegative(),
  capability: StableIdSchema,
  command: StableIdSchema,
  providerId: StableIdSchema,
  adapter: StableIdSchema,
});
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;

export const ExperimentEdgeSchema = z.object({
  from: StableIdSchema,
  to: StableIdSchema,
  kind: z.literal("depends_on"),
});

export const CompiledExperimentSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  title: z.string(),
  regimeId: StableIdSchema.optional(),
  regimeSha256: Sha256Schema.optional(),
  orderedTasks: z.array(ExperimentTaskSchema),
  edges: z.array(ExperimentEdgeSchema),
  capabilityBindings: z.array(CapabilityBindingSchema),
  baselineSeal: z.object({
    setupTaskIds: z.array(StableIdSchema),
    sha256: Sha256Schema,
  }),
  sha256: Sha256Schema,
  metadata: z.record(z.unknown()),
});
export type CompiledExperiment = z.infer<typeof CompiledExperimentSchema>;

export class ExperimentCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentCompileError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assertUnique<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) throw new ExperimentCompileError(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function resolveProvider(
  capability: string,
  command: string,
  providers: CapabilityProvider[],
  preferences: Record<string, string>,
): CapabilityProvider {
  const candidates = providers
    .filter((provider) => provider.capability === capability)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length === 0) {
    throw new ExperimentCompileError(`No provider supplies capability ${capability}`);
  }

  const preferredId = preferences[capability];
  let provider: CapabilityProvider;
  if (preferredId) {
    const preferred = candidates.find((candidate) => candidate.id === preferredId);
    if (!preferred) {
      throw new ExperimentCompileError(
        `Preferred provider ${preferredId} does not supply capability ${capability}`,
      );
    }
    provider = preferred;
  } else if (candidates.length === 1) {
    provider = candidates[0];
  } else {
    throw new ExperimentCompileError(
      `Capability ${capability} has multiple providers (${candidates.map((item) => item.id).join(", ")}); select one explicitly`,
    );
  }

  if (!provider.allowedCommands.includes(command)) {
    throw new ExperimentCompileError(
      `Provider ${provider.id} does not authorize command ${command} for capability ${capability}`,
    );
  }

  return provider;
}

function topologicalOrder(tasks: ExperimentTask[]): ExperimentTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const dependents = new Map(tasks.map((task) => [task.id, [] as string[]]));

  for (const task of tasks) {
    const uniqueDependencies = [...new Set(task.dependsOn)];
    if (uniqueDependencies.length !== task.dependsOn.length) {
      throw new ExperimentCompileError(`Task ${task.id} contains duplicate dependencies`);
    }

    for (const dependencyId of uniqueDependencies) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new ExperimentCompileError(`Task ${task.id} depends on missing task ${dependencyId}`);
      }
      if (task.id === dependencyId) {
        throw new ExperimentCompileError(`Task ${task.id} cannot depend on itself`);
      }
      if (task.phase === "setup" && dependency.phase === "exercise") {
        throw new ExperimentCompileError(
          `Setup task ${task.id} cannot depend on exercise task ${dependencyId}; T=0 is a one-way boundary`,
        );
      }
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      dependents.get(dependencyId)?.push(task.id);
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort();
  const ordered: ExperimentTask[] = [];

  while (ready.length > 0) {
    const nextId = ready.shift()!;
    ordered.push(byId.get(nextId)!);
    for (const dependentId of [...(dependents.get(nextId) ?? [])].sort()) {
      const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }

  if (ordered.length !== tasks.length) {
    throw new ExperimentCompileError("Experiment task graph contains a dependency cycle");
  }

  return ordered;
}

function normalizeTask(task: ExperimentTask): ExperimentTask {
  return {
    ...task,
    dependsOn: [...task.dependsOn].sort(),
    commands: task.commands.map((command) => ({
      ...command,
      parameters: canonicalize(command.parameters) as Record<string, unknown>,
    })),
    expectedEvidence: [...task.expectedEvidence].sort((a, b) => a.id.localeCompare(b.id)),
    metadata: canonicalize(task.metadata) as Record<string, unknown>,
  };
}

export function compileExperiment(input: ExperimentCompileInput): CompiledExperiment {
  const parsed = ExperimentCompileInputSchema.parse(input);
  const definition = parsed.definition;

  if ((definition.regimeId && !definition.regimeSha256) || (!definition.regimeId && definition.regimeSha256)) {
    throw new ExperimentCompileError("regimeId and regimeSha256 must be supplied together");
  }

  assertUnique(definition.tasks, (task) => task.id, "task id");
  assertUnique(parsed.providers, (provider) => provider.id, "provider id");

  const normalizedTasks = definition.tasks.map(normalizeTask);
  for (const task of normalizedTasks) {
    assertUnique(task.expectedEvidence, (item) => item.id, `evidence id in task ${task.id}`);
  }

  const orderedTasks = topologicalOrder(normalizedTasks);
  const edges = orderedTasks
    .flatMap((task) => task.dependsOn.map((dependencyId) => ({ from: dependencyId, to: task.id, kind: "depends_on" as const })))
    .sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`));

  const capabilityBindings: CapabilityBinding[] = [];
  for (const task of orderedTasks) {
    task.commands.forEach((command, commandIndex) => {
      const provider = resolveProvider(
        command.capability,
        command.name,
        parsed.providers,
        parsed.providerPreferences,
      );
      capabilityBindings.push({
        taskId: task.id,
        commandIndex,
        capability: command.capability,
        command: command.name,
        providerId: provider.id,
        adapter: provider.adapter,
      });
    });
  }

  const setupTaskIds = orderedTasks.filter((task) => task.phase === "setup").map((task) => task.id);
  const setupBindings = capabilityBindings.filter((binding) => setupTaskIds.includes(binding.taskId));
  const baselineSeal = {
    setupTaskIds,
    sha256: digest({
      experimentId: definition.id,
      regimeId: definition.regimeId,
      regimeSha256: definition.regimeSha256,
      setupTasks: orderedTasks.filter((task) => task.phase === "setup"),
      setupBindings,
    }),
  };

  const withoutDigest = {
    schemaVersion: 1 as const,
    id: definition.id,
    title: definition.title,
    regimeId: definition.regimeId,
    regimeSha256: definition.regimeSha256,
    orderedTasks,
    edges,
    capabilityBindings,
    baselineSeal,
    metadata: canonicalize(definition.metadata) as Record<string, unknown>,
  };

  return CompiledExperimentSchema.parse({
    ...withoutDigest,
    sha256: digest(withoutDigest),
  });
}
