/**
 * Local seed: administrator + sample experiment.
 * Outputs SQL for: wrangler d1 execute ace-omni-db --local --file=...
 */
import { hashPassword } from "../src/security";

async function main() {
  const password = "omni-admin-2026";
  const hash = await hashPassword(password);
  const adminId = "00000000-0000-4000-8000-000000000001";
  const now = new Date().toISOString();

  const config = {
    version: 1,
    trsType: "IP_CTS",
    participants: [
      {
        id: "p1",
        name: "Caller A",
        role: "caller",
        interface: { incomingAudio: { mono: false, balanceL: 0, balanceR: 0 } },
        audioStream: {
          backgroundNoise: { enabled: true, source: "white", gainDb: -15 },
          packetDrop: { enabled: false },
          filter: { enabled: false },
        },
        captions: {
          engine: "mock",
          showFinalizedOnly: false,
          punctuation: true,
          captionDelayMs: 500,
          errorSimulation: false,
        },
      },
      {
        id: "p2",
        name: "Callee B",
        role: "callee",
        interface: { incomingAudio: { mono: false, balanceL: 0, balanceR: 0 } },
        audioStream: {
          backgroundNoise: { enabled: false },
          packetDrop: { enabled: true, durationMs: 300, intervalMs: 8000 },
          filter: { enabled: true, type: "lowpass", frequencyHz: 3000 },
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

  console.log("-- Seed data for ACE Omni local development");
  console.log(`-- Admin credentials: admin@omni.local / ${password}`);
  console.log("");
  console.log(
    `INSERT OR REPLACE INTO users (id, email, display_name, role, password_hash, created_at, last_login_at)
VALUES ('${adminId}', 'admin@omni.local', 'Local Administrator', 'administrator', '${hash}', '${now}', NULL);`
  );

  const expId = "00000000-0000-4000-8000-000000000010";
  console.log(
    `INSERT OR REPLACE INTO experiments (id, name, alias, description, purpose, phase, config_json, created_by, modified_by, created_at, updated_at)
VALUES (
  '${expId}',
  'IP CTS Caption Delay Study',
  'ip-cts-delay-01',
  'Baseline IP Captioned Telephone Service experiment with deterministic caption delay and background noise.',
  'Measure impact of 500ms caption delay and mild background noise on communication effectiveness.',
  'active',
  '${JSON.stringify(config).replace(/'/g, "''")}',
  '${adminId}',
  '${adminId}',
  '${now}',
  '${now}'
);`
  );
}

main().catch(console.error);
