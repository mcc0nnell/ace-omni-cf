import { describe, expect, it } from "vitest";
import { SC7_WORKSPACE_EVENTS, composeOmniWorkspace, type OmniWorkspaceEvent } from "./omni-workspace";
import { projectCounterfactualOmission, traceAssurance } from "./explorable-assurance";

describe("explorable assurance", () => {
  it("traces the SC-7 evidence through the contradiction and finding", () => {
    const workspace = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 8, "investigation");
    const trace = traceAssurance(workspace, "evidence:aws-sg-0a41", "downstream");

    expect(trace.nodeIds).toEqual(expect.arrayContaining([
      "claim:ssp-sc7-1",
      "contradiction:sc7-public-admin",
      "finding:finding-sc7-001",
    ]));
    expect(trace.edgeIds).toEqual(expect.arrayContaining([
      "grounds:aws-sg-0a41:sc7-public-admin",
      "grounds:contradiction:sc7-public-admin:finding:finding-sc7-001",
    ]));
  });

  it("projects evidence removal without mutating authoritative workspace state", () => {
    const workspace = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 8, "investigation");
    const snapshot = structuredClone(workspace);

    const counterfactual = projectCounterfactualOmission(workspace, "evidence:aws-sg-0a41");

    expect(counterfactual.mode).toBe("hypothetical");
    expect(counterfactual.affectedNodeIds).toEqual(expect.arrayContaining([
      "claim:ssp-sc7-1",
      "contradiction:sc7-public-admin",
      "finding:finding-sc7-001",
    ]));
    expect(workspace).toEqual(snapshot);
    expect(workspace.nodes.some((node) => node.id === counterfactual.omittedNodeId)).toBe(true);
    expect(workspace.events).toEqual(SC7_WORKSPACE_EVENTS);
  });

  it("rejects exploration of objects outside the current projection", () => {
    const workspace = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 8, "agents");
    expect(() => traceAssurance(workspace, "claim:ssp-sc7-1")).toThrow(/unknown visible node/);
  });

  it("fails closed when a finding cites an unknown causal basis", () => {
    const events: OmniWorkspaceEvent[] = SC7_WORKSPACE_EVENTS.map((event) => ({ ...event })) as OmniWorkspaceEvent[];
    events[7] = {
      ...events[7],
      type: "finding.created",
      basisNodeIds: ["contradiction:does-not-exist"],
    } as Extract<OmniWorkspaceEvent, { type: "finding.created" }>;

    expect(() => composeOmniWorkspace(events, events.length, "investigation")).toThrow(/unknown basis node/);
  });
});
