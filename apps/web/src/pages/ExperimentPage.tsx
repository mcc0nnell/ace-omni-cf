import { useCallback, useEffect, useState } from "react";
import type { ExperimentConfig } from "@ace-omni/domain";
import { api, type ExperimentDetail } from "../lib/api";

const buttonStyle: React.CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
};

interface InvitationView {
  role: string;
  joinUrl: string;
  expiresAt: string;
}

export default function ExperimentPage({ id }: { id: string }) {
  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [calls, setCalls] = useState<Array<{
    id: string;
    name: string;
    state: string;
    experimentConfigVersion: number;
    createdAt: string;
  }>>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [detail, callList] = await Promise.all([api.getExperiment(id), api.listCalls(id)]);
    setExperiment(detail);
    setCalls(callList.calls);
  }, [id]);

  useEffect(() => {
    refresh().catch((reason: Error) => setError(reason.message));
  }, [refresh]);

  async function createVersion() {
    if (!experiment) return;
    setBusy(true);
    setError(null);
    try {
      const config: ExperimentConfig = {
        ...experiment.config,
        mockAsr: {
          utterances: [
            ...(experiment.config.mockAsr.utterances ?? []),
            `Synthetic version ${experiment.currentVersion + 1} verification utterance.`,
          ],
        },
      };
      await api.createExperimentVersion(
        experiment.id,
        config,
        `Explicit synthetic vertical-slice revision ${experiment.currentVersion + 1}`,
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createCallAndInvitations() {
    if (!experiment) return;
    setBusy(true);
    setError(null);
    setInvitations([]);
    try {
      const created = await api.createCall(
        experiment.id,
        `${experiment.name} — version ${experiment.currentVersion}`,
        experiment.currentVersion,
      );
      const issued = await api.issueInvitations(created.callId, 120);
      setCallId(created.callId);
      setInvitations(issued.invitations);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!experiment) return <p role="status">Loading experiment…</p>;

  return (
    <div>
      <p><a href="/">← Experiments</a></p>
      <h1>{experiment.name}</h1>
      <p style={{ color: "var(--muted)" }}>{experiment.description}</p>

      <section aria-labelledby="version-heading" style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem" }}>
        <h2 id="version-heading" style={{ marginTop: 0 }}>Immutable experiment versions</h2>
        <p data-testid="current-version">
          Current version: <strong>{experiment.currentVersion}</strong> · configuration SHA-256:{" "}
          <code>{experiment.versions[0]?.configSha256}</code>
        </p>
        <button data-testid="create-version" type="button" disabled={busy} onClick={createVersion} style={buttonStyle}>
          Create next immutable version
        </button>
        <ol>
          {experiment.versions.map((version) => (
            <li key={version.id}>
              v{version.version}: {version.revisionNote} ({version.configSha256.slice(0, 12)}…)
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="conditions-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="conditions-heading">Saved research conditions</h2>
        <ul>
          <li>TRS modality: {experiment.config.trsType}</li>
          <li>Roles: {experiment.config.participants.map((participant) => `${participant.name} (${participant.role})`).join(", ")}</li>
          <li>Caption engine: mock (no external credential)</li>
          <li>Manipulations: {experiment.config.manipulations.map((manipulation) => manipulation.id).join(", ")}</li>
          <li>Evidence: microphone audio={String(experiment.config.evidencePolicy.microphoneAudio)}, retention={experiment.config.evidencePolicy.retentionDays} days</li>
        </ul>
      </section>

      <section aria-labelledby="run-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="run-heading">Run pinned experiment</h2>
        <button
          data-testid="create-call"
          type="button"
          disabled={busy}
          onClick={createCallAndInvitations}
          style={buttonStyle}
        >
          {busy ? "Working…" : "Create call and single-use invitations"}
        </button>
        {error && <div role="alert" style={{ marginTop: "1rem", color: "var(--danger)" }}>{error}</div>}

        {callId && (
          <div data-testid="issued-call" style={{ marginTop: "1rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
            <p>Call ID: <code>{callId}</code></p>
            <ol>
              {invitations.map((invitation) => (
                <li key={invitation.role} style={{ marginBottom: "0.75rem" }}>
                  <strong>{invitation.role}</strong>:{" "}
                  <a
                    data-testid={`invite-${invitation.role}`}
                    href={invitation.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open secure invitation
                  </a>{" "}
                  <small>(expires {new Date(invitation.expiresAt).toLocaleString()})</small>
                </li>
              ))}
            </ol>
            <a href={`/research/calls/${callId}`}>Inspect call lifecycle</a>
          </div>
        )}
      </section>

      <section aria-labelledby="calls-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="calls-heading">Calls</h2>
        {calls.length === 0 ? <p>No calls yet.</p> : (
          <ul>
            {calls.map((call) => (
              <li key={call.id}>
                <a href={`/research/calls/${call.id}`}>{call.name}</a> — {call.state} — pinned v{call.experimentConfigVersion}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
