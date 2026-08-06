/**
 * Idempotent, local-only synthetic seed for ACE Omni.
 * This file is not imported by the Worker production bundle.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ExperimentConfigSchema } from "@ace-omni/domain";
import { canonicalJson, hashPassword, sha256Hex } from "../src/security";

const RESEARCHER_ID = "00000000-0000-4000-8000-000000000001";
const EXPERIMENT_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const email = "researcher@omni.local";
const password = process.env.OMNI_SEED_PASSWORD ?? "local-only-synthetic-password";

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  if (process.env.ENVIRONMENT === "production" || process.argv.includes("--remote")) {
    throw new Error("The synthetic seed is local-only and refuses production or --remote execution");
  }
  const persistIndex = process.argv.indexOf("--persist-to");
  const persistTo = persistIndex >= 0 ? process.argv[persistIndex + 1] : undefined;
  if (persistIndex >= 0 && !persistTo) throw new Error("--persist-to requires a path");

  const config = ExperimentConfigSchema.parse({
    version: 1,
    trsType: "IP_CTS",
    participants: [
      { id: "00000000-0000-4000-8000-000000000011", name: "Synthetic caller", role: "caller", captions: { engine: "mock" } },
      { id: "00000000-0000-4000-8000-000000000012", name: "Synthetic callee", role: "callee", captions: { engine: "mock" } },
    ],
    timing: { callTimeoutSec: 120, mockCaptionIntervalMs: 1_500, scheduleLeadMs: 500 },
    manipulations: [
      {
        id: "seed-caption-delay",
        type: "caption_delay",
        targetRole: "caller",
        targetStream: "captions",
        startOffsetMs: 2_000,
        durationMs: 5_000,
        parameters: { delayMs: 500 },
        seed: 20_260_806,
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
    },
    mockAsr: { utterances: ["Synthetic seed caption; no participant data."] },
  });
  const configJson = canonicalJson(config);
  const configSha256 = await sha256Hex(configJson);
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const statements = `-- Local-only synthetic ACE Omni seed.\nPRAGMA foreign_keys = ON;\n
INSERT OR IGNORE INTO users (id, email, display_name, role, password_hash, created_at)
VALUES (${sql(RESEARCHER_ID)}, ${sql(email)}, 'Synthetic Researcher', 'researcher', ${sql(passwordHash)}, ${sql(now)});

INSERT OR IGNORE INTO experiments (
  id, name, alias, description, purpose, phase, config_json, current_version,
  created_by, modified_by, created_at, updated_at
) VALUES (
  ${sql(EXPERIMENT_ID)}, 'Synthetic IP CTS seed', 'synthetic-ip-cts-seed',
  'Local-only synthetic experiment for installation verification.',
  'Verify immutable experiment configuration without participant data.',
  'draft', ${sql(configJson)}, 1, ${sql(RESEARCHER_ID)}, ${sql(RESEARCHER_ID)}, ${sql(now)}, ${sql(now)}
);

INSERT OR IGNORE INTO experiment_versions (
  id, experiment_id, version, schema_version, config_json, config_sha256,
  revision_note, created_by, created_at
) VALUES (
  ${sql(VERSION_ID)}, ${sql(EXPERIMENT_ID)}, 1, 1, ${sql(configJson)}, ${sql(configSha256)},
  'Initial synthetic seed version', ${sql(RESEARCHER_ID)}, ${sql(now)}
);
`;

  const temporaryDirectory = await mkdtemp(`${tmpdir()}/ace-omni-seed-`);
  const seedPath = `${temporaryDirectory}/seed.sql`;
  try {
    await writeFile(seedPath, statements, { encoding: "utf8", mode: 0o600 });
    const workerRoot = fileURLToPath(new URL("..", import.meta.url));
    const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const wrangler = `${repositoryRoot}/node_modules/wrangler/bin/wrangler.js`;
    const args = [
      wrangler,
      "d1",
      "execute",
      "ace-omni-db",
      "--config",
      `${workerRoot}/wrangler.jsonc`,
      "--local",
      "--file",
      seedPath,
    ];
    if (persistTo) args.push("--persist-to", persistTo);
    const result = spawnSync(process.execPath, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CI: process.env.CI ?? "true",
        WRANGLER_SEND_METRICS: "false",
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? `${tmpdir()}/ace-omni-xdg-seed`,
      },
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Wrangler seed failed with status ${result.status}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(`Seeded local synthetic researcher ${email}. Password source: ${process.env.OMNI_SEED_PASSWORD ? "OMNI_SEED_PASSWORD" : "documented local-only default"}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
