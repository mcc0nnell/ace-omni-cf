import { describe, expect, it } from "vitest";
import { SC7_WORKSPACE_EVENTS, composeOmniWorkspace } from "./omni-workspace";
import {
  SC7_OPERATOR_MANIFEST,
  composeOperatorDeck,
  type OmniOperatorManifest,
} from "./omni-operator";

function fullWorkspace() {
  return composeOmniWorkspace(SC7_WORKSPACE_EVENTS, SC7_WORKSPACE_EVENTS.length, "mission");
}

describe("composeOperatorDeck", () => {
  it("derives the same operator deck deterministically", () => {
    const workspace = fullWorkspace();
    const first = composeOperatorDeck(workspace, SC7_OPERATOR_MANIFEST);
    const second = composeOperatorDeck(workspace, SC7_OPERATOR_MANIFEST);

    expect(second).toEqual(first);
    expect(first.layout).toBe("focus+strip");
    expect(first.panes.map((pane) => pane.contextId)).toEqual([
      "context:ssp-claim",
      "context:aws-evidence",
      "context:contradiction",
      "context:finding",
    ]);
  });

  it("treats layout and pane preference as presentation only", () => {
    const workspace = fullWorkspace();
    const baseline = composeOperatorDeck(workspace, SC7_OPERATOR_MANIFEST, { layout: "2x2" });
    const rearranged = composeOperatorDeck(workspace, SC7_OPERATOR_MANIFEST, {
      layout: "focus+strip",
      preferredContextIds: ["context:finding", "context:aws-evidence"],
    });

    expect(new Set(rearranged.panes.map((pane) => pane.contextId))).toEqual(
      new Set(baseline.panes.map((pane) => pane.contextId)),
    );
    expect(rearranged.panes[0].contextId).toBe("context:finding");
    expect(rearranged.panes[0].adapterId).toBe("human-approval");
    expect(rearranged.panes[0].capability).toBe("finding.review");
    expect(rearranged.panes[0].status).toBe("blocked");
  });

  it("carries group budgets and audit tags without turning them into execution authority", () => {
    const deck = composeOperatorDeck(fullWorkspace(), SC7_OPERATOR_MANIFEST);
    const group = deck.groups[0];

    expect(group.auditTag).toBe("oscal:SC-7");
    expect(group.budget).toEqual({ maxConcurrent: 3, memoryMb: 1024, cpuPercent: 100 });
    expect(deck.panes.every((pane) => pane.auditTag === "oscal:SC-7")).toBe(true);
  });

  it("rejects contexts that do not bind to an authoritative Omni object", () => {
    const manifest: OmniOperatorManifest = {
      ...SC7_OPERATOR_MANIFEST,
      groups: SC7_OPERATOR_MANIFEST.groups.map((group) => ({ ...group, contextIds: [...group.contextIds] })),
      bundles: SC7_OPERATOR_MANIFEST.bundles.map((bundle) => ({ ...bundle, contextIds: [...bundle.contextIds] })),
      contexts: SC7_OPERATOR_MANIFEST.contexts.map((context) => ({ ...context })),
    };
    manifest.contexts[0].sourceObjectId = "evidence:invented-by-ui";

    expect(() => composeOperatorDeck(fullWorkspace(), manifest)).toThrow(/non-authoritative object/);
  });

  it("rejects hidden group membership changes", () => {
    const manifest: OmniOperatorManifest = {
      ...SC7_OPERATOR_MANIFEST,
      groups: SC7_OPERATOR_MANIFEST.groups.map((group) => ({ ...group, contextIds: [...group.contextIds] })),
      bundles: SC7_OPERATOR_MANIFEST.bundles.map((bundle) => ({ ...bundle, contextIds: [...bundle.contextIds] })),
      contexts: SC7_OPERATOR_MANIFEST.contexts.map((context) => ({ ...context })),
    };
    manifest.groups[0].contextIds = manifest.groups[0].contextIds.slice(0, -1);

    expect(() => composeOperatorDeck(fullWorkspace(), manifest)).toThrow(/not declared by group|membership does not match/);
  });

  it("rejects bundles that cross a governance group boundary", () => {
    const manifest: OmniOperatorManifest = {
      ...SC7_OPERATOR_MANIFEST,
      groups: [
        ...SC7_OPERATOR_MANIFEST.groups.map((group) => ({ ...group, contextIds: [...group.contextIds] })),
        { id: "group:other", label: "Other", contextIds: [] },
      ],
      contexts: SC7_OPERATOR_MANIFEST.contexts.map((context) => ({ ...context })),
      bundles: SC7_OPERATOR_MANIFEST.bundles.map((bundle) => ({ ...bundle, contextIds: [...bundle.contextIds] })),
    };
    manifest.bundles[0].groupId = "group:other";

    expect(() => composeOperatorDeck(fullWorkspace(), manifest)).toThrow(/crosses group boundary/);
  });

  it("refuses Atlas-style arbitrary subprocess fields in an Omni context", () => {
    const manifest = {
      ...SC7_OPERATOR_MANIFEST,
      groups: SC7_OPERATOR_MANIFEST.groups.map((group) => ({ ...group, contextIds: [...group.contextIds] })),
      bundles: SC7_OPERATOR_MANIFEST.bundles.map((bundle) => ({ ...bundle, contextIds: [...bundle.contextIds] })),
      contexts: SC7_OPERATOR_MANIFEST.contexts.map((context) => ({ ...context })),
    } as OmniOperatorManifest;

    (manifest.contexts[0] as OmniOperatorManifest["contexts"][number] & { command?: string }).command = "bash";

    expect(() => composeOperatorDeck(fullWorkspace(), manifest)).toThrow(/forbidden execution field command/);
  });
});
