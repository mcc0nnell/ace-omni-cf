import {
  canonicalJson,
  createObservationEnvelope,
  normalizeExperimentRun,
  observationReplayKey,
  sha256Canonical,
  type ExperimentRun,
  type JsonValue,
  type ObservationEnvelope,
  type ObservationInput,
} from "./emulytics";

export interface ObservationSourceBinding {
  runId: string;
  adapterId: string;
}

export interface ObservationLedgerEntry {
  sequence: number;
  envelope: ObservationEnvelope;
}

export interface ObservationIngestionResult extends ObservationLedgerEntry {
  applied: boolean;
}

export interface ObservationLedgerExport {
  version: 1;
  kind: "ace-omni.observation-ledger-export";
  run: ExperimentRun;
  adapterId: string;
  sourceBinding: ObservationSourceBinding | null;
  entries: ObservationLedgerEntry[];
}

export interface ObservationLedgerExportBundle {
  ledger: ObservationLedgerExport;
  ledgerSha256: string;
}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalJson(value as unknown as JsonValue)) as T;
}

/**
 * Protocol-level authoritative ingestion for a declared Omni run.
 *
 * A source binding is used when importing observation candidates produced before
 * Omni assigned the authoritative target run. The source run/adapter identity is
 * validated and preserved in the export, while emitted ObservationEnvelope records
 * are rebound to the declared Omni run and adapter. Payloads and source IDs are not
 * rewritten.
 *
 * This class deliberately does not claim Durable Object / D1 persistence. The live
 * TRS room ledger remains the durable runtime authority for call-scoped evidence.
 */
export class ObservationIngestionLedger {
  readonly run: ExperimentRun;
  readonly adapterId: string;
  readonly sourceBinding: ObservationSourceBinding | null;

  private readonly entriesByReplayKey = new Map<string, ObservationLedgerEntry>();
  private readonly orderedEntries: ObservationLedgerEntry[] = [];

  constructor(input: {
    run: ExperimentRun;
    adapterId: string;
    sourceBinding?: ObservationSourceBinding;
  }) {
    this.run = normalizeExperimentRun(input.run);
    const targetAdapter = this.run.adapters.find((adapter) => adapter.id === input.adapterId);
    if (!targetAdapter) {
      throw new Error(`run does not declare adapter ${input.adapterId}`);
    }
    this.adapterId = targetAdapter.id;
    this.sourceBinding = input.sourceBinding ? { ...input.sourceBinding } : null;
  }

  async ingest(input: ObservationInput): Promise<ObservationIngestionResult> {
    // Validate and canonicalize the source candidate before applying any Omni binding.
    const sourceEnvelope = await createObservationEnvelope(input);

    if (this.sourceBinding) {
      if (
        sourceEnvelope.runId !== this.sourceBinding.runId ||
        sourceEnvelope.adapterId !== this.sourceBinding.adapterId
      ) {
        throw new Error("observation does not match the declared source binding");
      }
    } else if (
      sourceEnvelope.runId !== this.run.runId ||
      sourceEnvelope.adapterId !== this.adapterId
    ) {
      throw new Error("observation is not bound to the authoritative run and adapter");
    }

    const envelope = this.sourceBinding
      ? await createObservationEnvelope({
          observationId: sourceEnvelope.observationId,
          runId: this.run.runId,
          adapterId: this.adapterId,
          sourceId: sourceEnvelope.sourceId,
          observedAt: sourceEnvelope.observedAt,
          payload: sourceEnvelope.payload,
        })
      : sourceEnvelope;

    const replayKey = observationReplayKey(envelope);
    const existing = this.entriesByReplayKey.get(replayKey);
    if (existing) {
      if (
        existing.envelope.observedAt !== envelope.observedAt ||
        existing.envelope.payloadSha256 !== envelope.payloadSha256
      ) {
        throw new Error(`conflicting replay for observation ${replayKey}`);
      }
      return { ...cloneCanonical(existing), applied: false };
    }

    const entry: ObservationLedgerEntry = {
      sequence: this.orderedEntries.length + 1,
      envelope,
    };
    this.entriesByReplayKey.set(replayKey, entry);
    this.orderedEntries.push(entry);
    return { ...cloneCanonical(entry), applied: true };
  }

  async ingestAll(inputs: ObservationInput[]): Promise<ObservationIngestionResult[]> {
    const results: ObservationIngestionResult[] = [];
    for (const input of inputs) {
      results.push(await this.ingest(input));
    }
    return results;
  }

  entries(): ObservationLedgerEntry[] {
    return cloneCanonical(this.orderedEntries);
  }

  exportLedger(): ObservationLedgerExport {
    return cloneCanonical({
      version: 1 as const,
      kind: "ace-omni.observation-ledger-export" as const,
      run: this.run,
      adapterId: this.adapterId,
      sourceBinding: this.sourceBinding,
      entries: this.orderedEntries,
    });
  }

  async exportBundle(): Promise<ObservationLedgerExportBundle> {
    const ledger = this.exportLedger();
    return {
      ledger,
      ledgerSha256: await sha256Canonical(ledger as unknown as JsonValue),
    };
  }
}
