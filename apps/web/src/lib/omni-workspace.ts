export type OmniProjection =
  | "mission"
  | "agents"
  | "execution"
  | "evidence"
  | "investigation"
  | "replay";

export type OmniWorkspaceEvent =
  | {
      sequence: number;
      at: string;
      type: "mission.created";
      missionId: string;
      title: string;
    }
  | {
      sequence: number;
      at: string;
      type: "task.created";
      taskId: string;
      title: string;
      parentTaskId?: string;
    }
  | {
      sequence: number;
      at: string;
      type: "task.assigned";
      taskId: string;
      agentId: string;
    }
  | {
      sequence: number;
      at: string;
      type: "claim.attached";
      taskId: string;
      claimId: string;
      controlId: string;
      label: string;
    }
  | {
      sequence: number;
      at: string;
      type: "evidence.emitted";
      taskId: string;
      evidenceId: string;
      label: string;
      source: string;
      claimId?: string;
    }
  | {
      sequence: number;
      at: string;
      type: "contradiction.detected";
      taskId: string;
      contradictionId: string;
      claimId: string;
      evidenceId: string;
      summary: string;
    }
  | {
      sequence: number;
      at: string;
      type: "finding.created";
      taskId: string;
      findingId: string;
      severity: "low" | "moderate" | "high" | "critical";
      summary: string;
      basisNodeIds?: string[];
    };

export type OmniWorkspaceNodeKind =
  | "mission"
  | "task"
  | "agent"
  | "claim"
  | "evidence"
  | "contradiction"
  | "finding";

export interface OmniWorkspaceNode {
  id: string;
  kind: OmniWorkspaceNodeKind;
  label: string;
  detail?: string;
  taskId?: string;
  controlId?: string;
  agentId?: string;
  severity?: "low" | "moderate" | "high" | "critical";
  firstSequence: number;
  eventSequences: number[];
  position: { x: number; y: number };
}

export interface OmniWorkspaceEdge {
  id: string;
  from: string;
  to: string;
  kind: "decomposes" | "owns" | "asserts" | "supports" | "challenges" | "produces" | "grounds";
}

export interface OmniWorkspaceState {
  revision: number;
  projection: OmniProjection;
  nodes: OmniWorkspaceNode[];
  edges: OmniWorkspaceEdge[];
  events: OmniWorkspaceEvent[];
}

interface TaskRecord {
  taskId: string;
  title: string;
  parentTaskId?: string;
  agentId?: string;
  firstSequence: number;
  eventSequences: number[];
}

interface ClaimRecord {
  claimId: string;
  taskId: string;
  controlId: string;
  label: string;
  firstSequence: number;
  eventSequences: number[];
}

interface EvidenceRecord {
  evidenceId: string;
  taskId: string;
  claimId?: string;
  label: string;
  source: string;
  firstSequence: number;
  eventSequences: number[];
}

interface ContradictionRecord {
  contradictionId: string;
  taskId: string;
  claimId: string;
  evidenceId: string;
  summary: string;
  firstSequence: number;
}

interface FindingRecord {
  findingId: string;
  taskId: string;
  severity: "low" | "moderate" | "high" | "critical";
  summary: string;
  basisNodeIds: string[];
  firstSequence: number;
}

function assertEventOrder(events: readonly OmniWorkspaceEvent[]): void {
  let previous = 0;
  for (const event of events) {
    if (!Number.isInteger(event.sequence) || event.sequence <= previous) {
      throw new Error(
        `Omni workspace events must use strictly increasing integer sequences; got ${event.sequence} after ${previous}`,
      );
    }
    previous = event.sequence;
  }
}

function requireTask(tasks: Map<string, TaskRecord>, taskId: string, type: string): TaskRecord {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`${type} references unknown task ${taskId}`);
  return task;
}

function distribute(count: number, index: number): number {
  if (count <= 1) return 50;
  return 15 + (70 * index) / (count - 1);
}

function projectionPosition(
  projection: OmniProjection,
  kind: OmniWorkspaceNodeKind,
  index: number,
  count: number,
  firstSequence: number,
  maxSequence: number,
): { x: number; y: number } {
  if (projection === "replay") {
    const lanes: Record<OmniWorkspaceNodeKind, number> = {
      mission: 12,
      task: 28,
      agent: 42,
      claim: 56,
      evidence: 70,
      contradiction: 84,
      finding: 92,
    };
    const progress = maxSequence <= 1 ? 0 : (firstSequence - 1) / (maxSequence - 1);
    return { x: 8 + progress * 84, y: lanes[kind] };
  }

  const xByProjection: Record<Exclude<OmniProjection, "replay">, Record<OmniWorkspaceNodeKind, number>> = {
    mission: { mission: 8, task: 30, agent: 48, claim: 57, evidence: 74, contradiction: 88, finding: 94 },
    agents: { mission: 8, task: 58, agent: 24, claim: 72, evidence: 82, contradiction: 90, finding: 95 },
    execution: { mission: 8, task: 24, agent: 52, claim: 64, evidence: 82, contradiction: 91, finding: 95 },
    evidence: { mission: 8, task: 12, agent: 25, claim: 28, evidence: 55, contradiction: 76, finding: 92 },
    investigation: { mission: 7, task: 14, agent: 36, claim: 34, evidence: 56, contradiction: 77, finding: 93 },
  };

  return { x: xByProjection[projection][kind], y: distribute(count, index) };
}

function visibleKinds(projection: OmniProjection): Set<OmniWorkspaceNodeKind> {
  switch (projection) {
    case "agents":
      return new Set(["mission", "task", "agent", "evidence"]);
    case "execution":
      return new Set(["task", "agent", "evidence", "contradiction"]);
    case "evidence":
      return new Set(["claim", "evidence", "contradiction", "finding"]);
    case "investigation":
      return new Set(["task", "agent", "claim", "evidence", "contradiction", "finding"]);
    case "mission":
    case "replay":
      return new Set(["mission", "task", "agent", "claim", "evidence", "contradiction", "finding"]);
  }
}

export function composeOmniWorkspace(
  allEvents: readonly OmniWorkspaceEvent[],
  revision = allEvents.length,
  projection: OmniProjection = "mission",
): OmniWorkspaceState {
  assertEventOrder(allEvents);
  const boundedRevision = Math.max(0, Math.min(revision, allEvents.length));
  const events = allEvents.slice(0, boundedRevision);

  const tasks = new Map<string, TaskRecord>();
  const claims = new Map<string, ClaimRecord>();
  const evidence = new Map<string, EvidenceRecord>();
  const contradictions = new Map<string, ContradictionRecord>();
  const findings = new Map<string, FindingRecord>();
  const agentFirstSequence = new Map<string, number>();
  let mission: Extract<OmniWorkspaceEvent, { type: "mission.created" }> | undefined;

  for (const event of events) {
    switch (event.type) {
      case "mission.created":
        if (mission) throw new Error("Omni workspace stream contains more than one mission.created event");
        mission = event;
        break;
      case "task.created": {
        if (tasks.has(event.taskId)) throw new Error(`Duplicate Omni task id ${event.taskId}`);
        if (event.parentTaskId) requireTask(tasks, event.parentTaskId, event.type);
        tasks.set(event.taskId, {
          taskId: event.taskId,
          title: event.title,
          parentTaskId: event.parentTaskId,
          firstSequence: event.sequence,
          eventSequences: [event.sequence],
        });
        break;
      }
      case "task.assigned": {
        const task = requireTask(tasks, event.taskId, event.type);
        task.agentId = event.agentId;
        task.eventSequences.push(event.sequence);
        if (!agentFirstSequence.has(event.agentId)) agentFirstSequence.set(event.agentId, event.sequence);
        break;
      }
      case "claim.attached": {
        requireTask(tasks, event.taskId, event.type).eventSequences.push(event.sequence);
        if (claims.has(event.claimId)) throw new Error(`Duplicate Omni claim id ${event.claimId}`);
        claims.set(event.claimId, {
          claimId: event.claimId,
          taskId: event.taskId,
          controlId: event.controlId,
          label: event.label,
          firstSequence: event.sequence,
          eventSequences: [event.sequence],
        });
        break;
      }
      case "evidence.emitted": {
        requireTask(tasks, event.taskId, event.type).eventSequences.push(event.sequence);
        if (event.claimId && !claims.has(event.claimId)) throw new Error(`${event.type} references unknown claim ${event.claimId}`);
        if (evidence.has(event.evidenceId)) throw new Error(`Duplicate Omni evidence id ${event.evidenceId}`);
        evidence.set(event.evidenceId, {
          evidenceId: event.evidenceId,
          taskId: event.taskId,
          claimId: event.claimId,
          label: event.label,
          source: event.source,
          firstSequence: event.sequence,
          eventSequences: [event.sequence],
        });
        break;
      }
      case "contradiction.detected": {
        requireTask(tasks, event.taskId, event.type).eventSequences.push(event.sequence);
        const claim = claims.get(event.claimId);
        const artifact = evidence.get(event.evidenceId);
        if (!claim) throw new Error(`${event.type} references unknown claim ${event.claimId}`);
        if (!artifact) throw new Error(`${event.type} references unknown evidence ${event.evidenceId}`);
        claim.eventSequences.push(event.sequence);
        artifact.eventSequences.push(event.sequence);
        contradictions.set(event.contradictionId, {
          contradictionId: event.contradictionId,
          taskId: event.taskId,
          claimId: event.claimId,
          evidenceId: event.evidenceId,
          summary: event.summary,
          firstSequence: event.sequence,
        });
        break;
      }
      case "finding.created":
        requireTask(tasks, event.taskId, event.type).eventSequences.push(event.sequence);
        findings.set(event.findingId, {
          findingId: event.findingId,
          taskId: event.taskId,
          severity: event.severity,
          summary: event.summary,
          basisNodeIds: [...(event.basisNodeIds ?? [])],
          firstSequence: event.sequence,
        });
        break;
    }
  }

  const nodes: OmniWorkspaceNode[] = [];
  const edges: OmniWorkspaceEdge[] = [];

  if (mission) {
    nodes.push({
      id: `mission:${mission.missionId}`,
      kind: "mission",
      label: mission.title,
      firstSequence: mission.sequence,
      eventSequences: [mission.sequence],
      position: { x: 0, y: 0 },
    });
  }

  for (const task of tasks.values()) {
    nodes.push({
      id: `task:${task.taskId}`,
      kind: "task",
      taskId: task.taskId,
      agentId: task.agentId,
      label: task.title,
      detail: task.agentId ? `owned by ${task.agentId}` : "unassigned",
      firstSequence: task.firstSequence,
      eventSequences: [...task.eventSequences],
      position: { x: 0, y: 0 },
    });
    if (task.parentTaskId) {
      edges.push({
        id: `decomposes:${task.parentTaskId}:${task.taskId}`,
        from: `task:${task.parentTaskId}`,
        to: `task:${task.taskId}`,
        kind: "decomposes",
      });
    } else if (mission) {
      edges.push({
        id: `decomposes:${mission.missionId}:${task.taskId}`,
        from: `mission:${mission.missionId}`,
        to: `task:${task.taskId}`,
        kind: "decomposes",
      });
    }
  }

  for (const [agentId, firstSequence] of agentFirstSequence) {
    nodes.push({
      id: `agent:${agentId}`,
      kind: "agent",
      agentId,
      label: agentId,
      detail: "agent capability",
      firstSequence,
      eventSequences: [firstSequence],
      position: { x: 0, y: 0 },
    });
  }

  for (const task of tasks.values()) {
    if (task.agentId) {
      edges.push({
        id: `owns:${task.agentId}:${task.taskId}`,
        from: `agent:${task.agentId}`,
        to: `task:${task.taskId}`,
        kind: "owns",
      });
    }
  }

  for (const claim of claims.values()) {
    nodes.push({
      id: `claim:${claim.claimId}`,
      kind: "claim",
      taskId: claim.taskId,
      controlId: claim.controlId,
      label: claim.label,
      detail: claim.controlId,
      firstSequence: claim.firstSequence,
      eventSequences: [...claim.eventSequences],
      position: { x: 0, y: 0 },
    });
    edges.push({
      id: `asserts:${claim.taskId}:${claim.claimId}`,
      from: `task:${claim.taskId}`,
      to: `claim:${claim.claimId}`,
      kind: "asserts",
    });
  }

  for (const artifact of evidence.values()) {
    nodes.push({
      id: `evidence:${artifact.evidenceId}`,
      kind: "evidence",
      taskId: artifact.taskId,
      label: artifact.label,
      detail: artifact.source,
      firstSequence: artifact.firstSequence,
      eventSequences: [...artifact.eventSequences],
      position: { x: 0, y: 0 },
    });
    edges.push({
      id: `produces:${artifact.taskId}:${artifact.evidenceId}`,
      from: `task:${artifact.taskId}`,
      to: `evidence:${artifact.evidenceId}`,
      kind: "produces",
    });
    if (artifact.claimId) {
      edges.push({
        id: `supports:${artifact.evidenceId}:${artifact.claimId}`,
        from: `evidence:${artifact.evidenceId}`,
        to: `claim:${artifact.claimId}`,
        kind: "supports",
      });
    }
  }

  for (const contradiction of contradictions.values()) {
    nodes.push({
      id: `contradiction:${contradiction.contradictionId}`,
      kind: "contradiction",
      taskId: contradiction.taskId,
      label: contradiction.summary,
      detail: `${contradiction.evidenceId} contradicts ${contradiction.claimId}`,
      firstSequence: contradiction.firstSequence,
      eventSequences: [contradiction.firstSequence],
      position: { x: 0, y: 0 },
    });
    edges.push({
      id: `challenges:${contradiction.contradictionId}:${contradiction.claimId}`,
      from: `contradiction:${contradiction.contradictionId}`,
      to: `claim:${contradiction.claimId}`,
      kind: "challenges",
    });
    edges.push({
      id: `grounds:${contradiction.evidenceId}:${contradiction.contradictionId}`,
      from: `evidence:${contradiction.evidenceId}`,
      to: `contradiction:${contradiction.contradictionId}`,
      kind: "grounds",
    });
  }

  for (const finding of findings.values()) {
    const basisNodeIds = [...new Set(finding.basisNodeIds)];
    const existingNodes = new Map(nodes.map((node) => [node.id, node]));
    for (const basisNodeId of basisNodeIds) {
      const basis = existingNodes.get(basisNodeId);
      if (!basis) throw new Error(`finding.created references unknown basis node ${basisNodeId}`);
      if (basis.firstSequence >= finding.firstSequence) {
        throw new Error(`finding.created basis ${basisNodeId} must exist before finding ${finding.findingId}`);
      }
    }

    nodes.push({
      id: `finding:${finding.findingId}`,
      kind: "finding",
      taskId: finding.taskId,
      label: finding.summary,
      detail: `${finding.severity} severity`,
      severity: finding.severity,
      firstSequence: finding.firstSequence,
      eventSequences: [finding.firstSequence],
      position: { x: 0, y: 0 },
    });
    edges.push({
      id: `produces:${finding.taskId}:${finding.findingId}`,
      from: `task:${finding.taskId}`,
      to: `finding:${finding.findingId}`,
      kind: "produces",
    });
    for (const basisNodeId of basisNodeIds) {
      edges.push({
        id: `grounds:${basisNodeId}:finding:${finding.findingId}`,
        from: basisNodeId,
        to: `finding:${finding.findingId}`,
        kind: "grounds",
      });
    }
  }

  const allowed = visibleKinds(projection);
  const visibleNodes = nodes.filter((node) => allowed.has(node.kind));
  const byKind = new Map<OmniWorkspaceNodeKind, OmniWorkspaceNode[]>();
  for (const node of visibleNodes) {
    const group = byKind.get(node.kind) ?? [];
    group.push(node);
    byKind.set(node.kind, group);
  }

  const maxSequence = events.at(-1)?.sequence ?? 1;
  for (const group of byKind.values()) {
    group.forEach((node, index) => {
      node.position = projectionPosition(projection, node.kind, index, group.length, node.firstSequence, maxSequence);
    });
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return {
    revision: boundedRevision,
    projection,
    nodes: visibleNodes,
    edges: edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
    events,
  };
}

export const SC7_WORKSPACE_EVENTS: readonly OmniWorkspaceEvent[] = [
  {
    sequence: 1,
    at: "2026-08-14T00:00:00-04:00",
    type: "mission.created",
    missionId: "authorization-readiness",
    title: "Assess authorization readiness",
  },
  {
    sequence: 2,
    at: "2026-08-14T00:00:01-04:00",
    type: "task.created",
    taskId: "assessment",
    title: "Evaluate SSP claims against authoritative evidence",
  },
  {
    sequence: 3,
    at: "2026-08-14T00:00:02-04:00",
    type: "task.created",
    taskId: "sc-7",
    parentTaskId: "assessment",
    title: "SC-7 · Boundary Protection",
  },
  {
    sequence: 4,
    at: "2026-08-14T00:00:03-04:00",
    type: "task.assigned",
    taskId: "sc-7",
    agentId: "assessor.network",
  },
  {
    sequence: 5,
    at: "2026-08-14T00:00:04-04:00",
    type: "claim.attached",
    taskId: "sc-7",
    claimId: "ssp-sc7-1",
    controlId: "SC-7",
    label: "SSP: administrative access is restricted to trusted networks",
  },
  {
    sequence: 6,
    at: "2026-08-14T00:00:05-04:00",
    type: "evidence.emitted",
    taskId: "sc-7",
    evidenceId: "aws-sg-0a41",
    claimId: "ssp-sc7-1",
    label: "AWS security-group ingress snapshot",
    source: "aws:ec2:security-group/sg-0a41",
  },
  {
    sequence: 7,
    at: "2026-08-14T00:00:06-04:00",
    type: "contradiction.detected",
    taskId: "sc-7",
    contradictionId: "sc7-public-admin",
    claimId: "ssp-sc7-1",
    evidenceId: "aws-sg-0a41",
    summary: "Live rule permits TCP/22 and TCP/3389 from 0.0.0.0/0",
  },
  {
    sequence: 8,
    at: "2026-08-14T00:00:07-04:00",
    type: "finding.created",
    taskId: "sc-7",
    findingId: "finding-sc7-001",
    severity: "high",
    summary: "Boundary configuration contradicts the SSP implementation statement",
    basisNodeIds: ["contradiction:sc7-public-admin"],
  },
] as const;
