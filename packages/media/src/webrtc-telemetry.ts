export interface WebRtcStatsProvider {
  getStats(): Promise<RTCStatsReport>;
  readonly connectionState?: string;
  readonly iceConnectionState?: string;
  readonly signalingState?: string;
}

export type WebRtcMediaKind = "audio" | "video" | "unknown";

export interface InboundRtpTelemetry {
  id: string;
  kind: WebRtcMediaKind;
  mid?: string;
  ssrc?: number;
  statsTimestampMs: number;
  jitterMs?: number;
  packetsReceived?: number;
  packetsLost?: number;
  packetLossPercent?: number;
  packetsReceivedDelta?: number;
  packetsLostDelta?: number;
  intervalPacketLossPercent?: number;
  jitterBufferDelayMs?: number;
  jitterBufferAverageDelayMs?: number;
  jitterBufferTargetDelayMs?: number;
  jitterBufferMinimumDelayMs?: number;
  framesDecoded?: number;
  framesDropped?: number;
  framesDroppedDelta?: number;
  freezeCount?: number;
  freezeCountDelta?: number;
  totalFreezesDurationMs?: number;
  concealedSamples?: number;
  concealmentEvents?: number;
  concealmentEventsDelta?: number;
}

export interface RemoteInboundRtpTelemetry {
  id: string;
  kind: WebRtcMediaKind;
  ssrc?: number;
  statsTimestampMs: number;
  jitterMs?: number;
  roundTripTimeMs?: number;
  packetsLost?: number;
  fractionLost?: number;
}

export interface CandidatePairTelemetry {
  id: string;
  statsTimestampMs: number;
  state?: string;
  nominated?: boolean;
  currentRoundTripTimeMs?: number;
  availableIncomingBitrate?: number;
  availableOutgoingBitrate?: number;
  bytesReceived?: number;
  bytesSent?: number;
}

export interface WebRtcTelemetrySample {
  version: 1;
  sourceId: string;
  sequence: number;
  observedAtMs: number;
  statsTimestampMs: number | null;
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  inbound: InboundRtpTelemetry[];
  remoteInbound: RemoteInboundRtpTelemetry[];
  candidatePair: CandidatePairTelemetry | null;
  maxInboundJitterMs: number | null;
  maxJitterBufferAverageDelayMs: number | null;
}

export interface WebRtcTelemetryObserverOptions {
  sourceId: string;
  intervalMs?: number;
  now?: () => number;
  onSample: (sample: WebRtcTelemetrySample) => void | Promise<void>;
  onError?: (error: Error) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface WebRtcTelemetryObserver {
  sampleNow(): Promise<WebRtcTelemetrySample>;
  start(): void;
  stop(): void;
}

type StatsRecord = RTCStats & Record<string, unknown>;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function nonNegativeDelta(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || current < previous) return undefined;
  return current - previous;
}

function secondsToMs(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : number * 1_000;
}

function mediaKind(stat: StatsRecord): WebRtcMediaKind {
  const value = stat.kind ?? stat.mediaType;
  return value === "audio" || value === "video" ? value : "unknown";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function lossPercent(received: number | undefined, lost: number | undefined): number | undefined {
  if (received === undefined || lost === undefined) return undefined;
  const total = received + lost;
  return total > 0 ? (lost / total) * 100 : 0;
}

function previousInboundById(previous?: WebRtcTelemetrySample): Map<string, InboundRtpTelemetry> {
  return new Map((previous?.inbound ?? []).map((entry) => [entry.id, entry]));
}

function normalizeInbound(
  stat: StatsRecord,
  previous: InboundRtpTelemetry | undefined,
): InboundRtpTelemetry {
  const packetsReceived = finiteInteger(stat.packetsReceived);
  const packetsLost = finiteInteger(stat.packetsLost);
  const packetsReceivedDelta = nonNegativeDelta(packetsReceived, previous?.packetsReceived);
  const packetsLostDelta = nonNegativeDelta(packetsLost, previous?.packetsLost);
  const jitterBufferDelay = finiteNumber(stat.jitterBufferDelay);
  const emitted = finiteNumber(stat.jitterBufferEmittedCount);
  const jitterBufferTargetDelay = finiteNumber(stat.jitterBufferTargetDelay);
  const jitterBufferMinimumDelay = finiteNumber(stat.jitterBufferMinimumDelay);
  const framesDropped = finiteInteger(stat.framesDropped);
  const freezeCount = finiteInteger(stat.freezeCount);
  const concealmentEvents = finiteInteger(stat.concealmentEvents);

  const entry: InboundRtpTelemetry = {
    id: stat.id,
    kind: mediaKind(stat),
    statsTimestampMs: stat.timestamp,
  };
  const mid = optionalString(stat.mid);
  if (mid) entry.mid = mid;
  const ssrc = finiteInteger(stat.ssrc);
  if (ssrc !== undefined) entry.ssrc = ssrc;
  const jitterMs = secondsToMs(stat.jitter);
  if (jitterMs !== undefined) entry.jitterMs = jitterMs;
  if (packetsReceived !== undefined) entry.packetsReceived = packetsReceived;
  if (packetsLost !== undefined) entry.packetsLost = packetsLost;
  const cumulativeLoss = lossPercent(packetsReceived, packetsLost);
  if (cumulativeLoss !== undefined) entry.packetLossPercent = cumulativeLoss;
  if (packetsReceivedDelta !== undefined) entry.packetsReceivedDelta = packetsReceivedDelta;
  if (packetsLostDelta !== undefined) entry.packetsLostDelta = packetsLostDelta;
  const intervalLoss = lossPercent(packetsReceivedDelta, packetsLostDelta);
  if (intervalLoss !== undefined) entry.intervalPacketLossPercent = intervalLoss;
  if (jitterBufferDelay !== undefined) entry.jitterBufferDelayMs = jitterBufferDelay * 1_000;
  if (jitterBufferDelay !== undefined && emitted !== undefined && emitted > 0) {
    entry.jitterBufferAverageDelayMs = (jitterBufferDelay / emitted) * 1_000;
  }
  if (jitterBufferTargetDelay !== undefined && emitted !== undefined && emitted > 0) {
    entry.jitterBufferTargetDelayMs = (jitterBufferTargetDelay / emitted) * 1_000;
  }
  if (jitterBufferMinimumDelay !== undefined && emitted !== undefined && emitted > 0) {
    entry.jitterBufferMinimumDelayMs = (jitterBufferMinimumDelay / emitted) * 1_000;
  }
  const framesDecoded = finiteInteger(stat.framesDecoded);
  if (framesDecoded !== undefined) entry.framesDecoded = framesDecoded;
  if (framesDropped !== undefined) entry.framesDropped = framesDropped;
  const framesDroppedDelta = nonNegativeDelta(framesDropped, previous?.framesDropped);
  if (framesDroppedDelta !== undefined) entry.framesDroppedDelta = framesDroppedDelta;
  if (freezeCount !== undefined) entry.freezeCount = freezeCount;
  const freezeCountDelta = nonNegativeDelta(freezeCount, previous?.freezeCount);
  if (freezeCountDelta !== undefined) entry.freezeCountDelta = freezeCountDelta;
  const totalFreezesDurationMs = secondsToMs(stat.totalFreezesDuration);
  if (totalFreezesDurationMs !== undefined) entry.totalFreezesDurationMs = totalFreezesDurationMs;
  const concealedSamples = finiteInteger(stat.concealedSamples);
  if (concealedSamples !== undefined) entry.concealedSamples = concealedSamples;
  if (concealmentEvents !== undefined) entry.concealmentEvents = concealmentEvents;
  const concealmentEventsDelta = nonNegativeDelta(concealmentEvents, previous?.concealmentEvents);
  if (concealmentEventsDelta !== undefined) entry.concealmentEventsDelta = concealmentEventsDelta;
  return entry;
}

function normalizeRemoteInbound(stat: StatsRecord): RemoteInboundRtpTelemetry {
  const entry: RemoteInboundRtpTelemetry = {
    id: stat.id,
    kind: mediaKind(stat),
    statsTimestampMs: stat.timestamp,
  };
  const ssrc = finiteInteger(stat.ssrc);
  if (ssrc !== undefined) entry.ssrc = ssrc;
  const jitterMs = secondsToMs(stat.jitter);
  if (jitterMs !== undefined) entry.jitterMs = jitterMs;
  const roundTripTimeMs = secondsToMs(stat.roundTripTime);
  if (roundTripTimeMs !== undefined) entry.roundTripTimeMs = roundTripTimeMs;
  const packetsLost = finiteInteger(stat.packetsLost);
  if (packetsLost !== undefined) entry.packetsLost = packetsLost;
  const fractionLost = finiteNumber(stat.fractionLost);
  if (fractionLost !== undefined) entry.fractionLost = fractionLost;
  return entry;
}

function normalizeCandidatePair(stat: StatsRecord): CandidatePairTelemetry {
  const entry: CandidatePairTelemetry = {
    id: stat.id,
    statsTimestampMs: stat.timestamp,
  };
  const state = optionalString(stat.state);
  if (state) entry.state = state;
  if (typeof stat.nominated === "boolean") entry.nominated = stat.nominated;
  const roundTripTimeMs = secondsToMs(stat.currentRoundTripTime);
  if (roundTripTimeMs !== undefined) entry.currentRoundTripTimeMs = roundTripTimeMs;
  const incoming = finiteNumber(stat.availableIncomingBitrate);
  if (incoming !== undefined) entry.availableIncomingBitrate = incoming;
  const outgoing = finiteNumber(stat.availableOutgoingBitrate);
  if (outgoing !== undefined) entry.availableOutgoingBitrate = outgoing;
  const bytesReceived = finiteNumber(stat.bytesReceived);
  if (bytesReceived !== undefined) entry.bytesReceived = bytesReceived;
  const bytesSent = finiteNumber(stat.bytesSent);
  if (bytesSent !== undefined) entry.bytesSent = bytesSent;
  return entry;
}

export function normalizeWebRtcStats(
  report: RTCStatsReport,
  context: {
    sourceId: string;
    sequence: number;
    observedAtMs: number;
    connectionState?: string;
    iceConnectionState?: string;
    signalingState?: string;
  },
  previous?: WebRtcTelemetrySample,
): WebRtcTelemetrySample {
  const stats: StatsRecord[] = [];
  report.forEach((value) => stats.push(value as StatsRecord));
  const previousById = previousInboundById(previous);
  const inbound = stats
    .filter((stat) => stat.type === "inbound-rtp" && stat.isRemote !== true)
    .map((stat) => normalizeInbound(stat, previousById.get(stat.id)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const remoteInbound = stats
    .filter((stat) => stat.type === "remote-inbound-rtp")
    .map(normalizeRemoteInbound)
    .sort((left, right) => left.id.localeCompare(right.id));

  const transportSelectedIds = new Set(
    stats
      .filter((stat) => stat.type === "transport")
      .map((stat) => optionalString(stat.selectedCandidatePairId))
      .filter((id): id is string => Boolean(id)),
  );
  const candidateStats = stats.filter((stat) => stat.type === "candidate-pair");
  const selectedCandidate = candidateStats.find((stat) => transportSelectedIds.has(stat.id))
    ?? candidateStats.find((stat) => stat.selected === true)
    ?? candidateStats.find((stat) => stat.nominated === true && stat.state === "succeeded")
    ?? null;
  const candidatePair = selectedCandidate ? normalizeCandidatePair(selectedCandidate) : null;
  const timestamps = stats.map((stat) => stat.timestamp).filter(Number.isFinite);
  const maxInboundJitterMs = inbound.reduce<number | null>(
    (maximum, entry) => entry.jitterMs === undefined ? maximum : Math.max(maximum ?? 0, entry.jitterMs),
    null,
  );
  const maxJitterBufferAverageDelayMs = inbound.reduce<number | null>(
    (maximum, entry) => entry.jitterBufferAverageDelayMs === undefined
      ? maximum
      : Math.max(maximum ?? 0, entry.jitterBufferAverageDelayMs),
    null,
  );

  return {
    version: 1,
    sourceId: context.sourceId,
    sequence: context.sequence,
    observedAtMs: context.observedAtMs,
    statsTimestampMs: timestamps.length > 0 ? Math.max(...timestamps) : null,
    connectionState: context.connectionState ?? "unknown",
    iceConnectionState: context.iceConnectionState ?? "unknown",
    signalingState: context.signalingState ?? "unknown",
    inbound,
    remoteInbound,
    candidatePair,
    maxInboundJitterMs,
    maxJitterBufferAverageDelayMs,
  };
}

export function createWebRtcTelemetryObserver(
  provider: WebRtcStatsProvider,
  options: WebRtcTelemetryObserverOptions,
): WebRtcTelemetryObserver {
  const intervalMs = Math.max(250, Math.trunc(options.intervalMs ?? 1_000));
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let sequence = 0;
  let previous: WebRtcTelemetrySample | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let sampling = false;

  const sampleNow = async (): Promise<WebRtcTelemetrySample> => {
    const report = await provider.getStats();
    const sample = normalizeWebRtcStats(report, {
      sourceId: options.sourceId,
      sequence: ++sequence,
      observedAtMs: now(),
      connectionState: provider.connectionState,
      iceConnectionState: provider.iceConnectionState,
      signalingState: provider.signalingState,
    }, previous);
    previous = sample;
    return sample;
  };

  const scheduleNext = () => {
    if (stopped || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      if (stopped || sampling) {
        scheduleNext();
        return;
      }
      sampling = true;
      void sampleNow()
        .then((sample) => options.onSample(sample))
        .catch((reason) => options.onError?.(reason instanceof Error ? reason : new Error(String(reason))))
        .finally(() => {
          sampling = false;
          scheduleNext();
        });
    }, intervalMs);
  };

  return {
    sampleNow,
    start() {
      if (!stopped) return;
      stopped = false;
      scheduleNext();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
