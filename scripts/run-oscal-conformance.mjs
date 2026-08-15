import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "conformance", "oscal", "fixtures.json");
const GENERATED_PATH = join(ROOT, "conformance", "generated", "oscal", "ifa-graph.json");
const OSCAL_CONTENT_DIR = process.env.OSCAL_CONTENT_DIR
  ? resolve(process.env.OSCAL_CONTENT_DIR)
  : resolve(ROOT, ".oscal-content-upstream");

const KIND_ALIASES = new Map([
  ["system-security-plan", "system-security-plan"],
  ["assessment-plan", "assessment-plan"],
  ["assessment-results", "assessment-results"],
  ["plan-of-action-and-milestones", "plan-of-action-and-milestones"],
  ["implemented-requirements", "implemented-requirement"],
  ["implemented-requirement", "implemented-requirement"],
  ["components", "component"],
  ["component", "component"],
  ["observations", "observation"],
  ["observation", "observation"],
  ["findings", "finding"],
  ["finding", "finding"],
  ["risks", "risk"],
  ["risk", "risk"],
  ["activities", "activity"],
  ["activity", "activity"],
  ["subjects", "subject"],
  ["subject", "subject"],
  ["assessment-assets", "assessment-assets"],
  ["parties", "party"],
  ["party", "party"],
  ["resources", "resource"],
  ["resource", "resource"],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
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

function inferKind(containerKey) {
  const alias = KIND_ALIASES.get(containerKey);
  if (alias) return alias;
  const singular = containerKey.endsWith("s") ? containerKey.slice(0, -1) : containerKey;
  return singular || "object";
}

function bestLabel(value, fallback) {
  for (const key of ["title", "name", "description", "summary", "control-id"]) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().replace(/\s+/g, " ");
  }
  return fallback;
}

function makeCollector() {
  return {
    nodes: new Map(),
    edges: new Map(),
  };
}

function mergeNode(collector, input) {
  const prior = collector.nodes.get(input.id);
  if (!prior) {
    collector.nodes.set(input.id, {
      id: input.id,
      kinds: new Set([input.kind]),
      labels: new Set(input.label ? [input.label] : []),
      sources: new Set([input.sourceDocument]),
      paths: new Set([input.path]),
    });
    return;
  }
  prior.kinds.add(input.kind);
  if (input.label) prior.labels.add(input.label);
  prior.sources.add(input.sourceDocument);
  prior.paths.add(input.path);
}

function addEdge(collector, edge) {
  const id = digest({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    sourceDocument: edge.sourceDocument,
    path: edge.path,
    field: edge.field,
  }).slice(0, 24);
  collector.edges.set(`edge:${id}`, { id: `edge:${id}`, ...edge });
}

function ensureControlNode(collector, controlId, sourceDocument, path) {
  const id = `control:${controlId}`;
  mergeNode(collector, {
    id,
    kind: "control",
    label: controlId,
    sourceDocument,
    path,
  });
  return id;
}

function ensureExternalNode(collector, href, sourceDocument, path) {
  const id = `external:${href}`;
  mergeNode(collector, {
    id,
    kind: "external-reference",
    label: href,
    sourceDocument,
    path,
  });
  return id;
}

function referenceField(key) {
  return (
    key !== "uuid" &&
    (key.endsWith("-uuid") ||
      key.endsWith("-uuids") ||
      key === "uuid-ref" ||
      key.endsWith("-uuid-ref") ||
      key.endsWith("-uuid-refs"))
  );
}

function stringValues(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  }
  return [];
}

function walkOscal(value, context, collector) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkOscal(item, { ...context, path: `${context.path}[${index}]` }, collector),
    );
    return;
  }
  if (!isObject(value)) return;

  const explicitUuid = typeof value.uuid === "string" && value.uuid.trim() ? value.uuid.trim() : null;
  const ownNodeId = explicitUuid ? `uuid:${explicitUuid}` : context.parentNodeId;

  if (explicitUuid) {
    mergeNode(collector, {
      id: ownNodeId,
      kind: inferKind(context.containerKey),
      label: bestLabel(value, explicitUuid),
      sourceDocument: context.sourceDocument,
      path: context.path,
    });
    if (context.parentNodeId && context.parentNodeId !== ownNodeId) {
      addEdge(collector, {
        from: context.parentNodeId,
        to: ownNodeId,
        kind: "contains",
        sourceDocument: context.sourceDocument,
        path: context.path,
        field: context.containerKey,
        scope: "local",
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${context.path}.${key}`;

    if (key === "control-id" && typeof child === "string" && child.trim() && ownNodeId) {
      const controlNode = ensureControlNode(collector, child.trim(), context.sourceDocument, fieldPath);
      addEdge(collector, {
        from: ownNodeId,
        to: controlNode,
        kind: "addresses",
        sourceDocument: context.sourceDocument,
        path: fieldPath,
        field: key,
        scope: "package",
      });
    }

    if (referenceField(key) && ownNodeId) {
      for (const reference of stringValues(child)) {
        addEdge(collector, {
          from: ownNodeId,
          to: `uuid:${reference}`,
          kind: "references",
          sourceDocument: context.sourceDocument,
          path: fieldPath,
          field: key,
          scope: "package",
        });
      }
    }

    if (key === "href" && typeof child === "string" && child.trim() && ownNodeId) {
      const href = child.trim();
      if (href.startsWith("#")) {
        addEdge(collector, {
          from: ownNodeId,
          to: `uuid:${href.slice(1)}`,
          kind: "references",
          sourceDocument: context.sourceDocument,
          path: fieldPath,
          field: key,
          scope: "local",
        });
      } else {
        const target = ensureExternalNode(collector, href, context.sourceDocument, fieldPath);
        addEdge(collector, {
          from: ownNodeId,
          to: target,
          kind: context.containerKey.startsWith("import-") ? "imports" : "references",
          sourceDocument: context.sourceDocument,
          path: fieldPath,
          field: key,
          scope: "external",
        });
      }
    }

    walkOscal(
      child,
      {
        sourceDocument: context.sourceDocument,
        parentNodeId: ownNodeId,
        containerKey: key,
        path: fieldPath,
      },
      collector,
    );
  }
}

function finalizeGraph(collector, documents) {
  const nodes = [...collector.nodes.values()]
    .map((node) => ({
      id: node.id,
      kinds: [...node.kinds].sort(),
      label: [...node.labels].sort()[0] ?? node.id,
      sources: [...node.sources].sort(),
      paths: [...node.paths].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges = [...collector.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    documents: [...documents].sort((a, b) => a.id.localeCompare(b.id)),
    nodes,
    edges,
  };
}

function validateGraph(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set();

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate graph edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.from)) throw new Error(`Graph edge source is missing: ${edge.from}`);
    if (!nodeById.has(edge.to)) {
      if (edge.scope === "local") {
        throw new Error(`Unresolved local OSCAL reference ${edge.to} at ${edge.path}`);
      }
      continue;
    }
    if (edge.scope === "local" && edge.to.startsWith("uuid:")) {
      const target = nodeById.get(edge.to);
      if (!target.sources.includes(edge.sourceDocument)) {
        throw new Error(`Local OSCAL reference escapes document scope: ${edge.to} at ${edge.path}`);
      }
    }
  }
}

export function normalizeOscalPackage(documents) {
  const collector = makeCollector();
  const summaries = [];

  for (const document of documents) {
    const rootValue = document.content?.[document.model];
    if (!isObject(rootValue)) {
      throw new Error(`${document.id}: expected OSCAL root ${document.model}`);
    }
    summaries.push({
      id: document.id,
      model: document.model,
      sourcePath: document.sourcePath,
      rootUuid: typeof rootValue.uuid === "string" ? rootValue.uuid : null,
    });
    walkOscal(
      rootValue,
      {
        sourceDocument: document.id,
        parentNodeId: null,
        containerKey: document.model,
        path: document.model,
      },
      collector,
    );
  }

  const graph = finalizeGraph(collector, summaries);
  validateGraph(graph);
  return graph;
}

async function loadManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

async function loadPinnedDocuments(manifest) {
  const documents = [];
  for (const fixture of manifest.documents) {
    const path = join(OSCAL_CONTENT_DIR, fixture.path);
    const content = JSON.parse(await readFile(path, "utf8"));
    documents.push({ ...fixture, sourcePath: fixture.path, content });
  }
  return documents;
}

function requireKind(graph, kind) {
  if (!graph.nodes.some((node) => node.kinds.includes(kind))) {
    throw new Error(`NIST OSCAL package did not produce required graph kind: ${kind}`);
  }
}

function requireEdgeKind(graph, kind) {
  if (!graph.edges.some((edge) => edge.kind === kind)) {
    throw new Error(`NIST OSCAL package did not produce required graph edge: ${kind}`);
  }
}

async function main() {
  const manifest = await loadManifest();
  const documents = await loadPinnedDocuments(manifest);
  const graph = normalizeOscalPackage(documents);
  const reversed = normalizeOscalPackage([...documents].reverse());

  if (stableJson(graph) !== stableJson(reversed)) {
    throw new Error("OSCAL normalized graph changed when fixture load order changed");
  }

  for (const kind of [
    "system-security-plan",
    "assessment-plan",
    "assessment-results",
    "plan-of-action-and-milestones",
    "implemented-requirement",
    "component",
    "observation",
    "finding",
    "risk",
    "control",
  ]) {
    requireKind(graph, kind);
  }

  for (const edgeKind of ["contains", "addresses", "references", "imports"]) {
    requireEdgeKind(graph, edgeKind);
  }

  if (graph.nodes.length < 25 || graph.edges.length < 25) {
    throw new Error(`OSCAL graph unexpectedly small: ${graph.nodes.length} nodes / ${graph.edges.length} edges`);
  }

  const syntheticBroken = {
    id: "broken-local-reference",
    model: "system-security-plan",
    sourcePath: "synthetic",
    content: {
      "system-security-plan": {
        uuid: "11111111-1111-4111-8111-111111111111",
        title: "Broken reference test",
        href: "#22222222-2222-4222-8222-222222222222",
      },
    },
  };
  let rejectedBrokenReference = false;
  try {
    normalizeOscalPackage([syntheticBroken]);
  } catch (error) {
    rejectedBrokenReference = String(error).includes("Unresolved local OSCAL reference");
  }
  if (!rejectedBrokenReference) throw new Error("Broken local OSCAL reference did not fail closed");

  const graphDigest = digest(graph);
  const kindCounts = {};
  for (const node of graph.nodes) {
    for (const kind of node.kinds) kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
  }

  const output = {
    source: manifest.source,
    digestAlgorithm: "SHA-256",
    graphDigest,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    kindCounts,
    graph,
  };

  await mkdir(dirname(GENERATED_PATH), { recursive: true });
  await writeFile(GENERATED_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log("✓ NIST OSCAL IFA package normalized deterministically");
  console.log(`  ${graph.nodes.length} nodes · ${graph.edges.length} edges`);
  console.log(`  SHA-256 ${graphDigest}`);
  console.log(`  output ${GENERATED_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
