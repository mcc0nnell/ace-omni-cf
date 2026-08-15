import { describe, expect, it } from "vitest";
import {
  buildEvidenceProjection,
  renderEvidenceHtml,
  verifyEvidenceProjectionAgainstSource,
  verifyEvidenceProjectionIntegrity,
  type EvidenceProjectionSpec,
} from "./evidence-rendering-public";

const authoritativeSource = {
  meta: { id: "finding-7", runId: "run-7" },
  subject: { id: "SC-7", title: "Boundary Protection" },
  result: {
    status: "fail",
    summary: "Observed boundary rule did not match the required policy.",
  },
  evidence: { rule: "deny-external-admin" },
};

const spec: EvidenceProjectionSpec = {
  artifactType: "finding",
  source: {
    recordType: "finding",
    recordIdPath: "meta.id",
    runIdPath: "meta.runId",
  },
  subject: {
    type: "control",
    idPath: "subject.id",
    titlePath: "subject.title",
  },
  result: {
    statusPath: "result.status",
    summaryPath: "result.summary",
  },
  facts: [{ label: "Observed rule", valuePath: "evidence.rule" }],
};

async function projection() {
  return buildEvidenceProjection(authoritativeSource, spec, {
    disclosureClass: "internal",
  });
}

describe("verified evidence rendering API", () => {
  it("accepts an untampered projection and its authoritative source", async () => {
    const value = await projection();

    await expect(verifyEvidenceProjectionIntegrity(value)).resolves.toEqual(value);
    await expect(verifyEvidenceProjectionAgainstSource(value, authoritativeSource)).resolves.toEqual(value);
  });

  it("rejects a projection whose visible result was changed after sealing", async () => {
    const value = await projection();
    const tampered = {
      ...value,
      result: {
        ...value.result,
        status: "pass" as const,
        summary: "Everything is fine now.",
      },
    };

    await expect(verifyEvidenceProjectionIntegrity(tampered)).rejects.toThrow("projection digest mismatch");
    await expect(renderEvidenceHtml(tampered)).rejects.toThrow("projection digest mismatch");
  });

  it("rejects a valid projection when checked against the wrong canonical source", async () => {
    const value = await projection();
    const wrongSource = {
      ...authoritativeSource,
      evidence: { rule: "allow-all" },
    };

    await expect(verifyEvidenceProjectionAgainstSource(value, wrongSource)).rejects.toThrow(
      "source digest mismatch",
    );
  });
});
