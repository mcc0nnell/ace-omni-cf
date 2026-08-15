import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeOscalPackage } from "./run-oscal-conformance.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "conformance", "oscal", "accessibility");
const GENERATED_PATH = join(
  ROOT,
  "conformance",
  "generated",
  "oscal",
  "accessibility-assurance-graph.json",
);

const EXPECTED_CONTROL_IDS = ["ax-1", "ax-2", "ax-3", "ax-4", "ax-5"];
const EXPECTED_OSCAL_VERSION = "1.2.2";

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

async function loadDocument(id, model, fileName) {
  const sourcePath = join("conformance", "oscal", "accessibility", fileName);
  const content = JSON.parse(await readFile(join(SOURCE_DIR, fileName), "utf8"));
  assert.deepEqual(
    Object.keys(content),
    [model],
    `${id}: artifact must use the standard OSCAL ${model} root and no parallel wrapper schema`,
  );
  const root = content[model];
  assert.ok(root && typeof root === "object", `${id}: missing OSCAL ${model} root`);
  assert.match(root.uuid ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(
    root.metadata?.["oscal-version"],
    EXPECTED_OSCAL_VERSION,
    `${id}: target OSCAL version drifted`,
  );
  return { id, model, sourcePath, content };
}

function collectControls(groups, output = []) {
  for (const group of groups ?? []) {
    for (const control of group.controls ?? []) output.push(control);
    collectControls(group.groups, output);
  }
  return output;
}

function collectParts(parts, output = []) {
  for (const part of parts ?? []) {
    output.push(part);
    collectParts(part.parts, output);
  }
  return output;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function requireKind(graph, kind) {
  assert.ok(
    graph.nodes.some((node) => node.kinds.includes(kind)),
    `accessibility OSCAL package did not produce required graph kind: ${kind}`,
  );
}

async function main() {
  const documents = await Promise.all([
    loadDocument("accessibility-catalog", "catalog", "accessibility-assurance-catalog.json"),
    loadDocument("federal-ict-profile", "profile", "federal-ict-profile.json"),
    loadDocument(
      "omni-accessibility-component",
      "component-definition",
      "omni-accessibility-component-definition.json",
    ),
  ]);

  const catalog = documents[0].content.catalog;
  const profile = documents[1].content.profile;
  const componentDefinition = documents[2].content["component-definition"];

  const controls = collectControls(catalog.groups);
  const catalogControlIds = sortedUnique(controls.map((control) => control.id));
  assert.deepEqual(catalogControlIds, EXPECTED_CONTROL_IDS, "AX catalog control set drifted");

  const catalogResourceIds = new Set(
    (catalog["back-matter"]?.resources ?? []).map((resource) => resource.uuid),
  );
  assert.ok(catalogResourceIds.size >= 5, "AX catalog must retain authoritative source resources");

  for (const control of controls) {
    const parts = collectParts(control.parts);
    assert.ok(
      parts.some((part) => part.name === "statement" && typeof part.prose === "string" && part.prose.trim()),
      `${control.id}: missing control statement`,
    );
    assert.ok(
      parts.some((part) => part.name === "objective" && typeof part.prose === "string" && part.prose.trim()),
      `${control.id}: missing assessment objective`,
    );
    const localAuthorityLinks = (control.links ?? [])
      .map((link) => link.href)
      .filter((href) => typeof href === "string" && href.startsWith("#"));
    assert.ok(localAuthorityLinks.length > 0, `${control.id}: missing source authority link`);
    for (const href of localAuthorityLinks) {
      assert.ok(
        catalogResourceIds.has(href.slice(1)),
        `${control.id}: authority link does not resolve to catalog back matter: ${href}`,
      );
    }
  }

  const selectedControlIds = sortedUnique(
    (profile.imports ?? []).flatMap((entry) =>
      (entry["include-controls"] ?? []).flatMap((selection) => selection["with-ids"] ?? []),
    ),
  );
  assert.deepEqual(
    selectedControlIds,
    EXPECTED_CONTROL_IDS,
    "federal ICT profile must select the complete AX control family",
  );
  assert.equal(
    profile.imports?.[0]?.href,
    "./accessibility-assurance-catalog.json",
    "profile must import the OSCAL catalog directly",
  );

  const components = componentDefinition.components ?? [];
  assert.equal(components.length, 1, "reference package expects one Omni accessibility component");
  const implementations = components.flatMap((component) => component["control-implementations"] ?? []);
  assert.ok(implementations.length > 0, "component definition must contain OSCAL control implementations");
  const implementedControlIds = sortedUnique(
    implementations.flatMap((implementation) =>
      (implementation["implemented-requirements"] ?? []).map((requirement) => requirement["control-id"]),
    ),
  );
  assert.deepEqual(
    implementedControlIds,
    EXPECTED_CONTROL_IDS,
    "Omni component definition must implement the selected AX controls by OSCAL control-id",
  );

  const graph = normalizeOscalPackage(documents);
  const reversed = normalizeOscalPackage([...documents].reverse());
  assert.equal(
    stableJson(graph),
    stableJson(reversed),
    "accessibility assurance graph changed when OSCAL document load order changed",
  );

  for (const kind of [
    "catalog",
    "profile",
    "component-definition",
    "component",
    "implemented-requirement",
    "control",
    "resource",
  ]) {
    requireKind(graph, kind);
  }

  for (const controlId of EXPECTED_CONTROL_IDS) {
    const nodeId = `control:${controlId}`;
    assert.ok(graph.nodes.some((node) => node.id === nodeId), `${controlId}: missing normalized control node`);
    assert.ok(
      graph.edges.some((edge) => edge.kind === "addresses" && edge.to === nodeId),
      `${controlId}: no OSCAL implementation claim addresses this control`,
    );
  }

  assert.ok(
    graph.edges.some((edge) => edge.kind === "references" && edge.scope === "local"),
    "catalog authority references were not preserved as local OSCAL graph edges",
  );
  assert.ok(
    graph.edges.some((edge) => edge.scope === "external"),
    "profile/component imports were not preserved as external OSCAL graph references",
  );

  const graphDigest = digest(graph);
  const output = {
    status: "experimental",
    oscalVersion: EXPECTED_OSCAL_VERSION,
    invariant:
      "Accessibility uses standard OSCAL artifacts; Omni executes and evidences the lifecycle without defining a parallel accessibility compliance schema.",
    controls: EXPECTED_CONTROL_IDS,
    graphDigest,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    graph,
  };

  await mkdir(dirname(GENERATED_PATH), { recursive: true });
  await writeFile(GENERATED_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log("✓ accessibility is represented as a native OSCAL control domain");
  console.log(`  controls ${EXPECTED_CONTROL_IDS.join(", ")}`);
  console.log(`  ${graph.nodes.length} nodes · ${graph.edges.length} edges`);
  console.log(`  SHA-256 ${graphDigest}`);
  console.log(`  output ${GENERATED_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
