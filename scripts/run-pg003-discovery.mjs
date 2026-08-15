import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

const ORACLE_RULES = Object.freeze({
  userCanWrite: true,
  userCanDelete: false,
  lockedBlocksRead: true,
  downgradeRevokesSession: true,
});

const COMMAND_BOUNDARY = Object.freeze({
  adapterId: "synthetic-authz-world",
  capability: "sut.authz.probe",
  operation: "PROBE_AUTHZ",
});

const EXPERIMENTS = Object.freeze([
  { id: "admin_delete", probe: "admin_delete", command: COMMAND_BOUNDARY },
  { id: "admin_write", probe: "admin_write", command: COMMAND_BOUNDARY },
  { id: "locked_read", probe: "locked_read", command: COMMAND_BOUNDARY },
  { id: "post_downgrade_delete", probe: "post_downgrade_delete", command: COMMAND_BOUNDARY },
  { id: "unlocked_read", probe: "unlocked_read", command: COMMAND_BOUNDARY },
  { id: "user_delete", probe: "user_delete", command: COMMAND_BOUNDARY },
  { id: "user_read", probe: "user_read", command: COMMAND_BOUNDARY },
  { id: "user_write", probe: "user_write", command: COMMAND_BOUNDARY },
]);

function evaluateRules(rules, probe) {
  switch (probe) {
    case "admin_delete":
    case "admin_write":
    case "unlocked_read":
    case "user_read":
      return "allowed";
    case "user_write":
      return rules.userCanWrite ? "allowed" : "denied";
    case "user_delete":
      return rules.userCanDelete ? "allowed" : "denied";
    case "locked_read":
      return rules.lockedBlocksRead ? "denied" : "allowed";
    case "post_downgrade_delete":
      return rules.downgradeRevokesSession ? "denied" : "allowed";
    default:
      throw new Error(`Unknown probe ${probe}`);
  }
}

function enumerateHypotheses() {
  const hypotheses = [];
  for (let bits = 0; bits < 16; bits += 1) {
    hypotheses.push({
      id: `H-${bits.toString(16).padStart(2, "0")}`,
      rules: {
        userCanWrite: Boolean(bits & 1),
        userCanDelete: Boolean(bits & 2),
        lockedBlocksRead: Boolean(bits & 4),
        downgradeRevokesSession: Boolean(bits & 8),
      },
    });
  }
  return hypotheses;
}

function informationScore(hypotheses, experiment) {
  const groups = new Map();
  for (const hypothesis of hypotheses) {
    const outcome = evaluateRules(hypothesis.rules, experiment.probe);
    groups.set(outcome, (groups.get(outcome) ?? 0) + 1);
  }
  if (groups.size < 2) return -1;
  const total = hypotheses.length;
  let entropy = 0;
  for (const count of groups.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function createHiddenWorld(oracleRules) {
  const authorized = new Map(EXPERIMENTS.map((experiment) => [experiment.id, experiment]));
  return Object.freeze({
    oracleDigest: digest(oracleRules),
    execute(requestedExperiment) {
      const manifestExperiment = authorized.get(requestedExperiment.id);
      if (!manifestExperiment) throw new Error(`Unauthorized experiment ${requestedExperiment.id}`);
      if (stableJson(requestedExperiment.command) !== stableJson(COMMAND_BOUNDARY)) {
        throw new Error(`Experiment ${requestedExperiment.id} attempted to bypass the canonical command boundary`);
      }
      const outcome = evaluateRules(oracleRules, manifestExperiment.probe);
      return {
        experimentId: manifestExperiment.id,
        command: manifestExperiment.command,
        commandDigest: digest(manifestExperiment.command),
        outcome,
        observationDigest: digest({ experimentId: manifestExperiment.id, outcome }),
      };
    },
  });
}

function evidenceForRule(ruleName, ledger) {
  const experimentByRule = {
    userCanWrite: "user_write",
    userCanDelete: "user_delete",
    lockedBlocksRead: "locked_read",
    downgradeRevokesSession: "post_downgrade_delete",
  };
  const experimentId = experimentByRule[ruleName];
  const row = ledger.find((entry) => entry.experimentId === experimentId);
  if (!row) throw new Error(`No evidence experiment for discovered rule ${ruleName}`);
  return [row.evidenceId];
}

function discover({ experiments, execute, maxExperiments }) {
  let hypotheses = enumerateHypotheses();
  const ledger = [];
  const unused = new Map(experiments.map((experiment) => [experiment.id, experiment]));

  while (hypotheses.length > 1) {
    if (ledger.length >= maxExperiments) throw new Error("Discovery experiment budget exhausted");

    const ranked = [...unused.values()]
      .map((experiment) => ({ experiment, score: informationScore(hypotheses, experiment) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score || a.experiment.id.localeCompare(b.experiment.id));

    if (ranked.length === 0) throw new Error("No authorized experiment can distinguish remaining hypotheses");

    const selected = ranked[0].experiment;
    unused.delete(selected.id);
    const before = hypotheses.length;
    const observation = execute(selected);
    hypotheses = hypotheses.filter(
      (hypothesis) => evaluateRules(hypothesis.rules, selected.probe) === observation.outcome,
    );
    if (hypotheses.length === 0) throw new Error("Observation eliminated every hypothesis");

    ledger.push({
      sequence: ledger.length + 1,
      evidenceId: `PG-003-E-${String(ledger.length + 1).padStart(3, "0")}`,
      experimentId: selected.id,
      command: observation.command,
      commandDigest: observation.commandDigest,
      observation: observation.outcome,
      observationDigest: observation.observationDigest,
      candidateCountBefore: before,
      candidateCountAfter: hypotheses.length,
      eliminated: before - hypotheses.length,
    });
  }

  const discovered = hypotheses[0];
  const claims = Object.entries(discovered.rules).map(([rule, value]) => ({
    rule,
    value,
    evidenceIds: evidenceForRule(rule, ledger),
  }));

  return {
    hypothesisSpaceSize: 16,
    experimentCount: ledger.length,
    maxExperiments,
    finalHypothesisId: discovered.id,
    discoveredRules: discovered.rules,
    discoveredRulesDigest: digest(discovered.rules),
    ledger,
    claims,
  };
}

function independentlyGrade({ oracleRules, oracleDigest, discovery }) {
  const boundaryDigest = digest(COMMAND_BOUNDARY);
  const boundaryPreserved = discovery.ledger.every(
    (entry) => entry.commandDigest === boundaryDigest && stableJson(entry.command) === stableJson(COMMAND_BOUNDARY),
  );
  const everyClaimHasEvidence = discovery.claims.every(
    (claim) => Array.isArray(claim.evidenceIds) && claim.evidenceIds.length > 0,
  );
  const exactDiscovery = stableJson(discovery.discoveredRules) === stableJson(oracleRules);
  const withinBudget = discovery.experimentCount <= discovery.maxExperiments;
  const pass = exactDiscovery && boundaryPreserved && everyClaimHasEvidence && withinBudget;

  return {
    authority: "independent-deterministic-grader",
    oracleDigest,
    discoveredRulesDigest: discovery.discoveredRulesDigest,
    checks: {
      exactDiscovery,
      boundaryPreserved,
      everyClaimHasEvidence,
      withinBudget,
    },
    verdict: pass ? "pass" : "fail",
  };
}

const world = createHiddenWorld(ORACLE_RULES);
const discovery = discover({
  experiments: EXPERIMENTS,
  execute: (experiment) => world.execute(experiment),
  maxExperiments: 8,
});
const verdict = independentlyGrade({
  oracleRules: ORACLE_RULES,
  oracleDigest: world.oracleDigest,
  discovery,
});
if (verdict.verdict !== "pass") throw new Error(`PG-003 independent verdict failed: ${stableJson(verdict.checks)}`);

const record = {
  schemaVersion: 1,
  trialId: "PG-003",
  mode: "discovery",
  world: "synthetic-authz-hidden-rules-v1",
  oracleVisibility: "hidden",
  oracleDigest: world.oracleDigest,
  allowedActionPolicy: "explicit-manifest-only",
  commandBoundary: COMMAND_BOUNDARY,
  discovery,
  recordDigest: digest({ trialId: "PG-003", oracleDigest: world.oracleDigest, discovery }),
};

const outDir = new URL("../conformance/generated/discovery/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(new URL("PG-003-record.json", outDir), `${JSON.stringify(record, null, 2)}\n`);
await writeFile(new URL("PG-003-verdict.json", outDir), `${JSON.stringify(verdict, null, 2)}\n`);

console.log(`✓ PG-003 discovered ${Object.keys(discovery.discoveredRules).length} hidden rules in ${discovery.experimentCount} experiments`);
console.log("  hypothesis space 16 → 1");
console.log(`  oracle SHA-256 ${world.oracleDigest}`);
console.log(`  verdict ${verdict.verdict}`);
console.log(`  checks ${stableJson(verdict.checks)}`);
