import type { CommandSequenceStep } from "./command-expansion";
import type { JsonValue } from "./emulytics";

export interface ScenarioActionExpansionInput {
  actionId: string;
  parameters: Readonly<Record<string, JsonValue>>;
}

/**
 * A scenario action has no execution authority of its own. It may only return
 * ordinary command-sequence steps, which are subsequently lowered into Omni's
 * canonical primitive command vocabulary.
 */
export type ScenarioActionExpander = (
  input: ScenarioActionExpansionInput,
) => readonly CommandSequenceStep[];

const ActionNamePattern = /^[A-Za-z][A-Za-z0-9._-]{0,119}$/;

export class ScenarioActionRegistry {
  private readonly expanders = new Map<string, ScenarioActionExpander>();

  register(name: string, expander: ScenarioActionExpander): this {
    if (!ActionNamePattern.test(name)) {
      throw new Error(`scenario action name ${name} must be a stable identifier`);
    }
    if (this.expanders.has(name)) {
      throw new Error(`scenario action ${name} is already registered`);
    }
    this.expanders.set(name, expander);
    return this;
  }

  resolve(name: string): ScenarioActionExpander {
    const expander = this.expanders.get(name);
    if (expander) {
      return expander;
    }
    const available = this.availableActions();
    const suffix = available.length > 0 ? ` Available actions: ${available.join(", ")}` : "";
    throw new Error(`scenario action ${name} is not registered.${suffix}`);
  }

  availableActions(): string[] {
    return [...this.expanders.keys()].sort();
  }
}
