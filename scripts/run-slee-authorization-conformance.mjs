import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_PATH = join(ROOT, "conformance", "authorization", "slee-iato-profile.json");
const GENERATED_PATH = join(ROOT, "conformance", "generated", "authorization", "slee-iato-profile.json");

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function readRepoText(path) {
  return readFile(join(ROOT, path), "utf8");
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) throw new Error(message);
}

function rejectText(text, needle, message) {
  if (text.includes(needle)) throw new Error(message);
}

async function main() {
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));

  if (profile.status !== "candidate-not-authorized") {
    throw new Error("Authorization profile must remain explicitly non-authorizing");
  }
  if (!Array.isArray(profile.claims) || profile.claims.length === 0) {
    throw new Error("Authorization profile must contain testable claims");
  }
  if (!Array.isArray(profile.authorizationGaps) || profile.authorizationGaps.length === 0) {
    throw new Error("Authorization profile must retain unresolved authorization gaps");
  }
  if (!profile.authorizationGaps.some((gap) => gap.severity === "blocking")) {
    throw new Error("Candidate profile must identify at least one blocking authorization gap");
  }

  const claimIds = new Set();
  for (const claim of profile.claims) {
    if (!claim.id || claimIds.has(claim.id)) throw new Error(`Duplicate or missing claim id: ${claim.id}`);
    claimIds.add(claim.id);
    if (!claim.statement || !Array.isArray(claim.evidence) || claim.evidence.length === 0) {
      throw new Error(`${claim.id}: claim must contain a statement and evidence`);
    }
    for (const evidencePath of claim.evidence) {
      await readRepoText(evidencePath);
    }
  }

  const sbbPath = "ports/jain-slee/src/main/java/org/aceomni/slee/OmniCallSbb.java";
  const raPath = "ports/jain-slee/src/main/java/org/aceomni/slee/OmniTransportRaSbbInterface.java";
  const statePath = "ports/jain-slee/src/main/java/org/aceomni/slee/OmniRunState.java";
  const [sbb, ra, state] = await Promise.all([
    readRepoText(sbbPath),
    readRepoText(raPath),
    readRepoText(statePath),
  ]);

  for (const banned of [
    "import java.net.",
    "java.net.http",
    "Socket(",
    "HttpClient",
    "WebSocket",
    "URLConnection",
  ]) {
    rejectText(sbb, banned, `SBB acquired a direct network-I/O primitive: ${banned}`);
  }

  requireText(sbb, "OmniTransportRaSbbInterface transport", "SBB no longer holds the explicit RA contract");
  requireText(sbb, "requireTransport().execute(", "SBB no longer routes effects through the RA contract");
  requireText(ra, "void execute(OmniCommand command);", "RA interface no longer exposes the canonical OmniCommand effect boundary");
  requireText(sbb, "!getRunId().equals(event.runId()) || !getActivityId().equals(event.activityId())", "Run/activity correlation guard is missing");
  requireText(sbb, "if (!seen.add(event.eventId()))", "Event idempotence guard is missing");
  requireText(sbb, "if (current.isTerminal())", "Terminal-state short circuit is missing");
  requireText(state, "return this == COMPLETED || this == FAILED;", "COMPLETED/FAILED terminal-state invariant changed");

  const oscalGraph = JSON.parse(await readFile(join(ROOT, profile.oscal.generatedGraph), "utf8"));
  const availableKinds = new Set(Object.keys(oscalGraph.kindCounts ?? {}));
  for (const kind of profile.oscal.requiredAuthorizationPackageKinds) {
    if (!availableKinds.has(kind)) {
      throw new Error(`OSCAL authorization package graph is missing required kind: ${kind}`);
    }
  }

  const result = {
    profileId: profile.profileId,
    status: profile.status,
    profileSha256: digest(profile),
    checkedClaims: profile.claims.map((claim) => claim.id).sort(),
    blockingGaps: profile.authorizationGaps
      .filter((gap) => gap.severity === "blocking")
      .map((gap) => gap.id)
      .sort(),
    runtimeBoundary: {
      behaviorAuthority: profile.runtime.behaviorAuthority,
      effectBoundary: profile.runtime.effectBoundary,
      boundaryRule: profile.runtime.boundaryRule,
    },
    oscalGraphSha256: oscalGraph.graphDigest,
    decision: "candidate-invariants-pass-not-an-authorization",
  };

  await mkdir(dirname(GENERATED_PATH), { recursive: true });
  await writeFile(GENERATED_PATH, `${JSON.stringify(result, null, 2)}\n`);

  console.log("✓ SLEE authorization candidate invariants preserved");
  console.log(`  ${result.checkedClaims.length} claims checked`);
  console.log(`  ${result.blockingGaps.length} blocking authorization gaps retained`);
  console.log(`  profile SHA-256 ${result.profileSha256}`);
  console.log("  decision candidate-invariants-pass-not-an-authorization");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
