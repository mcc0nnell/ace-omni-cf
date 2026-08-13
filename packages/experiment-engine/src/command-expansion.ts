import type {
  AdapterCapability,
  JsonValue,
  PlannedCommandDefinition,
} from "./emulytics";

/**
 * A higher-order experiment action that expands into ordinary Omni planned
 * commands before execution-plan compilation.
 *
 * This follows the same architectural invariant used by SF26 macros: complex
 * behavior composes the canonical command grammar rather than acquiring a
 * privileged execution path.
 */
export interface CommandSequenceStep {
  /** Optional stable step name. Falls back to the one-based step position. */
  stepId?: string;
  /** Offset relative to the sequence's scheduledOffsetMs. */
  offsetMs: number;
  adapterId: string;
  capability: AdapterCapability;
  operation: string;
  parameters?: Record<string, JsonValue>;
  seed?: number;
}

export interface CommandSequenceDefinition {
  id: string;
  scheduledOffsetMs: number;
  steps: readonly CommandSequenceStep[];
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

/**
 * Expand one higher-order sequence into the only mutation vocabulary the
 * experiment runtime understands: PlannedCommandDefinition[].
 *
 * Adapters never receive CommandSequenceDefinition. Capability checks,
 * canonical ordering, sequence assignment, seed derivation, and plan hashing
 * still happen in compileExecutionPlan().
 */
export function expandCommandSequence(
  sequence: CommandSequenceDefinition,
): PlannedCommandDefinition[] {
  assertNonNegativeInteger(sequence.scheduledOffsetMs, "sequence.scheduledOffsetMs");
  if (sequence.steps.length === 0) {
    throw new Error("command sequence must contain at least one step");
  }

  return sequence.steps.map((step, index) => {
    assertNonNegativeInteger(step.offsetMs, `sequence step ${index + 1} offsetMs`);
    const stepIdentity = step.stepId ?? String(index + 1);

    return {
      id: `${sequence.id}:${stepIdentity}`,
      adapterId: step.adapterId,
      capability: step.capability,
      scheduledOffsetMs: sequence.scheduledOffsetMs + step.offsetMs,
      operation: step.operation,
      ...(step.parameters === undefined ? {} : { parameters: step.parameters }),
      ...(step.seed === undefined ? {} : { seed: step.seed }),
    };
  });
}
