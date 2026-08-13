import type { JsonValue } from "./emulytics";

/**
 * Authoring-time representation for an Omni experiment scenario.
 *
 * The AST is intentionally inert: it can describe higher-order intent, but it
 * cannot execute against an adapter. Compilation must resolve every action
 * through a registry and lower it into canonical PlannedCommandDefinition[]
 * before the ordinary execution-plan compiler sees it.
 */
export interface ScenarioActionNode {
  kind: "action";
  /** Stable identity within the scenario. */
  id: string;
  /** Registry name for the higher-order action. */
  action: string;
  /** Offset from the experiment run clock. */
  scheduledOffsetMs: number;
  /** JSON-only authoring parameters consumed by the registered expander. */
  parameters?: Record<string, JsonValue>;
}

export interface ScenarioScript {
  version: 1;
  id: string;
  actions: readonly ScenarioActionNode[];
}
