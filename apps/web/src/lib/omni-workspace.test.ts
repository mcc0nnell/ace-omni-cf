import { describe, expect, it } from "vitest";
import {
  SC7_WORKSPACE_EVENTS,
  composeOmniWorkspace,
  type OmniWorkspaceEvent,
} from "./omni-workspace";

describe("composeOmniWorkspace", () => {
  it("reconstructs the same workspace deterministically", () => {
    const first = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, SC7_WORKSPACE_EVENTS.length, "mission");
    const second = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, SC7_WORKSPACE_EVENTS.length, "mission");

    expect(second).toEqual(first);
  });

  it("changes visible state as replay advances", () => {
    const beforeEvidence = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 5, "investigation");
    const afterContradiction = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 7, "investigation");

    expect(beforeEvidence.nodes.some((node) => node.kind === "evidence")).toBe(false);
    expect(afterContradiction.nodes.some((node) => node.id === "evidence:aws-sg-0a41")).toBe(true);
    expect(afterContradiction.nodes.some((node) => node.kind === "contradiction")).toBe(true);
  });

  it("projects the same authoritative state through different workspace lenses", () => {
    const evidence = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 8, "evidence");
    const agents = composeOmniWorkspace(SC7_WORKSPACE_EVENTS, 8, "agents");

    expect(evidence.nodes.some((node) => node.kind === "claim")).toBe(true);
    expect(evidence.nodes.some((node) => node.kind === "agent")).toBe(false);
    expect(agents.nodes.some((node) => node.kind === "agent")).toBe(true);
    expect(agents.nodes.some((node) => node.kind === "claim")).toBe(false);
  });

  it("rejects ambiguous event ordering", () => {
    const invalid: OmniWorkspaceEvent[] = [
      SC7_WORKSPACE_EVENTS[0],
      { ...SC7_WORKSPACE_EVENTS[1], sequence: 1 },
    ];

    expect(() => composeOmniWorkspace(invalid)).toThrow(/strictly increasing integer sequences/);
  });

  it("requires evidence and claims to exist before a contradiction can reference them", () => {
    const invalid = SC7_WORKSPACE_EVENTS.filter((event) => event.sequence !== 6);
    expect(() => composeOmniWorkspace(invalid)).toThrow(/unknown evidence aws-sg-0a41/);
  });
});
