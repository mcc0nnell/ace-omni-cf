import type { OmniWorkspaceEvent, OmniWorkspaceState } from "./omni-workspace";

export type OmniOperatorLayout = "single" | "2x2" | "3x2" | "focus+strip";

export type OmniOperatorExecutor =
  | "cloudflare"
  | "browser"
  | "mcp"
  | "local"
  | "container"
  | "remote";

export type OmniOperatorContextStatus =
  | "queued"
  | "authorized"
  | "running"
  | "evidenced"
  | "blocked"
  | "completed"
  | "failed";

export interface OmniOperatorBudget {
  maxConcurrent?: number;
  memoryMb?: number;
  cpuPercent?: number;
}

export interface OmniOperatorGroup {
  id: string;
  label: string;
  contextIds: string[];
  budget?: OmniOperatorBudget;
  auditTag?: string;
}

export interface OmniOperatorContext {
  id: string;
  sourceObjectId: string;
  groupId: string;
  label: string;
  executor: OmniOperatorExecutor;
  adapterId: string;
  capability: string;
  status: OmniOperatorContextStatus;
  auditTag?: string;
}

export interface OmniOperatorBundle {
  id: string;
  label: string;
  groupId: string;
  contextIds: string[];
}

export interface OmniOperatorManifest {
  version: "1";
  groups: OmniOperatorGroup[];
  contexts: OmniOperatorContext[];
  bundles: OmniOperatorBundle[];
}

export interface OmniOperatorPane {
  slot: number;
  contextId: string;
  sourceObjectId: string;
  sourceFirstSequence: number;
  groupId: string;
  label: string;
  executor: OmniOperatorExecutor;
  adapterId: string;
  capability: string;
  status: OmniOperatorContextStatus;
  auditTag?: string;
}

export interface OmniOperatorDeck {
  revision: number;
  layout: OmniOperatorLayout;
  panes: OmniOperatorPane[];
  groups: OmniOperatorGroup[];
  bundles: OmniOperatorBundle[];
}

export interface ComposeOperatorDeckOptions {
  layout?: OmniOperatorLayout;
  preferredContextIds?: readonly string[];
}

interface AuthorityObject {
  id: string;
  firstSequence: number;
}

const SLOT_COUNT: Record<OmniOperatorLayout, number> = {
  single: 1,
  "2x2": 4,
  "3x2": 6,
  "focus+strip": 4,
};

const EXECUTORS = new Set<OmniOperatorExecutor>([
  "cloudflare",
  "browser",
  "mcp",
  "local",
  "container",
  "remote",
]);

const STATUSES = new Set<OmniOperatorContextStatus>([
  "queued",
  "authorized",
  "running",
  "evidenced",
  "blocked",
  "completed",
  "failed",
]);

// Atlas UI 3's Agent Portal deliberately exposes host-process launch fields.
// Omni's operator manifest must never grow the same authority surface. A pane
// binds to an authoritative Omni object and an already-governed adapter /
// capability tuple; it does not carry executable material of its own.
const FORBIDDEN_EXECUTION_FIELDS = new Set([
  "command",
  "args",
  "argv",
  "cwd",
  "env",
  "environment",
  "script",
  "executable",
  "shell",
]);

function assertUniqueIds(items: readonly { id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new Error(`Omni operator ${kind} id must not be empty`);
    if (seen.has(item.id)) throw new Error(`Duplicate Omni operator ${kind} id ${item.id}`);
    seen.add(item.id);
  }
}

function assertPositiveNumber(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Omni operator budget ${field} must be a positive number`);
  }
}

function eventObject(event: OmniWorkspaceEvent): AuthorityObject | undefined {
  switch (event.type) {
    case "mission.created":
      return { id: `mission:${event.missionId}`, firstSequence: event.sequence };
    case "task.created":
      return { id: `task:${event.taskId}`, firstSequence: event.sequence };
    case "claim.attached":
      return { id: `claim:${event.claimId}`, firstSequence: event.sequence };
    case "evidence.emitted":
      return { id: `evidence:${event.evidenceId}`, firstSequence: event.sequence };
    case "contradiction.detected":
      return { id: `contradiction:${event.contradictionId}`, firstSequence: event.sequence };
    case "finding.created":
      return { id: `finding:${event.findingId}`, firstSequence: event.sequence };
    case "task.assigned":
      return undefined;
  }
}

function buildAuthorityIndex(workspace: OmniWorkspaceState): Map<string, AuthorityObject> {
  const index = new Map<string, AuthorityObject>();
  for (const event of workspace.events) {
    const object = eventObject(event);
    if (!object) continue;
    if (index.has(object.id)) {
      throw new Error(`Authoritative Omni event stream produced duplicate object ${object.id}`);
    }
    index.set(object.id, object);
  }
  return index;
}

function assertNoExecutableMaterial(context: OmniOperatorContext): void {
  for (const key of Object.keys(context)) {
    if (FORBIDDEN_EXECUTION_FIELDS.has(key)) {
      throw new Error(
        `Omni operator context ${context.id} contains forbidden execution field ${key}; ` +
          "operator panes may bind authority but may not carry executable commands",
      );
    }
  }
}

function validateManifest(workspace: OmniWorkspaceState, manifest: OmniOperatorManifest): Map<string, AuthorityObject> {
  if (manifest.version !== "1") throw new Error(`Unsupported Omni operator manifest version ${manifest.version}`);

  assertUniqueIds(manifest.groups, "group");
  assertUniqueIds(manifest.contexts, "context");
  assertUniqueIds(manifest.bundles, "bundle");

  const authority = buildAuthorityIndex(workspace);
  const groupById = new Map(manifest.groups.map((group) => [group.id, group]));
  const contextById = new Map(manifest.contexts.map((context) => [context.id, context]));

  for (const group of manifest.groups) {
    assertPositiveNumber(group.budget?.maxConcurrent, `${group.id}.maxConcurrent`);
    assertPositiveNumber(group.budget?.memoryMb, `${group.id}.memoryMb`);
    assertPositiveNumber(group.budget?.cpuPercent, `${group.id}.cpuPercent`);

    if (new Set(group.contextIds).size !== group.contextIds.length) {
      throw new Error(`Omni operator group ${group.id} contains duplicate context ids`);
    }
  }

  for (const context of manifest.contexts) {
    assertNoExecutableMaterial(context);
    if (!context.label.trim()) throw new Error(`Omni operator context ${context.id} label must not be empty`);
    if (!context.adapterId.trim()) throw new Error(`Omni operator context ${context.id} adapterId must not be empty`);
    if (!context.capability.trim()) throw new Error(`Omni operator context ${context.id} capability must not be empty`);
    if (!EXECUTORS.has(context.executor)) {
      throw new Error(`Omni operator context ${context.id} has unsupported executor ${context.executor}`);
    }
    if (!STATUSES.has(context.status)) {
      throw new Error(`Omni operator context ${context.id} has unsupported status ${context.status}`);
    }
    if (!authority.has(context.sourceObjectId)) {
      throw new Error(
        `Omni operator context ${context.id} references non-authoritative object ${context.sourceObjectId}`,
      );
    }
    const group = groupById.get(context.groupId);
    if (!group) throw new Error(`Omni operator context ${context.id} references unknown group ${context.groupId}`);
    if (!group.contextIds.includes(context.id)) {
      throw new Error(`Omni operator context ${context.id} is not declared by group ${context.groupId}`);
    }
  }

  for (const group of manifest.groups) {
    const declared = new Set(group.contextIds);
    const actual = new Set(
      manifest.contexts.filter((context) => context.groupId === group.id).map((context) => context.id),
    );
    if (declared.size !== actual.size || [...declared].some((id) => !actual.has(id))) {
      throw new Error(`Omni operator group ${group.id} membership does not match context bindings`);
    }
    for (const contextId of group.contextIds) {
      if (!contextById.has(contextId)) {
        throw new Error(`Omni operator group ${group.id} references unknown context ${contextId}`);
      }
    }
  }

  for (const bundle of manifest.bundles) {
    if (!bundle.label.trim()) throw new Error(`Omni operator bundle ${bundle.id} label must not be empty`);
    if (!groupById.has(bundle.groupId)) {
      throw new Error(`Omni operator bundle ${bundle.id} references unknown group ${bundle.groupId}`);
    }
    if (new Set(bundle.contextIds).size !== bundle.contextIds.length) {
      throw new Error(`Omni operator bundle ${bundle.id} contains duplicate context ids`);
    }
    for (const contextId of bundle.contextIds) {
      const context = contextById.get(contextId);
      if (!context) throw new Error(`Omni operator bundle ${bundle.id} references unknown context ${contextId}`);
      if (context.groupId !== bundle.groupId) {
        throw new Error(
          `Omni operator bundle ${bundle.id} crosses group boundary with context ${contextId}`,
        );
      }
    }
  }

  return authority;
}

function orderContexts(
  manifest: OmniOperatorManifest,
  authority: Map<string, AuthorityObject>,
  preferredContextIds: readonly string[],
): OmniOperatorContext[] {
  const contextById = new Map(manifest.contexts.map((context) => [context.id, context]));
  const preferredSeen = new Set<string>();
  const preferred: OmniOperatorContext[] = [];

  for (const id of preferredContextIds) {
    if (preferredSeen.has(id)) throw new Error(`Duplicate preferred Omni operator context ${id}`);
    preferredSeen.add(id);
    const context = contextById.get(id);
    if (!context) throw new Error(`Preferred Omni operator context ${id} does not exist`);
    preferred.push(context);
  }

  const remaining = manifest.contexts
    .filter((context) => !preferredSeen.has(context.id))
    .sort((a, b) => {
      const aSequence = authority.get(a.sourceObjectId)?.firstSequence ?? Number.MAX_SAFE_INTEGER;
      const bSequence = authority.get(b.sourceObjectId)?.firstSequence ?? Number.MAX_SAFE_INTEGER;
      return aSequence - bSequence || a.id.localeCompare(b.id);
    });

  return [...preferred, ...remaining];
}

export function composeOperatorDeck(
  workspace: OmniWorkspaceState,
  manifest: OmniOperatorManifest,
  options: ComposeOperatorDeckOptions = {},
): OmniOperatorDeck {
  const authority = validateManifest(workspace, manifest);
  const layout = options.layout ?? "focus+strip";
  const slotCount = SLOT_COUNT[layout];
  const ordered = orderContexts(manifest, authority, options.preferredContextIds ?? []);

  const panes = ordered.slice(0, slotCount).map<OmniOperatorPane>((context, slot) => ({
    slot,
    contextId: context.id,
    sourceObjectId: context.sourceObjectId,
    sourceFirstSequence: authority.get(context.sourceObjectId)!.firstSequence,
    groupId: context.groupId,
    label: context.label,
    executor: context.executor,
    adapterId: context.adapterId,
    capability: context.capability,
    status: context.status,
    auditTag: context.auditTag,
  }));

  return {
    revision: workspace.revision,
    layout,
    panes,
    groups: manifest.groups.map((group) => ({
      ...group,
      contextIds: [...group.contextIds],
      budget: group.budget ? { ...group.budget } : undefined,
    })),
    bundles: manifest.bundles.map((bundle) => ({ ...bundle, contextIds: [...bundle.contextIds] })),
  };
}

export const SC7_OPERATOR_MANIFEST: OmniOperatorManifest = {
  version: "1",
  groups: [
    {
      id: "group:sc7-assessment",
      label: "SC-7 assessment cell",
      contextIds: [
        "context:ssp-claim",
        "context:aws-evidence",
        "context:contradiction",
        "context:finding",
      ],
      budget: {
        maxConcurrent: 3,
        memoryMb: 1024,
        cpuPercent: 100,
      },
      auditTag: "oscal:SC-7",
    },
  ],
  contexts: [
    {
      id: "context:ssp-claim",
      sourceObjectId: "claim:ssp-sc7-1",
      groupId: "group:sc7-assessment",
      label: "SSP implementation claim",
      executor: "cloudflare",
      adapterId: "regime-evaluator",
      capability: "control.claim.read",
      status: "evidenced",
      auditTag: "oscal:SC-7",
    },
    {
      id: "context:aws-evidence",
      sourceObjectId: "evidence:aws-sg-0a41",
      groupId: "group:sc7-assessment",
      label: "AWS boundary evidence",
      executor: "remote",
      adapterId: "aws-ec2",
      capability: "config.security-group.read",
      status: "evidenced",
      auditTag: "oscal:SC-7",
    },
    {
      id: "context:contradiction",
      sourceObjectId: "contradiction:sc7-public-admin",
      groupId: "group:sc7-assessment",
      label: "Contradiction analysis",
      executor: "cloudflare",
      adapterId: "assurance-graph",
      capability: "evidence.contradiction.evaluate",
      status: "evidenced",
      auditTag: "oscal:SC-7",
    },
    {
      id: "context:finding",
      sourceObjectId: "finding:finding-sc7-001",
      groupId: "group:sc7-assessment",
      label: "Human finding review",
      executor: "browser",
      adapterId: "human-approval",
      capability: "finding.review",
      status: "blocked",
      auditTag: "oscal:SC-7",
    },
  ],
  bundles: [
    {
      id: "bundle:sc7-assessment",
      label: "SC-7 assessment cell",
      groupId: "group:sc7-assessment",
      contextIds: [
        "context:ssp-claim",
        "context:aws-evidence",
        "context:contradiction",
        "context:finding",
      ],
    },
  ],
};
