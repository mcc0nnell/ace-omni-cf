import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function DashboardPage({ user }: { user: any }) {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .listExperiments()
      .then((r) => setExperiments(r.experiments))
      .catch((e) => setError(e.message));
  }, []);

  async function createSample() {
    setCreating(true);
    setError(null);
    try {
      const config = {
        version: 1,
        trsType: "IP_CTS",
        participants: [
          {
            id: "p1",
            name: "Caller",
            role: "caller",
            audioStream: {
              backgroundNoise: { enabled: true, source: "white", gainDb: -15 },
              packetDrop: { enabled: false },
              filter: { enabled: false },
            },
            captions: {
              engine: "mock",
              showFinalizedOnly: false,
              punctuation: true,
              captionDelayMs: 600,
            },
          },
          {
            id: "p2",
            name: "Callee",
            role: "callee",
            audioStream: {
              backgroundNoise: { enabled: false },
              packetDrop: { enabled: true, durationMs: 250, intervalMs: 7000 },
              filter: { enabled: false },
            },
            captions: {
              engine: "mock",
              showFinalizedOnly: true,
              punctuation: true,
              captionDelayMs: 0,
            },
          },
        ],
        dataCollection: {
          transcripts: { asrCaptionStream: true, rawAsr: true },
          audioRecordings: { microphone: true, received: true, manipulated: true },
          videoRecordings: { local: false, remote: false },
          screenRecordings: { enabled: false },
          experimentEvents: true,
        },
        callTimeoutSec: 600,
      };
      await api.createExperiment({
        name: `IP CTS Study ${new Date().toLocaleString()}`,
        alias: `ip-cts-${Date.now().toString(36)}`,
        description: "Deterministic caption delay + background noise experiment",
        purpose: "Vertical-slice demonstration of Omni research workflow",
        config,
      });
      const list = await api.listExperiments();
      setExperiments(list.experiments);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Experiments</h1>
        <button
          type="button"
          onClick={createSample}
          disabled={creating}
          style={{
            padding: "0.55rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: creating ? "wait" : "pointer",
          }}
        >
          {creating ? "Creating…" : "New sample experiment"}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: "1rem", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {experiments.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No experiments yet. Create a sample to begin the vertical slice.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {experiments.map((exp) => (
            <li
              key={exp.id}
              style={{
                padding: "1rem 1.25rem",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <Link
                to={`/experiments/${exp.id}`}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  fontWeight: 600,
                  fontSize: "1.05rem",
                }}
              >
                {exp.name}
              </Link>
              <div style={{ marginTop: 4, fontSize: "0.85rem", color: "var(--muted)" }}>
                {exp.alias} · {exp.phase} · {exp.config?.trsType ?? "CUSTOM"} ·{" "}
                {exp.config?.participants?.length ?? 0} participants
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
