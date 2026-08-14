import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CompiledExperimentSchema,
  type CompiledExperiment,
} from "./experiment-ir";

const StableIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const SceptreProcessProviderSchema = z.enum([
  "generic-python",
  "helics",
  "powerworld",
  "simulink",
  "opendss",
  "pypower",
  "custom",
]);
export type SceptreProcessProvider = z.infer<typeof SceptreProcessProviderSchema>;

export const SceptreActionSchema = z.enum([
  "process.set",
  "cyber.inject",
  "network.set",
  "observe.snapshot",
]);
export type SceptreAction = z.infer<typeof SceptreActionSchema>;

export const PinnedSceptreArtifactSchema = z.object({
  id: StableIdSchema,
  sha256: Sha256Schema,
});
export type PinnedSceptreArtifact = z.infer<typeof PinnedSceptreArtifactSchema>;

export const SceptreCommandMappingSchema = z.object({
  omniCommand: StableIdSchema,
  action: SceptreActionSchema,
  target: StableIdSchema.optional(),
});
export type SceptreCommandMapping = z.infer<typeof SceptreCommandMappingSchema>;

export const SceptreWorldBindingInputSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  experimentSha256: Sha256Schema,
  baselineSha256: Sha256Schema,
  adapter: StableIdSchema,
  topology: PinnedSceptreArtifactSchema,
  scenario: PinnedSceptreArtifactSchema,
  processModel: z.object({
    provider: SceptreProcessProviderSchema,
    model: PinnedSceptreArtifactSchema,
  }),
  mappings: z.array(SceptreCommandMappingSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type SceptreWorldBindingInput = z.input<typeof SceptreWorldBindingInputSchema>;

export const CompiledSceptreWorldBindingSchema = SceptreWorldBindingInputSchema.extend({
  mappings: z.array(SceptreCommandMappingSchema),
  sha256: Sha256Schema,
});
export type CompiledSceptreWorldBinding = z.infer<typeof CompiledSceptreWorldBindingSchema>;

export class SceptreWorldBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceptreWorldBindingError";
  }
}

const AuthorityShapedKeys = new Set([
  "args",
  "argv",
  "binary",
  "command",
  "commands",
  "cwd",
  "env",
  "environment",
  "executable",
  "script",
  "shell",
]);

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

function assertNoAuthorityShapedMetadata(value: unknown, path = "metadata"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthorityShapedMetadata(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (AuthorityShapedKeys.has(key.toLowerCase())) {
      throw new SceptreWorldBindingError(
        `${path}.${key} is execution-authority-shaped metadata; SCEPTRE bindings may not carry shell or process launch authority`,
      );
    }
    assertNoAuthorityShapedMetadata(item, `${path}.${key}`);
  }
}

function assertUniqueMappings(mappings: SceptreCommandMapping[]): void {
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (seen.has(mapping.omniCommand)) {
      throw new SceptreWorldBindingError(
        `Duplicate SCEPTRE mapping for Omni command ${mapping.omniCommand}`,
      );
    }
    seen.add(mapping.omniCommand);
  }
}

export function compileSceptreWorldBinding(
  input: SceptreWorldBindingInput,
  experimentInput: CompiledExperiment,
): CompiledSceptreWorldBinding {
  const parsed = SceptreWorldBindingInputSchema.parse(input);
  const experiment = CompiledExperimentSchema.parse(experimentInput);

  if (parsed.experimentSha256 !== experiment.sha256) {
    throw new SceptreWorldBindingError(
      `SCEPTRE binding ${parsed.id} targets experiment ${parsed.experimentSha256}, not compiled experiment ${experiment.sha256}`,
    );
  }
  if (parsed.baselineSha256 !== experiment.baselineSeal.sha256) {
    throw new SceptreWorldBindingError(
      `SCEPTRE binding ${parsed.id} targets baseline ${parsed.baselineSha256}, not compiled baseline ${experiment.baselineSeal.sha256}`,
    );
  }

  const adapterBindings = experiment.capabilityBindings.filter(
    (binding) => binding.adapter === parsed.adapter,
  );
  if (adapterBindings.length === 0) {
    throw new SceptreWorldBindingError(
      `Experiment ${experiment.id} does not authorize adapter ${parsed.adapter}`,
    );
  }

  assertUniqueMappings(parsed.mappings);
  assertNoAuthorityShapedMetadata(parsed.metadata);

  const authorizedCommands = [...new Set(adapterBindings.map((binding) => binding.command))].sort();
  const mappedCommands = parsed.mappings.map((mapping) => mapping.omniCommand).sort();

  for (const mappedCommand of mappedCommands) {
    if (!authorizedCommands.includes(mappedCommand)) {
      throw new SceptreWorldBindingError(
        `SCEPTRE mapping for ${mappedCommand} is not authorized for adapter ${parsed.adapter}`,
      );
    }
  }

  const unmappedCommands = authorizedCommands.filter(
    (authorizedCommand) => !mappedCommands.includes(authorizedCommand),
  );
  if (unmappedCommands.length > 0) {
    throw new SceptreWorldBindingError(
      `SCEPTRE adapter ${parsed.adapter} has authorized Omni commands without explicit mappings: ${unmappedCommands.join(", ")}`,
    );
  }

  const mappings = [...parsed.mappings].sort(
    (a, b) =>
      a.omniCommand.localeCompare(b.omniCommand) ||
      a.action.localeCompare(b.action) ||
      (a.target ?? "").localeCompare(b.target ?? ""),
  );

  const withoutDigest = {
    ...parsed,
    mappings,
    metadata: canonicalize(parsed.metadata) as Record<string, unknown>,
  };

  return CompiledSceptreWorldBindingSchema.parse({
    ...withoutDigest,
    sha256: digest(withoutDigest),
  });
}
