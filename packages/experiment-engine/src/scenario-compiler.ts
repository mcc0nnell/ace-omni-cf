import { expandCommandSequence } from "./command-expansion";
import {
  compileExecutionPlan,
  type ExecutionPlan,
  type ExperimentRun,
  type PlannedCommandDefinition,
} from "./emulytics";
import type { ScenarioScript } from "./scenario-ast";
import type { ScenarioActionRegistry } from "./scenario-registry";

const StableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function assertStableId(value: string, label: string): void {
  if (!StableIdPattern.test(value)) {
    throw new Error(`${label} must be a stable identifier`);
  }
}

/**
 * Compile a typed scenario AST into Omni's canonical primitive command
 * vocabulary.
 *
 * The separation mirrors the useful part of TalkPipe/ChatterLang's
 * parse -> intermediate representation -> registered component compilation
 * architecture, while retaining Omni's stricter execution boundary: registry
 * entries only expand intent; adapters never receive scenario nodes.
 */
export function compileScenarioCommands(
  script: ScenarioScript,
  registry: ScenarioActionRegistry,
): PlannedCommandDefinition[] {
  if (script.version !== 1) {
    throw new Error("scenario.version must be 1");
  }
  assertStableId(script.id, "scenario.id");
  if (script.actions.length === 0) {
    throw new Error("scenario must contain at least one action");
  }

  const actionIds = new Set<string>();
  const commands: PlannedCommandDefinition[] = [];

  for (const action of script.actions) {
    if (action.kind !== "action") {
      throw new Error("unsupported scenario node kind");
    }
    assertStableId(action.id, "scenario action id");
    if (actionIds.has(action.id)) {
      throw new Error(`duplicate scenario action id ${action.id}`);
    }
    actionIds.add(action.id);
    if (!Number.isInteger(action.scheduledOffsetMs) || action.scheduledOffsetMs < 0) {
      throw new Error(`scenario action ${action.id} has an invalid scheduledOffsetMs`);
    }

    const expand = registry.resolve(action.action);
    const steps = expand({
      actionId: action.id,
      parameters: action.parameters ?? {},
    });
    commands.push(
      ...expandCommandSequence({
        id: `${script.id}:${action.id}`,
        scheduledOffsetMs: action.scheduledOffsetMs,
        steps,
      }),
    );
  }

  return commands;
}

export function compileScenarioExecutionPlan(input: {
  script: ScenarioScript;
  registry: ScenarioActionRegistry;
  run: ExperimentRun;
  planRevision: number;
}): ExecutionPlan {
  return compileExecutionPlan({
    run: input.run,
    planRevision: input.planRevision,
    commands: compileScenarioCommands(input.script, input.registry),
  });
}
