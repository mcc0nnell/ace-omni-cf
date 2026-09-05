import { access, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const TRIALS_DIR = new URL("../proving-grounds/trials/", import.meta.url);
const FIXTURES_DIR = new URL("../conformance/fixtures/", import.meta.url);
const GENERATED_DIR = new URL("../conformance/generated/", import.meta.url);
const ALLOWED_STATES = new Set(["planned", "runnable", "proven", "regressed"]);
const PINNED_BAUDOT_INTEROP_002 = Object.freeze({
  repository: "mcc0nnell/baudot",
  contractId: "BAUDOT-INTEROP-002",
  path: "testkit/gateways/rfc4103-rfc8865-equivalence-v1.json",
  mergedCommit: "8bf9bf07484ed5128a697ba002b7a965e7adf1a2",
  gitBlobSha: "e8ac8f52d4816949ba915db7c1ce42fe1cf3db31",
  digestAlgorithm: "sha256",
  digestCanonicalization:
    "canonical-json-v1: UTF-8 JSON, object keys sorted recursively, separators ',' and ':', no insignificant whitespace, Unicode emitted without ASCII escaping",
  digestValue: "fdae645768ac7c54a3ab41a1bf6c63b2649805c272c8882517030145209fd191",
});

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function comparable(trace) {
  return {
    terminalState: trace.terminalState,
    trace: trace.trace,
  };
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function validatePg004Pin(trial) {
  const contract = trial.externalContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("PG-004: externalContract must be an object");
  }
  if (contract.developmentReference !== undefined) {
    throw new Error("PG-004: mutable developmentReference must not be used after contract merge");
  }

  const actual = {
    repository: contract.repository,
    contractId: contract.contractId,
    path: contract.path,
    mergedCommit: contract.mergedCommit,
    gitBlobSha: contract.gitBlobSha,
    digestAlgorithm: contract.digest?.algorithm,
    digestCanonicalization: contract.digest?.canonicalization,
    digestValue: contract.digest?.value,
  };

  if (!isDeepStrictEqual(actual, PINNED_BAUDOT_INTEROP_002)) {
    throw new Error(
      `PG-004: Baudot contract identity diverged from the reviewed immutable pin: ${JSON.stringify(actual)}`,
    );
  }
  if (trial.status !== "planned") {
    throw new Error(
      "PG-004: immutable contract identity is pinned, but the trial must remain planned until the executable gateway evidence gates are satisfied",
    );
  }
}

const filenames = (await readdir(TRIALS_DIR)).filter((name) => name.endsWith(".json")).sort();
if (filenames.length === 0) throw new Error("ElixiPG has no trial manifests");

const seenIds = new Set();

for (const filename of filenames) {
  const trial = await loadJson(new URL(filename, TRIALS_DIR));

  requireString(trial.id, `${filename}: id`);
  requireString(trial.title, `${filename}: title`);
  requireString(trial.objective, `${filename}: objective`);

  if (!filename.startsWith(`${trial.id}-`)) {
    throw new Error(`${filename}: filename must begin with trial id ${trial.id}`);
  }
  if (seenIds.has(trial.id)) throw new Error(`Duplicate ElixiPG trial id: ${trial.id}`);
  seenIds.add(trial.id);

  if (!ALLOWED_STATES.has(trial.status)) {
    throw new Error(`${trial.id}: invalid trial status ${trial.status}`);
  }
  if (!Array.isArray(trial.assertions) || trial.assertions.length === 0) {
    throw new Error(`${trial.id}: assertions must be a non-empty array`);
  }

  if (trial.id === "PG-004") validatePg004Pin(trial);

  if (trial.status !== "proven") {
    console.log(`• ${trial.id} ${trial.title}: ${trial.status}`);
    continue;
  }

  if (!Array.isArray(trial.fixtures) || trial.fixtures.length === 0) {
    throw new Error(`${trial.id}: proven trials must declare fixtures`);
  }

  const runtimes = trial.evidence?.requiredRuntimes;
  if (!Array.isArray(runtimes) || runtimes.length < 2) {
    throw new Error(`${trial.id}: proven trials must declare at least two evidence runtimes`);
  }

  for (const fixture of trial.fixtures) {
    requireString(fixture, `${trial.id}: fixture`);
    await access(new URL(fixture, FIXTURES_DIR));

    let baseline = null;
    let baselineRuntime = null;

    for (const runtime of runtimes) {
      requireString(runtime, `${trial.id}: runtime`);
      const evidence = await loadJson(new URL(`${runtime}/${fixture}`, GENERATED_DIR));
      const semantic = comparable(evidence);

      if (baseline === null) {
        baseline = semantic;
        baselineRuntime = runtime;
      } else if (!isDeepStrictEqual(baseline, semantic)) {
        throw new Error(
          `${trial.id}: semantic evidence diverged for ${fixture}: ${baselineRuntime} ≠ ${runtime}`,
        );
      }
    }
  }

  console.log(
    `✓ ${trial.id} ${trial.title}: proven (${trial.fixtures.length} fixtures × ${runtimes.length} runtimes)`,
  );
}

for (const required of ["PG-001", "PG-002"]) {
  if (!seenIds.has(required)) throw new Error(`Missing foundational ElixiPG trial: ${required}`);
}

console.log(`ElixiPG registry valid: ${seenIds.size} trials.`);
