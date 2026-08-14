import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  SC7_WORKSPACE_EVENTS,
  composeOmniWorkspace,
  type OmniProjection,
  type OmniWorkspaceEvent,
  type OmniWorkspaceNode,
} from "../lib/omni-workspace";
import "../styles/omni-workspace.css";

const PROJECTIONS: Array<{ id: OmniProjection; key: string; label: string }> = [
  { id: "mission", key: "F1", label: "Mission" },
  { id: "agents", key: "F2", label: "Agents" },
  { id: "execution", key: "F3", label: "Execution" },
  { id: "evidence", key: "F4", label: "Evidence" },
  { id: "investigation", key: "F5", label: "Investigation" },
  { id: "replay", key: "F6", label: "Replay" },
];

function eventSummary(event: OmniWorkspaceEvent): string {
  switch (event.type) {
    case "mission.created":
      return `mission created · ${event.title}`;
    case "task.created":
      return `task created · ${event.title}`;
    case "task.assigned":
      return `${event.agentId} ← ${event.taskId}`;
    case "claim.attached":
      return `${event.controlId} claim attached`;
    case "evidence.emitted":
      return `evidence emitted · ${event.evidenceId}`;
    case "contradiction.detected":
      return `contradiction · ${event.summary}`;
    case "finding.created":
      return `${event.severity} finding · ${event.summary}`;
  }
}

function NodeCard({
  node,
  selected,
  onSelect,
}: {
  node: OmniWorkspaceNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const style = {
    "--omni-node-x": `${node.position.x}%`,
    "--omni-node-y": `${node.position.y}%`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="omni-map-node"
      data-kind={node.kind}
      data-selected={selected ? "true" : "false"}
      style={style}
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
    >
      <span className="omni-node-kicker">{node.controlId ?? node.kind}</span>
      <strong>{node.label}</strong>
      {node.detail ? <small>{node.detail}</small> : null}
      <span className="omni-node-seq">#{node.firstSequence}</span>
    </button>
  );
}

function Inspector({ node, shaded, pinned, onShade, onPin }: {
  node: OmniWorkspaceNode | undefined;
  shaded: boolean;
  pinned: boolean;
  onShade: () => void;
  onPin: () => void;
}) {
  return (
    <aside className="omni-inspector" data-shaded={shaded ? "true" : "false"}>
      <header className="omni-window-titlebar">
        <div>
          <span>INSPECTOR</span>
          <strong>{node?.controlId ?? node?.kind ?? "No selection"}</strong>
        </div>
        <div className="omni-window-actions">
          <button type="button" onClick={onPin} aria-pressed={pinned} title="Pin inspector">
            {pinned ? "PINNED" : "PIN"}
          </button>
          <button type="button" onClick={onShade} aria-expanded={!shaded} title="Shade inspector">
            {shaded ? "UNSHADE" : "SHADE"}
          </button>
        </div>
      </header>
      {!shaded ? (
        <div className="omni-inspector-body">
          {node ? (
            <>
              <div className="omni-inspector-status">
                <span data-kind={node.kind}>{node.kind}</span>
                {node.severity ? <span data-severity={node.severity}>{node.severity}</span> : null}
              </div>
              <h2>{node.label}</h2>
              <p>{node.detail ?? "Authoritative workspace object."}</p>
              <dl>
                <div><dt>Object</dt><dd>{node.id}</dd></div>
                {node.taskId ? <div><dt>Task</dt><dd>{node.taskId}</dd></div> : null}
                {node.agentId ? <div><dt>Owner</dt><dd>{node.agentId}</dd></div> : null}
                {node.controlId ? <div><dt>Control</dt><dd>{node.controlId}</dd></div> : null}
                <div><dt>First seen</dt><dd>event #{node.firstSequence}</dd></div>
                <div><dt>History</dt><dd>{node.eventSequences.map((sequence) => `#${sequence}`).join(" · ")}</dd></div>
              </dl>
              <div className="omni-inspector-command">
                <span>omni&gt;</span> explain {node.id}
              </div>
            </>
          ) : (
            <p>Select an object in the workspace.</p>
          )}
        </div>
      ) : null}
    </aside>
  );
}

export default function OmniWorkspacePage() {
  const [projection, setProjection] = useState<OmniProjection>("mission");
  const [revision, setRevision] = useState(SC7_WORKSPACE_EVENTS.length);
  const [selectedId, setSelectedId] = useState("contradiction:sc7-public-admin");
  const [inspectorShaded, setInspectorShaded] = useState(false);
  const [inspectorPinned, setInspectorPinned] = useState(false);

  const workspace = useMemo(
    () => composeOmniWorkspace(SC7_WORKSPACE_EVENTS, revision, projection),
    [projection, revision],
  );
  const nodeById = useMemo(() => new Map(workspace.nodes.map((node) => [node.id, node])), [workspace.nodes]);
  const selectedNode = nodeById.get(selectedId) ?? workspace.nodes[0];
  const activeEvent = workspace.events.at(-1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const projectionIndex = PROJECTIONS.findIndex((item) => item.key === event.key);
      if (projectionIndex >= 0) {
        event.preventDefault();
        setProjection(PROJECTIONS[projectionIndex].id);
        return;
      }
      if (event.key === "ArrowLeft" && projection === "replay") {
        setRevision((current) => Math.max(1, current - 1));
      }
      if (event.key === "ArrowRight" && projection === "replay") {
        setRevision((current) => Math.min(SC7_WORKSPACE_EVENTS.length, current + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projection]);

  return (
    <section className="omni-workspace-shell" aria-label="ACE Omni spatial workspace prototype">
      <header className="omni-workspace-masthead">
        <div>
          <span className="omni-eyebrow">ACE OMNI · SPATIAL WORKSPACE</span>
          <h1>Authorization readiness / SC-7</h1>
          <p>Demo fixture · runtime events determine geometry; the interface does not invent state.</p>
        </div>
        <div className="omni-mission-status" role="status">
          <span className="omni-live-dot" aria-hidden="true" />
          <strong>{workspace.revision === SC7_WORKSPACE_EVENTS.length ? "FINDING OPEN" : "REPLAYING"}</strong>
          <small>{workspace.nodes.length} objects · {workspace.edges.length} relations</small>
        </div>
      </header>

      <div className="omni-projection-bar" role="toolbar" aria-label="Workspace projections">
        {PROJECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-active={projection === item.id ? "true" : "false"}
            onClick={() => setProjection(item.id)}
            aria-pressed={projection === item.id}
          >
            <kbd>{item.key}</kbd>
            {item.label}
          </button>
        ))}
      </div>

      <div className="omni-command-strip">
        <span>omni&gt;</span>
        <strong>assess authorization readiness --focus SC-7</strong>
        <small>{activeEvent ? `event #${activeEvent.sequence} · ${activeEvent.type}` : "no events"}</small>
      </div>

      <div className="omni-workspace-grid">
        <aside className="omni-task-rail">
          <header className="omni-window-titlebar">
            <div><span>MISSION OBJECTS</span><strong>{projection.toUpperCase()}</strong></div>
          </header>
          <div className="omni-task-list">
            {workspace.nodes.filter((node) => node.kind === "task" || node.kind === "finding" || node.kind === "contradiction").map((node) => (
              <button
                key={node.id}
                type="button"
                data-kind={node.kind}
                data-active={selectedNode?.id === node.id ? "true" : "false"}
                onClick={() => setSelectedId(node.id)}
              >
                <span>{node.kind}</span>
                <strong>{node.label}</strong>
              </button>
            ))}
          </div>
          <div className="omni-rail-summary">
            <span>ACTIVE</span><strong>{workspace.nodes.filter((node) => node.kind === "task").length}</strong>
            <span>EVIDENCE</span><strong>{workspace.nodes.filter((node) => node.kind === "evidence").length}</strong>
            <span>NEEDS YOU</span><strong>{workspace.nodes.some((node) => node.kind === "finding") ? 1 : 0}</strong>
          </div>
        </aside>

        <section className="omni-map-window" aria-label={`${projection} map`}>
          <header className="omni-window-titlebar">
            <div>
              <span>COMPUTATION MAP</span>
              <strong>{projection.toUpperCase()} PROJECTION</strong>
            </div>
            <span className="omni-window-readout">rev {workspace.revision}/{SC7_WORKSPACE_EVENTS.length}</span>
          </header>
          <div className="omni-map-canvas">
            <div className="omni-map-gridlines" aria-hidden="true" />
            <svg className="omni-map-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="omni-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {workspace.edges.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={edge.id}
                    x1={from.position.x}
                    y1={from.position.y}
                    x2={to.position.x}
                    y2={to.position.y}
                    data-kind={edge.kind}
                    markerEnd="url(#omni-arrow)"
                  />
                );
              })}
            </svg>
            {workspace.nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                selected={selectedNode?.id === node.id}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </section>

        <Inspector
          node={selectedNode}
          shaded={inspectorShaded}
          pinned={inspectorPinned}
          onShade={() => setInspectorShaded((value) => !value)}
          onPin={() => setInspectorPinned((value) => !value)}
        />
      </div>

      <div className="omni-bottom-grid">
        <section className="omni-event-window">
          <header className="omni-window-titlebar">
            <div><span>EVENT BUS</span><strong>AUTHORITATIVE HISTORY</strong></div>
          </header>
          <ol>
            {workspace.events.slice(-5).map((event) => (
              <li key={event.sequence} data-alert={event.type === "contradiction.detected" || event.type === "finding.created" ? "true" : "false"}>
                <time>#{event.sequence.toString().padStart(2, "0")}</time>
                <code>{event.type}</code>
                <span>{eventSummary(event)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="omni-replay-window">
          <header className="omni-window-titlebar">
            <div><span>REPLAY</span><strong>DETERMINISTIC EVENT SCRUB</strong></div>
          </header>
          <div className="omni-replay-controls">
            <button type="button" onClick={() => setRevision((current) => Math.max(1, current - 1))} aria-label="Previous event">◀</button>
            <label>
              <span>Revision {revision} of {SC7_WORKSPACE_EVENTS.length}</span>
              <input
                type="range"
                min="1"
                max={SC7_WORKSPACE_EVENTS.length}
                step="1"
                value={revision}
                onChange={(event) => setRevision(Number(event.target.value))}
              />
            </label>
            <button type="button" onClick={() => setRevision((current) => Math.min(SC7_WORKSPACE_EVENTS.length, current + 1))} aria-label="Next event">▶</button>
            <button type="button" onClick={() => { setProjection("replay"); setRevision(SC7_WORKSPACE_EVENTS.length); }}>REPLAY MAP</button>
          </div>
        </section>
      </div>
    </section>
  );
}
