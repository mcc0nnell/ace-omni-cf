import { describe, expect, it } from "vitest";
import {
  ASSURANCE_CARD_V1,
  EvidenceProjectionSchema,
  buildEvidenceProjection,
  canonicalJson,
  renderEvidenceHtml,
  renderEvidenceSvg,
  sha256Canonical,
  type EvidenceProjectionSpec,
} from "./evidence-rendering";

const source = {
  meta: {
    recordId: "assessment-result-42",
    runId: "run-2026-08-14-001",
    sequence: 42,
    experimentVersionId: "expv-17",
    adapterId: "ibm-oscal",
    evaluatorId: "omni-assurance",
  },
  control: {
    id: "AC-2",
    title: "Account Management",
  },
  result: {
    status: "pass",
    summary: "Privileged account controls satisfied the bound assessment assertions.",
    evaluatedAt: "2026-08-14T23:30:00-04:00",
  },
  evidence: {
    mfa: "configuration observed",
    checksum: "verified",
    secretToken: "TOP-SECRET-DO-NOT-RENDER",
  },
  trace: [
    {
      sequence: 1,
      kind: "command",
      summary: "Evaluate AC-2",
      at: "2026-08-14T23:29:58-04:00",
    },
    {
      sequence: 2,
      kind: "observation",
      summary: "MFA requirement observed",
      at: "2026-08-14T23:29:59-04:00",
    },
  ],
};

const spec: EvidenceProjectionSpec = {
  artifactType: "control-result",
  source: {
    recordType: "assessment-result",
    recordIdPath: "meta.recordId",
    runIdPath: "meta.runId",
    sequencePath: "meta.sequence",
    locator: "https://omni.example/evidence/assessment-result-42",
  },
  subject: {
    type: "oscal-control",
    idPath: "control.id",
    titlePath: "control.title",
  },
  result: {
    statusPath: "result.status",
    summaryPath: "result.summary",
    evaluatedAtPath: "result.evaluatedAt",
  },
  facts: [
    { label: "MFA", valuePath: "evidence.mfa" },
    { label: "Checksum", valuePath: "evidence.checksum" },
    { label: "Secret token", valuePath: "evidence.secretToken" },
  ],
  trace: [
    {
      sequencePath: "trace.0.sequence",
      kindPath: "trace.0.kind",
      summaryPath: "trace.0.summary",
      atPath: "trace.0.at",
    },
    {
      sequencePath: "trace.1.sequence",
      kindPath: "trace.1.kind",
      summaryPath: "trace.1.summary",
      atPath: "trace.1.at",
    },
  ],
  provenance: {
    experimentVersionIdPath: "meta.experimentVersionId",
    adapterIdPath: "meta.adapterId",
    evaluatorIdPath: "meta.evaluatorId",
  },
};

async function buildPublicProjection() {
  return buildEvidenceProjection(source, spec, {
    disclosureClass: "public",
    allowSourceLocator: true,
    blockedSourcePaths: ["evidence.secretToken"],
  });
}

describe("deterministic evidence projections", () => {
  it("canonicalizes object key order before hashing", async () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(await sha256Canonical({ b: 2, a: 1 })).toBe(await sha256Canonical({ a: 1, b: 2 }));
  });

  it("derives display fields from authoritative paths and emits field-level bindings", async () => {
    const projection = await buildPublicProjection();

    expect(projection.subject).toEqual({
      type: "oscal-control",
      id: "AC-2",
      title: "Account Management",
    });
    expect(projection.result.status).toBe("pass");
    expect(projection.bindings).toContainEqual(
      expect.objectContaining({
        projectionPath: "result.status",
        sourcePath: "result.status",
        sourceDigest: projection.source.digest,
      }),
    );
    expect(EvidenceProjectionSchema.safeParse(projection).success).toBe(true);
  });

  it("redacts before projection so blocked values cannot survive in markup or metadata", async () => {
    const projection = await buildPublicProjection();
    const html = await renderEvidenceHtml(projection);
    const svg = await renderEvidenceSvg(projection);

    expect(projection.facts.map((fact) => fact.label)).not.toContain("Secret token");
    expect(JSON.stringify(projection)).not.toContain("TOP-SECRET-DO-NOT-RENDER");
    expect(html.content).not.toContain("TOP-SECRET-DO-NOT-RENDER");
    expect(svg.content).not.toContain("TOP-SECRET-DO-NOT-RENDER");
    expect(projection.disclosure.redactedSourcePaths).toContain("evidence.secretToken");
  });

  it("refuses to redact a field required to state the authoritative result", async () => {
    await expect(
      buildEvidenceProjection(source, spec, {
        disclosureClass: "restricted",
        blockedSourcePaths: ["result.status"],
      }),
    ).rejects.toThrow("Required projection field is blocked");
  });

  it("requires authoritative bindings for every displayed dynamic field", async () => {
    const projection = await buildPublicProjection();
    const forged = {
      ...projection,
      bindings: projection.bindings.filter((binding) => binding.projectionPath !== "result.summary"),
    };

    const parsed = EvidenceProjectionSchema.safeParse(forged);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("result.summary"))).toBe(true);
    }
  });

  it("renders status as text and symbol rather than color alone", async () => {
    const projection = await buildPublicProjection();
    const html = await renderEvidenceHtml(projection);
    const svg = await renderEvidenceSvg(projection);

    expect(html.content).toContain("✓ PASS");
    expect(html.content).toContain('aria-label="PASS"');
    expect(svg.content).toContain("✓ PASS");
    expect(svg.content).toContain("<title id=\"title\">AC-2 Account Management — PASS</title>");
  });

  it("keeps projection identity stable while presentation identity changes with the profile", async () => {
    const projection = await buildPublicProjection();
    const light = await renderEvidenceHtml(projection, ASSURANCE_CARD_V1);
    const dark = await renderEvidenceHtml(projection, {
      ...ASSURANCE_CARD_V1,
      theme: "dark",
    });

    expect(light.sourceDigest).toBe(dark.sourceDigest);
    expect(light.projectionDigest).toBe(dark.projectionDigest);
    expect(light.profileDigest).not.toBe(dark.profileDigest);
    expect(light.renderDigest).not.toBe(dark.renderDigest);
  });

  it("produces byte-identical output for the same projection and profile", async () => {
    const projection = await buildPublicProjection();
    const first = await renderEvidenceSvg(projection);
    const second = await renderEvidenceSvg(projection);

    expect(first.content).toBe(second.content);
    expect(first.renderDigest).toBe(second.renderDigest);
  });

  it("omits canonical deep links when disclosure policy forbids them", async () => {
    const projection = await buildEvidenceProjection(source, spec, {
      disclosureClass: "restricted",
      allowSourceLocator: false,
      blockedSourcePaths: ["evidence.secretToken"],
    });
    const html = await renderEvidenceHtml(projection);

    expect(projection.source.locator).toBeUndefined();
    expect(html.content).not.toContain("omni.example/evidence");
    expect(html.content).toContain("Canonical source locator is not included");
  });
});
