import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  type ExperimentRun,
  type JsonValue,
  type ObservationInput,
} from "./emulytics";
import { ObservationIngestionLedger } from "./observation-ledger";

const FIXTURE = new URL(
  "../test/fixtures/baudot-interop004.observation-inputs.jsonl",
  import.meta.url,
);

function loadBaudotInputs(): ObservationInput[] {
  return readFileSync(FIXTURE, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ObservationInput);
}

function omniRun(): ExperimentRun {
  return {
    version: 1,
    runId: "omni-baudot-interop004-import-001",
    experimentId: "baudot-interop004-ingestion",
    experimentVersionId: "baudot-pr45-f4dfe0c",
    configVersion: 1,
    seed: 45,
    issuedAt: "2026-09-05T22:39:16.000Z",
    adapters: [
      {
        id: "baudot-interop004",
        kind: "baudot-testkit",
        protocolVersion: 1,
        capabilities: ["communications"],
        metadata: {
          sourceRepository: "mcc0nnell/baudot",
          sourceHead: "f4dfe0c21e530d02d4fb5b4547fbf0098716a16b",
          sourceActionsRun: 33_996_472_033,
        },
      },
    ],
  };
}

describe("Baudot observation ingestion", () => {
  it("binds the green INTEROP-004 candidate bundle to an Omni run and preserves replay authority", async () => {
    const inputs = loadBaudotInputs();
    expect(inputs).toHaveLength(17);
    expect(new Set(inputs.map((input) => input.runId))).toEqual(
      new Set(["baudot-ci-33996472033-1"]),
    );
    expect(new Set(inputs.map((input) => input.adapterId))).toEqual(
      new Set(["baudot-interop004"]),
    );

    const ledger = new ObservationIngestionLedger({
      run: omniRun(),
      adapterId: "baudot-interop004",
      sourceBinding: {
        runId: "baudot-ci-33996472033-1",
        adapterId: "baudot-interop004",
      },
    });

    const results = await ledger.ingestAll(inputs);
    expect(results).toHaveLength(17);
    expect(results.every((result) => result.applied)).toBe(true);
    expect(results.map((result) => result.sequence)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    );

    for (const [index, entry] of ledger.entries().entries()) {
      expect(entry.envelope.runId).toBe("omni-baudot-interop004-import-001");
      expect(entry.envelope.adapterId).toBe("baudot-interop004");
      expect(entry.envelope.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(canonicalJson(entry.envelope.payload)).toBe(canonicalJson(inputs[index]!.payload));
    }

    const exactReplay = await ledger.ingest(inputs[0]!);
    expect(exactReplay).toMatchObject({ applied: false, sequence: 1 });
    expect(ledger.entries()).toHaveLength(17);

    const timestampConflict: ObservationInput = {
      ...inputs[0]!,
      observedAt: "2026-09-05T22:38:34.173907815Z",
    };
    await expect(ledger.ingest(timestampConflict)).rejects.toThrow(/conflicting replay/);
    expect(ledger.entries()).toHaveLength(17);

    const firstExport = await ledger.exportBundle();
    const secondExport = await ledger.exportBundle();
    expect(secondExport.ledgerSha256).toBe(firstExport.ledgerSha256);
    expect(firstExport.ledgerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(firstExport.ledger.sourceBinding).toEqual({
      runId: "baudot-ci-33996472033-1",
      adapterId: "baudot-interop004",
    });
    expect(firstExport.ledger.entries).toHaveLength(17);
  });

  it("round-trips the Baudot claim facts without promoting them into Omni semantics", async () => {
    const inputs = loadBaudotInputs();
    const ledger = new ObservationIngestionLedger({
      run: omniRun(),
      adapterId: "baudot-interop004",
      sourceBinding: {
        runId: "baudot-ci-33996472033-1",
        adapterId: "baudot-interop004",
      },
    });
    await ledger.ingestAll(inputs);

    const facts = new Map<string, JsonValue>();
    for (const entry of ledger.entries()) {
      const payload = entry.envelope.payload as Record<string, JsonValue>;
      facts.set(`${String(payload.armId)}:${String(payload.factType)}`, payload.factValue ?? null);
    }

    expect(facts.get("live-transfer:referAccepted")).toBe(true);
    expect(facts.get("live-transfer:replacementDialogEstablished")).toBe(true);
    expect(facts.get("live-transfer:replacementTargetCorrelated")).toBe(true);
    expect(facts.get("control:rttNegotiated")).toBe(true);
    expect(facts.get("control:firstT140CharacterObserved")).toBe(true);
    expect(facts.get("control:rttReady")).toBe(true);
    expect(facts.get("signaling-only:rttNegotiated")).toBe(true);
    expect(facts.get("signaling-only:firstT140CharacterObserved")).toBe(false);
    expect(facts.get("signaling-only:rttReady")).toBe(false);
    expect(facts.get("signaling-only:oldLegPreserved")).toBe(true);
  });
});
