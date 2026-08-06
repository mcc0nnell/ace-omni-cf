import { useEffect, useState } from "react";
import type { ExperimentConfig } from "@ace-omni/domain";
import { api, type ExperimentSummary, type User } from "../lib/api";

function verticalSliceConfig(): ExperimentConfig {
  return {
    version: 1,
    trsType: "IP_CTS",
    participants: [
      {
        id: crypto.randomUUID(),
        name: "Synthetic caller",
        role: "caller",
        captions: { engine: "mock", baseDelayMs: 150, showFinalizedOnly: false },
        media: { audio: true, video: true },
      },
      {
        id: crypto.randomUUID(),
        name: "Synthetic callee",
        role: "callee",
        captions: { engine: "mock", baseDelayMs: 0, showFinalizedOnly: true },
        media: { audio: true, video: true },
      },
    ],
    timing: {
      callTimeoutSec: 120,
      mockCaptionIntervalMs: 1_500,
      scheduleLeadMs: 500,
    },
    manipulations: [
      {
        id: "caption-delay-caller",
        type: "caption_delay",
        targetRole: "caller",
        targetStream: "captions",
        startOffsetMs: 2_000,
        durationMs: 5_000,
        parameters: { delayMs: 500 },
        seed: 20_260_806,
      },
      {
        id: "outgoing-gain-callee",
        type: "gain",
        targetRole: "callee",
        targetStream: "outgoing",
        startOffsetMs: 3_000,
        durationMs: 4_000,
        parameters: { gainDb: -9 },
        seed: 20_260_807,
      },
    ],
    evidencePolicy: {
      microphoneAudio: true,
      receivedAudio: false,
      manipulatedAudio: false,
      localVideo: false,
      remoteVideo: false,
      rawCaptions: false,
      displayedCaptions: false,
      experimentEvents: true,
      maxArtifactBytes: 25 * 1024 * 1024,
      retentionDays: 365,
    },
    mockAsr: {
      utterances: [
        "This is synthetic speech for the ACE Omni relay experiment.",
        "The authoritative schedule controls this caption condition.",
        "No real participant data is used in this laboratory run.",
      ],
    },
  };
}

export default function DashboardPage({ user }: { user: User }) {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = () => api.listExperiments().then((response) => setExperiments(response.experiments));

  useEffect(() => {
    refresh().catch((reason: Error) => setError(reason.message));
  }, []);

  async function createSample() {
    setCreating(true);
    setError(null);
    try {
      await api.createExperiment({
        name: `Synthetic IP CTS study ${new Date().toISOString()}`,
        alias: `ip-cts-${crypto.randomUUID().slice(0, 8)}`,
        description: "Deterministic caption delay and audio gain conditions with mock ASR.",
        purpose: "Exercise the secure, auditable Omni vertical slice using synthetic media.",
        config: verticalSliceConfig(),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Experiments</h1>
          <p style={{ color: "var(--muted)", marginBottom: 0 }}>
            Signed in as {user.displayName}. All runs pin an immutable configuration version.
          </p>
        </div>
        <button
          type="button"
          data-testid="create-experiment"
          onClick={createSample}
          disabled={creating}
          style={{ padding: "0.55rem 1rem", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600 }}
        >
          {creating ? "Creating…" : "Create synthetic experiment"}
        </button>
      </div>

      {error && <div role="alert" style={{ marginBottom: "1rem", color: "var(--danger)" }}>{error}</div>}

      {experiments.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No experiments yet.</p>
      ) : (
        <ul data-testid="experiment-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
          {experiments.map((experiment) => (
            <li key={experiment.id} style={{ padding: "1rem 1.25rem", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <a href={`/experiments/${experiment.id}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                {experiment.name}
              </a>
              <div style={{ marginTop: 4, fontSize: "0.85rem", color: "var(--muted)" }}>
                {experiment.alias} · version {experiment.currentVersion} · {experiment.config.trsType}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
