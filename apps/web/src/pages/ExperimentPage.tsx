import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";

const btnStyle: React.CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const [exp, setExp] = useState<any>(null);
  const [invites, setInvites] = useState<{ role: string; token: string; joinUrl: string }[]>([]);
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getExperiment(id)
      .then(setExp)
      .catch((e) => setError(e.message));
  }, [id]);

  async function issueInvites() {
    if (!exp) return;
    setBusy(true);
    setError(null);
    try {
      const results = [];
      for (const p of exp.config.participants) {
        const res = await api.createInvitation(exp.id, {
          participantConfigId: p.id || "0",
          role: p.role,
          ttlMinutes: 120,
        });
        results.push({ role: p.role, token: res.token, joinUrl: res.joinUrl });
      }
      setInvites(results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startCall() {
    if (!exp) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createCall(exp.id, `${exp.name} — live`);
      setCallId(res.callId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!exp) {
    return <p role="status">Loading experiment…</p>;
  }

  return (
    <div>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link to="/">← Experiments</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{exp.name}</h1>
      <p style={{ color: "var(--muted)" }}>{exp.description}</p>

      <section aria-labelledby="config-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="config-heading" style={{ fontSize: "1.1rem" }}>
          Configuration
        </h2>
        <ul>
          <li>TRS type: {exp.config.trsType}</li>
          <li>
            Participants:{" "}
            {exp.config.participants.map((p: any) => `${p.name} (${p.role})`).join(", ")}
          </li>
          <li>Manipulations: background noise, packet drop, caption delay</li>
          <li>
            Data collection: transcripts=
            {String(exp.config.dataCollection?.transcripts?.asrCaptionStream)}, audio=
            {String(exp.config.dataCollection?.audioRecordings?.microphone)}
          </li>
        </ul>
      </section>

      <section aria-labelledby="run-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="run-heading" style={{ fontSize: "1.1rem" }}>
          Run experiment
        </h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={issueInvites} disabled={busy} style={btnStyle}>
            Issue participant invitations
          </button>
          <button type="button" onClick={startCall} disabled={busy} style={btnStyle}>
            Create call room
          </button>
        </div>

        {error && (
          <div role="alert" style={{ marginTop: "1rem", color: "var(--danger)" }}>
            {error}
          </div>
        )}

        {invites.length > 0 && (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem" }}>
              Invitations (open each in a separate browser / profile)
            </h3>
            <ol>
              {invites.map((inv, i) => (
                <li key={i} style={{ marginBottom: "0.5rem" }}>
                  <strong>{inv.role}</strong>:{" "}
                  <a href={inv.joinUrl} target="_blank" rel="noreferrer">
                    {typeof window !== "undefined" ? window.location.origin : ""}
                    {inv.joinUrl}
                  </a>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--muted)",
                      wordBreak: "break-all",
                    }}
                  >
                    token: {inv.token}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {callId && (
          <div
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              background: "color-mix(in srgb, var(--success) 12%, transparent)",
              borderRadius: 8,
            }}
          >
            <p style={{ margin: 0 }}>
              Call room created: <code>{callId}</code>
            </p>
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
              After redeeming invitations, open{" "}
              <Link to={`/call/${callId}`}>/call/{callId}</Link> in each participant window.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
