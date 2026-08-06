import { useCallback, useEffect, useState } from "react";
import { api, type ResearchCallDetail } from "../lib/api";

export default function ResearchCallPage({ callId }: { callId: string }) {
  const [detail, setDetail] = useState<ResearchCallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!callId) return;
    setDetail(await api.getCall(callId));
  }, [callId]);

  useEffect(() => {
    void refresh().catch((reason: Error) => setError(reason.message));
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function finalize() {
    if (!callId) return;
    setBusy(true);
    setError(null);
    try {
      await api.finalizeCall(callId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function replay() {
    if (!callId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.replayCall(callId);
      window.location.assign(`/research/calls/${created.callId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  if (!detail) return <p role="status">Loading call evidence…</p>;
  const { call } = detail;

  return (
    <div>
      <p><a href={`/experiments/${call.experimentId}`}>← Experiment</a></p>
      <h1>{call.name}</h1>
      <p data-testid="research-call-state">
        State: <strong>{call.state}</strong> · pinned experiment version {call.experimentConfigVersion}<br />
        Configuration SHA-256: <code>{call.configSha256}</code>
      </p>
      {error && <div role="alert" style={{ color: "var(--omni-color-danger)" }}>{error}</div>}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button data-testid="finalize-call" type="button" disabled={busy || call.state !== "ended" || Boolean(detail.manifest)} onClick={finalize}>
          Generate immutable manifest
        </button>
        <button type="button" disabled={busy} onClick={replay}>Replay pinned version</button>
        <a href={`/api/calls/${call.id}/export`} download>Download research export</a>
        {detail.manifest && <a data-testid="manifest-download" href={`/api/calls/${call.id}/manifest`} download>Download evidence manifest</a>}
      </div>

      <section>
        <h2>Participants</h2>
        <ul>{detail.participants.map((participant) => (
          <li key={participant.id}>{participant.name} ({participant.role}) · joined {participant.joinedAt ?? "not joined"}</li>
        ))}</ul>
      </section>

      <section>
        <h2>Authorized evidence</h2>
        <p data-testid="artifact-count">{detail.artifacts.length} artifacts</p>
        <ul>{detail.artifacts.map((artifact) => (
          <li key={artifact.id}>
            <a href={`/api/calls/${call.id}/evidence/${artifact.id}`} download>{artifact.type}</a>
            {" "}· {artifact.sizeBytes} bytes · <code>{artifact.sha256.slice(0, 16)}…</code>
          </li>
        ))}</ul>
      </section>

      <section>
        <h2>Auditable events</h2>
        <p>{detail.events.length} immutable events</p>
        <ol>{detail.events.slice(-30).map((event) => (
          <li key={event.id}>#{event.sequence} {event.type} @ {event.callOffsetMs ?? "pre-clock"} ms</li>
        ))}</ol>
      </section>

      {detail.manifest && (
        <section data-testid="manifest-ready" style={{ padding: "1rem", border: "1px solid var(--omni-color-success)", borderRadius: 8 }}>
          <h2>Evidence manifest v{detail.manifest.version}</h2>
          <p>
            The manifest pins the exact experiment version, signed schedule, participants,
            event digest, recordings, checksums, and timestamps.
          </p>
          <code>{detail.manifest.eventsSha256}</code>
        </section>
      )}
    </div>
  );
}
