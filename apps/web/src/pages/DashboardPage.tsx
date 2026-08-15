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
    <section className="atlas-workbench" aria-labelledby="experiment-folders-heading">
      <div className="atlas-workbench-header">
        <div>
          <p className="atlas-kicker">Scenario archive</p>
          <h1 id="experiment-folders-heading">Experiment folders</h1>
          <p className="atlas-workbench-summary">
            Signed in as {user.displayName}. Each folder pins an immutable configuration version and preserves its evidence trail.
          </p>
        </div>
        <button
          type="button"
          data-testid="create-experiment"
          onClick={createSample}
          disabled={creating}
          className="atlas-primary-action"
        >
          {creating ? "Creating…" : "Create synthetic experiment"}
        </button>
      </div>

      {error && <div role="alert" className="atlas-alert" data-material="paper">{error}</div>}

      {experiments.length === 0 ? (
        <div className="atlas-empty-folder" data-material="paper" data-age="fresh">
          <p className="atlas-empty-title">No experiment folders yet.</p>
          <p>Create a synthetic experiment to establish the first immutable configuration and evidence record.</p>
        </div>
      ) : (
        <ul data-testid="experiment-list" className="atlas-folder-stack">
          {experiments.map((experiment) => (
            <li key={experiment.id} className="atlas-folder" data-material="cardstock" data-age="fresh">
              <div className="atlas-folder-tab" aria-hidden="true">Scenario folder</div>
              <a href={`/experiments/${experiment.id}`} className="atlas-folder-title">
                {experiment.name}
              </a>
              <dl className="atlas-folder-metadata">
                <div><dt>Alias</dt><dd>{experiment.alias}</dd></div>
                <div><dt>Version</dt><dd>{experiment.currentVersion}</dd></div>
                <div><dt>Mode</dt><dd>{experiment.config.trsType}</dd></div>
              </dl>
              <div className="atlas-provenance-strip" aria-label="Evidence state">
                <span className="atlas-stamp">PINNED</span>
                <span>Immutable configuration version</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
