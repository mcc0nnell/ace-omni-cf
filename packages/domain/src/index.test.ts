import { describe, expect, it } from "vitest";
import {
  EvidenceManifestSchema,
  ExperimentConfigSchema,
  ExperimentScheduleSchema,
} from "./index";

const participant = (role: "caller" | "callee") => ({
  id:
    role === "caller"
      ? "00000000-0000-4000-8000-000000000011"
      : "00000000-0000-4000-8000-000000000012",
  name: role === "caller" ? "Caller" : "Callee",
  role,
  captions: { engine: "mock" as const },
});

describe("versioned research schemas", () => {
  it("requires exactly one caller and one callee", () => {
    const result = ExperimentConfigSchema.safeParse({
      version: 1,
      trsType: "IP_CTS",
      participants: [participant("caller"), participant("caller")],
      timing: { callTimeoutSec: 30 },
      manipulations: [],
      evidencePolicy: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed or unsigned schedules", () => {
    const result = ExperimentScheduleSchema.safeParse({
      version: 1,
      callId: "00000000-0000-4000-8000-000000000100",
      experimentId: "00000000-0000-4000-8000-000000000101",
      experimentVersionId: "00000000-0000-4000-8000-000000000102",
      configVersion: 1,
      scheduleRevision: 1,
      callClockStartMs: Date.now(),
      issuedAt: new Date().toISOString(),
      manipulations: [{ startOffsetMs: -1 }],
      algorithm: "HMAC-SHA-256",
      signature: "",
    });

    expect(result.success).toBe(false);
  });

  it("requires checksums and the pinned immutable version in evidence manifests", () => {
    const result = EvidenceManifestSchema.safeParse({
      version: 1,
      callId: "00000000-0000-4000-8000-000000000100",
      experimentId: "00000000-0000-4000-8000-000000000101",
      artifacts: [{ objectKey: "calls/example/video.webm" }],
    });

    expect(result.success).toBe(false);
  });
});
