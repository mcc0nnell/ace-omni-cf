/// <reference lib="dom" />

export type AdapterCapability =
  | "communications"
  | "network"
  | "sensor"
  | "cyber"
  | "simulation"
  | "human"
  | "storage"
  | "custom";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface AdapterDescriptor {
  id: string;
  kind: string;
  protocolVersion: 1;
  capabilities: AdapterCapability[];
  metadata?: Record<string, JsonValue>;
}

export interface ExperimentRun {
  version: 1;
  runId: string;
  experimentId: string;
  experimentVersionId: string;
  configVersion: number;
  seed: number;
  issuedAt: string;
  adapters: AdapterDescriptor[];
}

export interface PlannedCommandDefinition {
  id: string;
  adapterId: string;
  capability: AdapterCapability;
  scheduledOffsetMs: number;
  operation: string;
  parameters?: Record<string, JsonValue>;
  seed?: number;
}

export interface ExecutionCommand {
  version: 1;
  id: string;
  runId: string;
  adapterId: string;
  capability: AdapterCapability;
  sequence: number;
  scheduledOffsetMs: number;
  operation: string;
  parameters: Record<string, JsonValue>;
  seed: number;
}

export interface ExecutionPlan {
  version: 1;
  planRevision: number;
  run: ExperimentRun;
  commands: ExecutionCommand[];
}

export interface ObservationEnvelope {
  version: 1;
  observationId: string;
  runId: string;
  adapterId: string;
  sourceId: string;
  observedAt: string;
  payload: JsonValue;
  payloadSha256: string;
}

export interface ObservationInput {
  observationId: string;
  runId: string;
  adapterId: string;
  sourceId: string;
  observedAt: string;
  payload: JsonValue;
}

export interface SystemUnderTestAdapter {
  readonly descriptor: AdapterDescriptor;
  prepare(run: ExperimentRun): Promise<void>;
  start(plan: ExecutionPlan): Promise<void>;
  command(command: ExecutionCommand): Promise<void>;
  observe(): AsyncIterable<ObservationEnvelope>;
  stop(reason?: string): Promise<void>;
}

const StableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function assertStableId(value: string, label: string): void {
  if (!StableIdPattern.test(value)) {
    throw new Error(`${label} must be a stable identifier`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertSeed(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`${label} must be an integer between 0 and 2147483647`);
  }
}

function assertIsoDate(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.includes("T")) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
}

function assertJsonValue(value: JsonValue, path = "value"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new Error(`${path}.${key} is undefined`);
      }
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} is not JSON serializable`);
}

export function canonicalJson(value: JsonValue): string {
  assertJsonValue(value);
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Validated JSON value could not be serialized");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export async function sha256Canonical(value: JsonValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeDescriptor(descriptor: AdapterDescriptor): AdapterDescriptor {
  assertStableId(descriptor.id, "adapter.id");
  assertStableId(descriptor.kind, "adapter.kind");
  if (descriptor.protocolVersion !== 1) {
    throw new Error("adapter.protocolVersion must be 1");
  }
  const capabilities = [...descriptor.capabilities].sort();
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error(`adapter ${descriptor.id} declares duplicate capabilities`);
  }
  if (descriptor.metadata) {
    assertJsonValue(descriptor.metadata);
  }
  return {
    ...descriptor,
    capabilities,
    metadata: descriptor.metadata ? cloneJson(descriptor.metadata) : undefined,
  };
}

export function normalizeExperimentRun(run: ExperimentRun): ExperimentRun {
  if (run.version !== 1) {
    throw new Error("run.version must be 1");
  }
  assertStableId(run.runId, "run.runId");
  assertStableId(run.experimentId, "run.experimentId");
  assertStableId(run.experimentVersionId, "run.experimentVersionId");
  assertPositiveInteger(run.configVersion, "run.configVersion");
  assertSeed(run.seed, "run.seed");
  assertIsoDate(run.issuedAt, "run.issuedAt");

  const adapters = run.adapters.map(normalizeDescriptor).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
    throw new Error("run adapters must have unique ids");
  }

  return { ...run, adapters };
}

function deriveCommandSeed(runSeed: number, commandId: string): number {
  let hash = (2_166_136_261 ^ runSeed) >>> 0;
  for (let index = 0; index < commandId.length; index += 1) {
    hash ^= commandId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash & 0x7fffffff;
}

export function compileExecutionPlan(input: {
  run: ExperimentRun;
  planRevision: number;
  commands: PlannedCommandDefinition[];
}): ExecutionPlan {
  const run = normalizeExperimentRun(input.run);
  assertPositiveInteger(input.planRevision, "planRevision");

  const adaptersById = new Map(
    run.adapters.map((adapter) => [adapter.id, adapter] as const),
  );
  const commandIds = new Set<string>();

  const normalized = input.commands.map((definition) => {
    assertStableId(definition.id, "command.id");
    assertStableId(definition.adapterId, "command.adapterId");
    assertStableId(definition.operation, "command.operation");
    if (!Number.isInteger(definition.scheduledOffsetMs) || definition.scheduledOffsetMs < 0) {
      throw new Error(`command ${definition.id} has an invalid scheduledOffsetMs`);
    }
    if (commandIds.has(definition.id)) {
      throw new Error(`duplicate command id ${definition.id}`);
    }
    commandIds.add(definition.id);

    const adapter = adaptersById.get(definition.adapterId);
    if (!adapter) {
      throw new Error(`command ${definition.id} targets unknown adapter ${definition.adapterId}`);
    }
    if (!adapter.capabilities.includes(definition.capability)) {
      throw new Error(
        `command ${definition.id} requires ${definition.capability}, which adapter ${definition.adapterId} does not declare`,
      );
    }
    const parameters = cloneJson(definition.parameters ?? {});
    const seed = definition.seed ?? deriveCommandSeed(run.seed, definition.id);
    assertSeed(seed, `command ${definition.id} seed`);

    return {
      version: 1 as const,
      id: definition.id,
      runId: run.runId,
      adapterId: definition.adapterId,
      capability: definition.capability,
      sequence: 0,
      scheduledOffsetMs: definition.scheduledOffsetMs,
      operation: definition.operation,
      parameters,
      seed,
    };
  });

  normalized.sort(
    (left, right) =>
      left.scheduledOffsetMs - right.scheduledOffsetMs ||
      left.adapterId.localeCompare(right.adapterId) ||
      left.id.localeCompare(right.id),
  );

  const commands = normalized.map((command, index) => ({ ...command, sequence: index + 1 }));
  return { version: 1, planRevision: input.planRevision, run, commands };
}

export async function digestExecutionPlan(plan: ExecutionPlan): Promise<string> {
  return sha256Canonical(plan as unknown as JsonValue);
}

export async function createObservationEnvelope(input: ObservationInput): Promise<ObservationEnvelope> {
  assertStableId(input.observationId, "observation.observationId");
  assertStableId(input.runId, "observation.runId");
  assertStableId(input.adapterId, "observation.adapterId");
  assertStableId(input.sourceId, "observation.sourceId");
  assertIsoDate(input.observedAt, "observation.observedAt");
  assertJsonValue(input.payload, "observation.payload");

  const payload = cloneJson(input.payload);
  return {
    version: 1,
    ...input,
    payload,
    payloadSha256: await sha256Canonical(payload),
  };
}

export function observationReplayKey(observation: ObservationEnvelope): string {
  return `${observation.runId}:${observation.adapterId}:${observation.sourceId}:${observation.observationId}`;
}

export function deduplicateObservationEnvelopes(
  observations: ObservationEnvelope[],
): ObservationEnvelope[] {
  const accepted = new Map<string, ObservationEnvelope>();
  for (const observation of observations) {
    const key = observationReplayKey(observation);
    const existing = accepted.get(key);
    if (!existing) {
      accepted.set(key, observation);
      continue;
    }
    if (
      existing.observedAt !== observation.observedAt ||
      existing.payloadSha256 !== observation.payloadSha256
    ) {
      throw new Error(`conflicting replay for observation ${key}`);
    }
  }
  return [...accepted.values()];
}

export class SyntheticLoopbackAdapter implements SystemUnderTestAdapter {
  readonly descriptor: AdapterDescriptor;
  private state: "new" | "prepared" | "started" | "stopped" = "new";
  private runId: string | null = null;
  private readonly observations: ObservationEnvelope[] = [];

  constructor(
    id = "synthetic-loopback",
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.descriptor = {
      id,
      kind: "synthetic-loopback",
      protocolVersion: 1,
      capabilities: ["custom", "simulation"],
    };
  }

  async prepare(run: ExperimentRun): Promise<void> {
    if (this.state !== "new") {
      throw new Error(`adapter cannot prepare from state ${this.state}`);
    }
    const normalized = normalizeExperimentRun(run);
    if (!normalized.adapters.some((adapter) => adapter.id === this.descriptor.id)) {
      throw new Error(`run does not declare adapter ${this.descriptor.id}`);
    }
    this.runId = normalized.runId;
    this.state = "prepared";
  }

  async start(plan: ExecutionPlan): Promise<void> {
    if (this.state !== "prepared" || this.runId !== plan.run.runId) {
      throw new Error("adapter must be prepared for this run before start");
    }
    this.state = "started";
  }

  async command(command: ExecutionCommand): Promise<void> {
    if (this.state !== "started" || !this.runId) {
      throw new Error("adapter must be started before commands are accepted");
    }
    if (command.runId !== this.runId || command.adapterId !== this.descriptor.id) {
      throw new Error("command does not belong to this adapter run");
    }

    const payload: JsonValue = {
      operation: command.operation,
      parameters: command.parameters,
      scheduledOffsetMs: command.scheduledOffsetMs,
      seed: command.seed,
      sequence: command.sequence,
    };
    this.observations.push(
      await createObservationEnvelope({
        observationId: `command:${command.id}`,
        runId: command.runId,
        adapterId: this.descriptor.id,
        sourceId: "loopback",
        observedAt: this.clock(),
        payload,
      }),
    );
  }

  async *observe(): AsyncIterable<ObservationEnvelope> {
    while (this.observations.length > 0) {
      const observation = this.observations.shift();
      if (observation) {
        yield observation;
      }
    }
  }

  async stop(_reason?: string): Promise<void> {
    if (this.state === "new") {
      throw new Error("adapter cannot stop before prepare");
    }
    this.state = "stopped";
  }
}
