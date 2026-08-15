import type { OmniWorkspaceEdge, OmniWorkspaceState } from "./omni-workspace";

export type AssuranceExplorationMode = "authoritative" | "trace" | "hypothetical";
export type AssuranceTraceDirection = "upstream" | "downstream" | "both";

export interface AssuranceTrace {
  mode: "trace";
  focusedNodeId: string;
  direction: AssuranceTraceDirection;
  nodeIds: string[];
  edgeIds: string[];
}

export interface AssuranceCounterfactual {
  mode: "hypothetical";
  omittedNodeId: string;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
}

const CAUSAL_EDGE_KINDS = new Set<OmniWorkspaceEdge["kind"]>([
  "asserts",
  "supports",
  "challenges",
  "produces",
  "grounds",
]);

function requireNode(workspace: OmniWorkspaceState, nodeId: string): void {
  if (!workspace.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`Assurance exploration references unknown visible node ${nodeId}`);
  }
}

function orderedNodeIds(workspace: OmniWorkspaceState, ids: Set<string>): string[] {
  return workspace.nodes.filter((node) => ids.has(node.id)).map((node) => node.id);
}

function orderedEdgeIds(workspace: OmniWorkspaceState, ids: Set<string>): string[] {
  return workspace.edges.filter((edge) => ids.has(edge.id)).map((edge) => edge.id);
}

export function traceAssurance(
  workspace: OmniWorkspaceState,
  focusedNodeId: string,
  direction: AssuranceTraceDirection = "both",
): AssuranceTrace {
  requireNode(workspace, focusedNodeId);

  const visited = new Set<string>([focusedNodeId]);
  const traversedEdges = new Set<string>();
  const queue = [focusedNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of workspace.edges) {
      if (!CAUSAL_EDGE_KINDS.has(edge.kind)) continue;

      let next: string | undefined;
      if ((direction === "downstream" || direction === "both") && edge.from === current) {
        next = edge.to;
      } else if ((direction === "upstream" || direction === "both") && edge.to === current) {
        next = edge.from;
      }

      if (!next) continue;
      traversedEdges.add(edge.id);
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  visited.delete(focusedNodeId);
  return {
    mode: "trace",
    focusedNodeId,
    direction,
    nodeIds: orderedNodeIds(workspace, visited),
    edgeIds: orderedEdgeIds(workspace, traversedEdges),
  };
}

export function projectCounterfactualOmission(
  workspace: OmniWorkspaceState,
  omittedNodeId: string,
): AssuranceCounterfactual {
  requireNode(workspace, omittedNodeId);

  const affected = new Set<string>();
  const traversedEdges = new Set<string>();
  const queue = [omittedNodeId];
  const visited = new Set<string>([omittedNodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of workspace.edges) {
      if (!CAUSAL_EDGE_KINDS.has(edge.kind) || edge.from !== current) continue;

      traversedEdges.add(edge.id);
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      affected.add(edge.to);
      queue.push(edge.to);
    }
  }

  return {
    mode: "hypothetical",
    omittedNodeId,
    affectedNodeIds: orderedNodeIds(workspace, affected),
    affectedEdgeIds: orderedEdgeIds(workspace, traversedEdges),
  };
}
