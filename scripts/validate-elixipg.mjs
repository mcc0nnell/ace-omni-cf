import { access, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const TRIALS_DIR = new URL("../proving-grounds/trials/", import.meta.url);
const FIXTURES_DIR = new URL("../conformance/fixtures/", import.meta.url);
const GENERATED_DIR = new URL("../conformance/generated/", import.meta.url);
const ALLOWED_STATES = new Set(["planned", "runnable", "proven", "regressed"]);
const ALLOWED_MODES = new Set(["conformance", "discovery"]);

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

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  for (const item of value) requireString(item, label);
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateDiscoveryContract(trial) {
  const discovery = trial.discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) {
    throw new Error(`${trial.id}: discovery trials must declare a discovery contract`);
  }

  if (discovery.oracleVisibility !== "hidden") {
    throw new Error(`${trial.id}: discovery oracle must remain hidden from the agent`);
  }
  if (discovery.allowedActionPolicy !== "explicit-manifest-only") {
    throw new Error(`${trial.id}: discovery actions must be explicit-manifest-only`);
  }
  requireStringArray(discovery.allowedActionClasses, `${trial.id}: discovery allowedActionClasses`);
  requireString(discovery.authorityRule, `${trial.id}: discovery authorityRule`);
  requirePositiveInteger(discovery.budget?.maxExperiments, `${trial.id}: discovery maxExperiments`);
  requirePositiveInteger(discovery.budget?.maxResets, `${trial.id}: discovery maxResets`);

  if (discovery.hypothesisLedger?.required !== true || discovery.hypothesisLedger?.revisionHistory !== true) {
    throw new Error(`${trial.id}: discovery trials must preserve a hypothesis ledger and revision history`);
  }
  if (discovery.claimsRequireEvidence !== true) {
    throw new Error(`${trial.id}: discovery claims must require evidence`);
  }
  if (discovery.verdictAuthority !== "independent") {
    throw new Error(`${trial.id}: discovery verdict authority must be independent of the agent`);
  }
  requireStringArray(discovery.stoppingConditions, `${trial.id}: discovery stoppingConditions`);
}

async function validateProvenConformanceTrial(trial) {
  if (!Array.isArray(trial.fixtures) || trial.fixtures.length === 0) {
    throw new Error(`${trial.id}: proven conformance trials must declare fixtures`);
  }

  const runtimes = trial.evidence?.requiredRuntimes;
  if (!Array.isArray(runtimes) || runtimes.length < 2) {
    throw new Error(`${trial.id}: proven conformance trials must declare at least two evidence runtimes`);
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
    `✓ ${trial.id} ${trial.title}: proven conformance (${trial.fixtures.length} fixtures × ${runtimes.length} runtimes)`,
  );
}

async function validateProvenDiscoveryTrial(trial) {
  requireString(trial.evidence?.generatedRecord, `${trial.id}: proven discovery generatedRecord`);
  requireString(trial.evidence?.verdict, `${trial.id}: proven discovery verdict`);

  await access(new URL(trial.evidence.generatedRecord, GENERATED_DIR));
  await access(new URL(trial.evidence.verdict, GENERATED_DIR));

  console.log(`✓ ${trial.id} ${trial.title}: proven discovery (record + independent verdict)`);
}

const filenames = (await readdir(TRIALS_DIR)).filter((name) => name.endsWith(".json")).sort();
if (filenames.length === 0) throw new Error("Omni Proving Grounds has no trial manifests");

const seenIds = new Set();

for (const filename of filenames) {
  const trial = await loadJson(new URL(filename, TRIALS_DIR));

  requireString(trial.id, `${filename}: id`);
  requireString(trial.title, `${filename}: title`);
  requireString(trial.objective, `${filename}: objective`);
  requireString(trial.mode, `${filename}: mode`);

  if (!filename.startsWith(`${trial.id}-`)) {
    throw new Error(`${filename}: filename must begin with trial id ${trial.id}`);
  }
  if (seenIds.has(trial.id)) throw new Error(`Duplicate proving-ground trial id: ${trial.id}`);
  seenIds.add(trial.id);

  if (!ALLOWED_STATES.has(trial.status)) {
    throw new Error(`${trial.id}: invalid trial status ${trial.status}`);
  }
  if (!ALLOWED_MODES.has(trial.mode)) {
    throw new Error(`${trial.id}: invalid trial mode ${trial.mode}`);
  }
  if (!Array.isArray(trial.assertions) || trial.assertions.length === 0) {
    throw new Error(`${trial.id}: assertions must be a non-empty array`);
  }

  if (trial.mode === "discovery") validateDiscoveryContract(trial);

  if (trial.status !== "proven") {
    console.log(`• ${trial.id} ${trial.title}: ${trial.mode}/${trial.status}`);
    continue;
  }

  if (trial.mode === "conformance") {
    await validateProvenConformanceTrial(trial);
  } else {
    await validateProvenDiscoveryTrial(trial);
  }
}

for (const required of ["PG-001", "PG-002", "PG-003"]) {
  if (!seenIds.has(required)) throw new Error(`Missing foundational proving-ground trial: ${required}`);
}

console.log(`Omni Proving Grounds registry valid: ${seenIds.size} trials.`);
