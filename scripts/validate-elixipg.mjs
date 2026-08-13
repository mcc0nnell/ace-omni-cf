import { access, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const ROOT_DIR = new URL("../", import.meta.url);
const TRIALS_DIR = new URL("../proving-grounds/trials/", import.meta.url);
const FIXTURES_DIR = new URL("../conformance/fixtures/", import.meta.url);
const GENERATED_DIR = new URL("../conformance/generated/", import.meta.url);
const ALLOWED_STATES = new Set(["planned", "runnable", "proven", "regressed"]);

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

function requireOrderedObservations(trial, observations, requiredTypes) {
  let cursor = 0;

  for (const required of requiredTypes) {
    requireString(required, `${trial.id}: required observation type`);

    const next = observations.findIndex(
      (observation, index) => index >= cursor && observation.type === required,
    );

    if (next === -1) {
      throw new Error(`${trial.id}: missing ordered observation ${required}`);
    }

    cursor = next + 1;
  }
}

async function validateArtifactEvidence(trial) {
  const contract = trial.evidence;
  requireString(contract.artifact, `${trial.id}: evidence artifact`);
  requireString(contract.requiredRuntime, `${trial.id}: required runtime`);
  requireString(contract.expectedTerminalState, `${trial.id}: expected terminal state`);
  requireString(contract.expectedVerdict, `${trial.id}: expected verdict`);

  if (!Array.isArray(contract.requiredObservationTypes) || contract.requiredObservationTypes.length === 0) {
    throw new Error(`${trial.id}: artifact-backed trial must declare required observation types`);
  }

  const artifact = await loadJson(new URL(contract.artifact, ROOT_DIR));

  if (artifact.trialId !== trial.id) {
    throw new Error(`${trial.id}: evidence identifies trial ${artifact.trialId}`);
  }
  if (artifact.runtime !== contract.requiredRuntime) {
    throw new Error(
      `${trial.id}: evidence runtime ${artifact.runtime} does not match ${contract.requiredRuntime}`,
    );
  }
  if (artifact.terminalState !== contract.expectedTerminalState) {
    throw new Error(
      `${trial.id}: terminal state ${artifact.terminalState} does not match ${contract.expectedTerminalState}`,
    );
  }
  if (artifact.verdict !== contract.expectedVerdict) {
    throw new Error(`${trial.id}: verdict ${artifact.verdict} does not match ${contract.expectedVerdict}`);
  }

  requireString(artifact.correlationId, `${trial.id}: evidence correlationId`);

  if (!Array.isArray(artifact.observations) || artifact.observations.length === 0) {
    throw new Error(`${trial.id}: evidence must contain observations`);
  }

  artifact.observations.forEach((observation, index) => {
    if (observation.sequence !== index + 1) {
      throw new Error(
        `${trial.id}: observation sequence must be contiguous; expected ${index + 1}, got ${observation.sequence}`,
      );
    }
    if (observation.correlationId !== artifact.correlationId) {
      throw new Error(
        `${trial.id}: observation ${observation.sequence} escaped trial correlation ${artifact.correlationId}`,
      );
    }
    requireString(observation.type, `${trial.id}: observation ${observation.sequence} type`);
    requireString(observation.source, `${trial.id}: observation ${observation.sequence} source`);
  });

  requireOrderedObservations(trial, artifact.observations, contract.requiredObservationTypes);

  return artifact;
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

  if (trial.evidence?.artifact) {
    if (trial.status === "planned") {
      throw new Error(`${trial.id}: planned trial must not claim an executable evidence artifact`);
    }

    const artifact = await validateArtifactEvidence(trial);
    console.log(
      `✓ ${trial.id} ${trial.title}: ${trial.status} artifact valid (${artifact.observations.length} observations, ${artifact.terminalState})`,
    );
    continue;
  }

  if (trial.status !== "proven") {
    console.log(`• ${trial.id} ${trial.title}: ${trial.status}`);
    continue;
  }

  if (!Array.isArray(trial.fixtures) || trial.fixtures.length === 0) {
    throw new Error(`${trial.id}: proven trials must declare fixtures or an evidence artifact`);
  }

  const runtimes = trial.evidence?.requiredRuntimes;
  if (!Array.isArray(runtimes) || runtimes.length < 2) {
    throw new Error(`${trial.id}: cross-runtime proven trials must declare at least two evidence runtimes`);
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
