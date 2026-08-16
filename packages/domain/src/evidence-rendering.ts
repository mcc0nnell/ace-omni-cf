import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i, "Expected a sha256: digest");
const SourcePathSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.-]+$/);
const StableTextSchema = z.string().min(1).max(2_000);

export const EvidenceProjectionArtifactTypeSchema = z.enum([
  "control-result",
  "finding",
  "execution-trace",
]);
export type EvidenceProjectionArtifactType = z.infer<typeof EvidenceProjectionArtifactTypeSchema>;

export const EvidenceProjectionStatusSchema = z.enum([
  "pass",
  "fail",
  "partial",
  "unknown",
  "not-applicable",
  "not-tested",
  "review-required",
]);
export type EvidenceProjectionStatus = z.infer<typeof EvidenceProjectionStatusSchema>;

export const EvidenceDisclosureClassSchema = z.enum(["public", "internal", "restricted"]);
export type EvidenceDisclosureClass = z.infer<typeof EvidenceDisclosureClassSchema>;

export const EvidenceProjectionPolicySchema = z.object({
  disclosureClass: EvidenceDisclosureClassSchema,
  allowSourceLocator: z.boolean().default(false),
  blockedSourcePaths: z.array(SourcePathSchema).default([]),
});
export type EvidenceProjectionPolicy = z.input<typeof EvidenceProjectionPolicySchema>;
export type NormalizedEvidenceProjectionPolicy = z.output<typeof EvidenceProjectionPolicySchema>;

export const EvidenceFieldBindingSchema = z.object({
  projectionPath: SourcePathSchema,
  sourcePath: SourcePathSchema,
  sourceDigest: DigestSchema,
});
export type EvidenceFieldBinding = z.infer<typeof EvidenceFieldBindingSchema>;

export const EvidenceProjectionFactSchema = z.object({
  label: StableTextSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  status: EvidenceProjectionStatusSchema.optional(),
});
export type EvidenceProjectionFact = z.infer<typeof EvidenceProjectionFactSchema>;

export const EvidenceProjectionTraceEntrySchema = z.object({
  sequence: z.number().int().nonnegative(),
  kind: StableTextSchema,
  summary: StableTextSchema,
  at: z.string().datetime({ offset: true }).optional(),
});
export type EvidenceProjectionTraceEntry = z.infer<typeof EvidenceProjectionTraceEntrySchema>;

const EvidenceProjectionContentSchema = z.object({
  artifactVersion: z.literal(1),
  artifactType: EvidenceProjectionArtifactTypeSchema,
  source: z.object({
    kind: z.literal("omni-evidence"),
    recordType: StableTextSchema,
    recordId: StableTextSchema,
    runId: StableTextSchema.optional(),
    sequence: z.number().int().nonnegative().optional(),
    digest: DigestSchema,
    locator: z.string().url().optional(),
  }),
  subject: z.object({
    type: StableTextSchema,
    id: StableTextSchema,
    title: StableTextSchema,
  }),
  result: z.object({
    status: EvidenceProjectionStatusSchema,
    summary: StableTextSchema,
    evaluatedAt: z.string().datetime({ offset: true }).optional(),
  }),
  facts: z.array(EvidenceProjectionFactSchema).max(200).default([]),
  trace: z.array(EvidenceProjectionTraceEntrySchema).max(500).default([]),
  provenance: z.object({
    experimentVersionId: StableTextSchema.optional(),
    adapterId: StableTextSchema.optional(),
    evaluatorId: StableTextSchema.optional(),
    projectionBuilder: z.literal("omni/evidence-projection/v1"),
  }),
  disclosure: z.object({
    class: EvidenceDisclosureClassSchema,
    redactedSourcePaths: z.array(SourcePathSchema),
  }),
  bindings: z.array(EvidenceFieldBindingSchema).min(4).max(2_000),
});

function requiredBindingPaths(projection: z.infer<typeof EvidenceProjectionContentSchema>): string[] {
  const paths = ["source.recordId", "subject.id", "subject.title", "result.status", "result.summary"];

  if (projection.source.runId !== undefined) paths.push("source.runId");
  if (projection.source.sequence !== undefined) paths.push("source.sequence");
  if (projection.result.evaluatedAt !== undefined) paths.push("result.evaluatedAt");
  if (projection.provenance.experimentVersionId !== undefined) paths.push("provenance.experimentVersionId");
  if (projection.provenance.adapterId !== undefined) paths.push("provenance.adapterId");
  if (projection.provenance.evaluatorId !== undefined) paths.push("provenance.evaluatorId");

  projection.facts.forEach((fact, index) => {
    paths.push(`facts.${index}.value`);
    if (fact.status !== undefined) paths.push(`facts.${index}.status`);
  });

  projection.trace.forEach((entry, index) => {
    paths.push(`trace.${index}.sequence`, `trace.${index}.kind`, `trace.${index}.summary`);
    if (entry.at !== undefined) paths.push(`trace.${index}.at`);
  });

  return paths;
}

export const EvidenceProjectionSchema = EvidenceProjectionContentSchema.extend({
  projectionDigest: DigestSchema,
}).superRefine((projection, context) => {
  const bindingPaths = new Set<string>();

  for (const binding of projection.bindings) {
    if (binding.sourceDigest !== projection.source.digest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindings"],
        message: `Binding ${binding.projectionPath} does not reference the projection source digest`,
      });
    }
    if (bindingPaths.has(binding.projectionPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindings"],
        message: `Duplicate field binding for ${binding.projectionPath}`,
      });
    }
    bindingPaths.add(binding.projectionPath);
  }

  for (const requiredPath of requiredBindingPaths(projection)) {
    if (!bindingPaths.has(requiredPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindings"],
        message: `Missing authoritative field binding for ${requiredPath}`,
      });
    }
  }
});
export type EvidenceProjection = z.infer<typeof EvidenceProjectionSchema>;

export const EvidenceRendererProfileSchema = z.object({
  id: z.literal("assurance-card"),
  version: z.literal(1),
  theme: z.enum(["light", "dark"]),
  density: z.enum(["comfortable", "compact"]),
  provenance: z.enum(["compact", "expanded"]),
});
export type EvidenceRendererProfile = z.infer<typeof EvidenceRendererProfileSchema>;

export const ASSURANCE_CARD_V1: EvidenceRendererProfile = {
  id: "assurance-card",
  version: 1,
  theme: "light",
  density: "comfortable",
  provenance: "expanded",
};

export interface EvidenceProjectionSpec {
  artifactType: EvidenceProjectionArtifactType;
  source: {
    recordType: string;
    recordIdPath: string;
    runIdPath?: string;
    sequencePath?: string;
    locator?: string;
  };
  subject: {
    type: string;
    idPath: string;
    titlePath: string;
  };
  result: {
    statusPath: string;
    summaryPath: string;
    evaluatedAtPath?: string;
  };
  facts?: Array<{
    label: string;
    valuePath: string;
    statusPath?: string;
  }>;
  trace?: Array<{
    sequencePath: string;
    kindPath: string;
    summaryPath: string;
    atPath?: string;
  }>;
  provenance?: {
    experimentVersionIdPath?: string;
    adapterIdPath?: string;
    evaluatorIdPath?: string;
  };
}

export interface RenderedEvidence {
  format: "html" | "svg";
  mediaType: "text/html" | "image/svg+xml";
  content: string;
  sourceDigest: string;
  projectionDigest: string;
  profileDigest: string;
  renderDigest: string;
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function normalizeCanonicalJson(value: unknown, path = "$", inArray = false): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return value;
  }

  if (value === undefined) {
    if (inArray) return null;
    throw new TypeError(`Undefined value at ${path}`);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeCanonicalJson(entry, `${path}.${index}`, true));
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Unsupported object type at ${path}`);
    }

    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = normalizeCanonicalJson(entry, `${path}.${key}`);
    }
    return result;
  }

  throw new TypeError(`Unsupported canonical JSON value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value));
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export async function sha256Canonical(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}

function getPath(source: unknown, path: string): unknown {
  if (!SourcePathSchema.safeParse(path).success) throw new Error(`Invalid source path: ${path}`);

  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      throw new Error(`Source path ${path} does not exist`);
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Source path ${path} does not exist`);
      }
      current = current[index];
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Source path ${path} does not exist`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string at ${path}`);
  }
  return value;
}

function asScalar(value: unknown, path: string): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`Expected displayable scalar at ${path}`);
}

function asSequence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected non-negative integer at ${path}`);
  }
  return value;
}

function bind(
  bindings: EvidenceFieldBinding[],
  projectionPath: string,
  sourcePath: string,
  sourceDigest: string,
): void {
  bindings.push({ projectionPath, sourcePath, sourceDigest });
}

function isBlocked(path: string, policy: NormalizedEvidenceProjectionPolicy): boolean {
  return policy.blockedSourcePaths.some(
    (blocked) => path === blocked || path.startsWith(`${blocked}.`),
  );
}

function requireReadablePath(path: string, policy: NormalizedEvidenceProjectionPolicy): void {
  if (isBlocked(path, policy)) {
    throw new Error(`Required projection field is blocked by disclosure policy: ${path}`);
  }
}

export async function buildEvidenceProjection(
  authoritativeSource: unknown,
  spec: EvidenceProjectionSpec,
  inputPolicy: EvidenceProjectionPolicy,
): Promise<EvidenceProjection> {
  const policy = EvidenceProjectionPolicySchema.parse(inputPolicy);
  const sourceDigest = await sha256Canonical(authoritativeSource);
  const bindings: EvidenceFieldBinding[] = [];

  const requiredPaths = [
    spec.source.recordIdPath,
    spec.subject.idPath,
    spec.subject.titlePath,
    spec.result.statusPath,
    spec.result.summaryPath,
  ];
  if (spec.source.runIdPath) requiredPaths.push(spec.source.runIdPath);
  if (spec.source.sequencePath) requiredPaths.push(spec.source.sequencePath);
  if (spec.result.evaluatedAtPath) requiredPaths.push(spec.result.evaluatedAtPath);
  if (spec.provenance?.experimentVersionIdPath) requiredPaths.push(spec.provenance.experimentVersionIdPath);
  if (spec.provenance?.adapterIdPath) requiredPaths.push(spec.provenance.adapterIdPath);
  if (spec.provenance?.evaluatorIdPath) requiredPaths.push(spec.provenance.evaluatorIdPath);
  requiredPaths.forEach((path) => requireReadablePath(path, policy));

  const recordId = asText(getPath(authoritativeSource, spec.source.recordIdPath), spec.source.recordIdPath);
  bind(bindings, "source.recordId", spec.source.recordIdPath, sourceDigest);

  const runId = spec.source.runIdPath
    ? asText(getPath(authoritativeSource, spec.source.runIdPath), spec.source.runIdPath)
    : undefined;
  if (spec.source.runIdPath) bind(bindings, "source.runId", spec.source.runIdPath, sourceDigest);

  const sequence = spec.source.sequencePath
    ? asSequence(getPath(authoritativeSource, spec.source.sequencePath), spec.source.sequencePath)
    : undefined;
  if (spec.source.sequencePath) bind(bindings, "source.sequence", spec.source.sequencePath, sourceDigest);

  const subjectId = asText(getPath(authoritativeSource, spec.subject.idPath), spec.subject.idPath);
  const subjectTitle = asText(getPath(authoritativeSource, spec.subject.titlePath), spec.subject.titlePath);
  bind(bindings, "subject.id", spec.subject.idPath, sourceDigest);
  bind(bindings, "subject.title", spec.subject.titlePath, sourceDigest);

  const resultStatus = EvidenceProjectionStatusSchema.parse(
    getPath(authoritativeSource, spec.result.statusPath),
  );
  const resultSummary = asText(
    getPath(authoritativeSource, spec.result.summaryPath),
    spec.result.summaryPath,
  );
  bind(bindings, "result.status", spec.result.statusPath, sourceDigest);
  bind(bindings, "result.summary", spec.result.summaryPath, sourceDigest);

  const evaluatedAt = spec.result.evaluatedAtPath
    ? z.string().datetime({ offset: true }).parse(getPath(authoritativeSource, spec.result.evaluatedAtPath))
    : undefined;
  if (spec.result.evaluatedAtPath) {
    bind(bindings, "result.evaluatedAt", spec.result.evaluatedAtPath, sourceDigest);
  }

  const facts: EvidenceProjectionFact[] = [];
  for (const factSpec of spec.facts ?? []) {
    if (isBlocked(factSpec.valuePath, policy) || (factSpec.statusPath && isBlocked(factSpec.statusPath, policy))) {
      continue;
    }

    const fact: EvidenceProjectionFact = {
      label: factSpec.label,
      value: asScalar(getPath(authoritativeSource, factSpec.valuePath), factSpec.valuePath),
    };
    if (factSpec.statusPath) {
      fact.status = EvidenceProjectionStatusSchema.parse(getPath(authoritativeSource, factSpec.statusPath));
    }

    const index = facts.length;
    facts.push(fact);
    bind(bindings, `facts.${index}.value`, factSpec.valuePath, sourceDigest);
    if (factSpec.statusPath) bind(bindings, `facts.${index}.status`, factSpec.statusPath, sourceDigest);
  }

  const trace: EvidenceProjectionTraceEntry[] = [];
  for (const traceSpec of spec.trace ?? []) {
    const paths = [traceSpec.sequencePath, traceSpec.kindPath, traceSpec.summaryPath];
    if (traceSpec.atPath) paths.push(traceSpec.atPath);
    if (paths.some((path) => isBlocked(path, policy))) continue;

    const entry: EvidenceProjectionTraceEntry = {
      sequence: asSequence(getPath(authoritativeSource, traceSpec.sequencePath), traceSpec.sequencePath),
      kind: asText(getPath(authoritativeSource, traceSpec.kindPath), traceSpec.kindPath),
      summary: asText(getPath(authoritativeSource, traceSpec.summaryPath), traceSpec.summaryPath),
    };
    if (traceSpec.atPath) {
      entry.at = z.string().datetime({ offset: true }).parse(getPath(authoritativeSource, traceSpec.atPath));
    }

    const index = trace.length;
    trace.push(entry);
    bind(bindings, `trace.${index}.sequence`, traceSpec.sequencePath, sourceDigest);
    bind(bindings, `trace.${index}.kind`, traceSpec.kindPath, sourceDigest);
    bind(bindings, `trace.${index}.summary`, traceSpec.summaryPath, sourceDigest);
    if (traceSpec.atPath) bind(bindings, `trace.${index}.at`, traceSpec.atPath, sourceDigest);
  }

  const provenance: z.infer<typeof EvidenceProjectionContentSchema>["provenance"] = {
    projectionBuilder: "omni/evidence-projection/v1",
  };

  if (spec.provenance?.experimentVersionIdPath) {
    provenance.experimentVersionId = asText(
      getPath(authoritativeSource, spec.provenance.experimentVersionIdPath),
      spec.provenance.experimentVersionIdPath,
    );
    bind(bindings, "provenance.experimentVersionId", spec.provenance.experimentVersionIdPath, sourceDigest);
  }
  if (spec.provenance?.adapterIdPath) {
    provenance.adapterId = asText(
      getPath(authoritativeSource, spec.provenance.adapterIdPath),
      spec.provenance.adapterIdPath,
    );
    bind(bindings, "provenance.adapterId", spec.provenance.adapterIdPath, sourceDigest);
  }
  if (spec.provenance?.evaluatorIdPath) {
    provenance.evaluatorId = asText(
      getPath(authoritativeSource, spec.provenance.evaluatorIdPath),
      spec.provenance.evaluatorIdPath,
    );
    bind(bindings, "provenance.evaluatorId", spec.provenance.evaluatorIdPath, sourceDigest);
  }

  const content = EvidenceProjectionContentSchema.parse({
    artifactVersion: 1,
    artifactType: spec.artifactType,
    source: {
      kind: "omni-evidence",
      recordType: spec.source.recordType,
      recordId,
      runId,
      sequence,
      digest: sourceDigest,
      locator: policy.allowSourceLocator ? spec.source.locator : undefined,
    },
    subject: {
      type: spec.subject.type,
      id: subjectId,
      title: subjectTitle,
    },
    result: {
      status: resultStatus,
      summary: resultSummary,
      evaluatedAt,
    },
    facts,
    trace,
    provenance,
    disclosure: {
      class: policy.disclosureClass,
      redactedSourcePaths: policy.blockedSourcePaths,
    },
    bindings,
  });

  const projectionDigest = await sha256Canonical(content);
  return EvidenceProjectionSchema.parse({ ...content, projectionDigest });
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusLabel(status: EvidenceProjectionStatus): string {
  return status.toUpperCase().replaceAll("-", " ");
}

function statusSymbol(status: EvidenceProjectionStatus): string {
  switch (status) {
    case "pass":
      return "✓";
    case "fail":
      return "✕";
    case "partial":
      return "◐";
    case "review-required":
      return "!";
    case "unknown":
      return "?";
    case "not-applicable":
      return "—";
    case "not-tested":
      return "○";
  }
}

async function renderResult(
  format: RenderedEvidence["format"],
  mediaType: RenderedEvidence["mediaType"],
  content: string,
  projection: EvidenceProjection,
  profile: EvidenceRendererProfile,
): Promise<RenderedEvidence> {
  return {
    format,
    mediaType,
    content,
    sourceDigest: projection.source.digest,
    projectionDigest: projection.projectionDigest,
    profileDigest: await sha256Canonical(profile),
    renderDigest: await sha256Text(content),
  };
}

export async function renderEvidenceHtml(
  inputProjection: EvidenceProjection,
  inputProfile: EvidenceRendererProfile = ASSURANCE_CARD_V1,
): Promise<RenderedEvidence> {
  const projection = EvidenceProjectionSchema.parse(inputProjection);
  const profile = EvidenceRendererProfileSchema.parse(inputProfile);
  const facts = projection.facts
    .map(
      (fact) =>
        `<li><strong>${escapeHtml(fact.label)}</strong>: <span>${escapeHtml(fact.value)}</span>${
          fact.status
            ? ` <span aria-label="status ${escapeHtml(statusLabel(fact.status))}">${escapeHtml(statusSymbol(fact.status))} ${escapeHtml(statusLabel(fact.status))}</span>`
            : ""
        }</li>`,
    )
    .join("");
  const trace = projection.trace
    .map(
      (entry) =>
        `<li><span>Sequence ${entry.sequence}</span> <strong>${escapeHtml(entry.kind)}</strong>: ${escapeHtml(entry.summary)}${entry.at ? ` <time datetime="${escapeHtml(entry.at)}">${escapeHtml(entry.at)}</time>` : ""}</li>`,
    )
    .join("");

  const locator = projection.source.locator
    ? `<p><a href="${escapeHtml(projection.source.locator)}">Open canonical source</a></p>`
    : `<p>Canonical source locator is not included in this ${escapeHtml(projection.disclosure.class)} projection.</p>`;

  const content = `<article class="omni-evidence omni-evidence--${profile.theme} omni-evidence--${profile.density}" data-source-digest="${escapeHtml(projection.source.digest)}" data-projection-digest="${escapeHtml(projection.projectionDigest)}"><header><p>${escapeHtml(projection.artifactType)}</p><h2>${escapeHtml(projection.subject.id)} — ${escapeHtml(projection.subject.title)}</h2><p><strong>Status:</strong> <span aria-label="${escapeHtml(statusLabel(projection.result.status))}">${escapeHtml(statusSymbol(projection.result.status))} ${escapeHtml(statusLabel(projection.result.status))}</span></p><p>${escapeHtml(projection.result.summary)}</p></header>${projection.facts.length ? `<section aria-labelledby="evidence-facts"><h3 id="evidence-facts">Evidence</h3><ul>${facts}</ul></section>` : ""}${projection.trace.length ? `<section aria-labelledby="evidence-trace"><h3 id="evidence-trace">Execution trace</h3><ol>${trace}</ol></section>` : ""}<footer><dl><dt>Source</dt><dd>${escapeHtml(projection.source.recordType)} / ${escapeHtml(projection.source.recordId)}</dd>${projection.source.runId ? `<dt>Run</dt><dd>${escapeHtml(projection.source.runId)}</dd>` : ""}<dt>Source digest</dt><dd><code>${escapeHtml(projection.source.digest)}</code></dd><dt>Projection digest</dt><dd><code>${escapeHtml(projection.projectionDigest)}</code></dd><dt>Disclosure</dt><dd>${escapeHtml(projection.disclosure.class)}</dd></dl>${locator}</footer></article>`;

  return renderResult("html", "text/html", content, projection, profile);
}

export async function renderEvidenceSvg(
  inputProjection: EvidenceProjection,
  inputProfile: EvidenceRendererProfile = ASSURANCE_CARD_V1,
): Promise<RenderedEvidence> {
  const projection = EvidenceProjectionSchema.parse(inputProjection);
  const profile = EvidenceRendererProfileSchema.parse(inputProfile);
  const rowHeight = profile.density === "compact" ? 24 : 30;
  const width = 960;
  const height = 250 + rowHeight * (projection.facts.length + projection.trace.length);
  const foreground = profile.theme === "dark" ? "#ffffff" : "#111111";
  const background = profile.theme === "dark" ? "#111111" : "#ffffff";
  const muted = profile.theme === "dark" ? "#d0d0d0" : "#444444";
  let y = 42;

  const text = (value: unknown, x: number, weight = "400", size = 16, fill = foreground) => {
    const element = `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(value)}</text>`;
    y += rowHeight;
    return element;
  };

  const body: string[] = [];
  body.push(text(`${projection.subject.id} — ${projection.subject.title}`, 28, "700", 22));
  body.push(text(`${statusSymbol(projection.result.status)} ${statusLabel(projection.result.status)}`, 28, "700", 18));
  body.push(text(projection.result.summary, 28, "400", 16));
  y += 8;

  for (const fact of projection.facts) {
    body.push(
      text(
        `${fact.label}: ${String(fact.value)}${fact.status ? ` — ${statusSymbol(fact.status)} ${statusLabel(fact.status)}` : ""}`,
        44,
        "400",
        15,
      ),
    );
  }

  if (projection.trace.length) {
    y += 8;
    body.push(text("Execution trace", 28, "700", 16));
    for (const entry of projection.trace) {
      body.push(text(`#${entry.sequence} ${entry.kind}: ${entry.summary}`, 44, "400", 14, muted));
    }
  }

  y += 8;
  body.push(text(`Source: ${projection.source.recordType} / ${projection.source.recordId}`, 28, "400", 13, muted));
  body.push(text(`Source digest: ${projection.source.digest}`, 28, "400", 12, muted));
  body.push(text(`Projection digest: ${projection.projectionDigest}`, 28, "400", 12, muted));
  body.push(text(`Disclosure: ${projection.disclosure.class}`, 28, "400", 12, muted));

  const content = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-source-digest="${escapeHtml(projection.source.digest)}" data-projection-digest="${escapeHtml(projection.projectionDigest)}"><title id="title">${escapeHtml(projection.subject.id)} ${escapeHtml(projection.subject.title)} — ${escapeHtml(statusLabel(projection.result.status))}</title><desc id="desc">${escapeHtml(projection.result.summary)} Canonical source ${escapeHtml(projection.source.recordType)} ${escapeHtml(projection.source.recordId)}.</desc><rect width="100%" height="100%" fill="${background}" stroke="${muted}"/>${body.join("")}</svg>`;

  return renderResult("svg", "image/svg+xml", content, projection, profile);
}
