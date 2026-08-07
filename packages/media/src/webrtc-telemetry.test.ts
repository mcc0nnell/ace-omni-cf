import { describe, expect, it } from "vitest";
import {
  createWebRtcTelemetryObserver,
  normalizeWebRtcStats,
  type WebRtcStatsProvider,
} from "./webrtc-telemetry";

function report(...stats: Array<Record<string, unknown>>): RTCStatsReport {
  const values = new Map(stats.map((stat) => [String(stat.id), stat]));
  return values as unknown as RTCStatsReport;
}

describe("WebRTC telemetry", () => {
  it("normalizes RTP jitter, jitter-buffer delay, RTT, loss, freezes, and concealment", () => {
    const sample = normalizeWebRtcStats(
      report(
        {
          id: "inbound-video",
          type: "inbound-rtp",
          kind: "video",
          timestamp: 10_001,
          jitter: 0.043,
          packetsReceived: 950,
          packetsLost: 50,
          jitterBufferDelay: 18,
          jitterBufferEmittedCount: 200,
          jitterBufferTargetDelay: 22,
          jitterBufferMinimumDelay: 12,
          framesDecoded: 300,
          framesDropped: 7,
          freezeCount: 3,
          totalFreezesDuration: 1.25,
        },
        {
          id: "inbound-audio",
          type: "inbound-rtp",
          kind: "audio",
          timestamp: 10_002,
          jitter: 0.012,
          packetsReceived: 1_980,
          packetsLost: 20,
          jitterBufferDelay: 4,
          jitterBufferEmittedCount: 200,
          concealedSamples: 1_200,
          concealmentEvents: 4,
        },
        {
          id: "remote-inbound-video",
          type: "remote-inbound-rtp",
          kind: "video",
          timestamp: 10_003,
          jitter: 0.031,
          roundTripTime: 0.087,
          packetsLost: 2,
          fractionLost: 0.02,
        },
        {
          id: "transport-1",
          type: "transport",
          timestamp: 10_004,
          selectedCandidatePairId: "pair-1",
        },
        {
          id: "pair-1",
          type: "candidate-pair",
          timestamp: 10_005,
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.091,
          availableIncomingBitrate: 2_000_000,
          availableOutgoingBitrate: 1_500_000,
          bytesReceived: 123_456,
          bytesSent: 78_900,
        },
      ),
      {
        sourceId: "pc-1",
        sequence: 1,
        observedAtMs: 20_000,
        connectionState: "connected",
        iceConnectionState: "connected",
        signalingState: "stable",
      },
    );

    expect(sample.statsTimestampMs).toBe(10_005);
    expect(sample.maxInboundJitterMs).toBeCloseTo(43);
    expect(sample.maxJitterBufferAverageDelayMs).toBeCloseTo(90);
    expect(sample.inbound[0]).toMatchObject({
      id: "inbound-audio",
      jitterMs: 12,
      packetLossPercent: 1,
      jitterBufferAverageDelayMs: 20,
      concealedSamples: 1_200,
      concealmentEvents: 4,
    });
    expect(sample.inbound[1]).toMatchObject({
      id: "inbound-video",
      jitterMs: 43,
      packetLossPercent: 5,
      jitterBufferAverageDelayMs: 90,
      jitterBufferTargetDelayMs: 110,
      jitterBufferMinimumDelayMs: 60,
      framesDropped: 7,
      freezeCount: 3,
      totalFreezesDurationMs: 1_250,
    });
    expect(sample.remoteInbound[0]).toMatchObject({
      jitterMs: 31,
      roundTripTimeMs: 87,
    });
    expect(sample.candidatePair).toMatchObject({
      id: "pair-1",
      currentRoundTripTimeMs: 91,
      availableIncomingBitrate: 2_000_000,
    });
  });

  it("computes interval loss, dropped-frame, freeze, and concealment deltas", () => {
    const first = normalizeWebRtcStats(
      report({
        id: "inbound-video",
        type: "inbound-rtp",
        kind: "video",
        timestamp: 1_000,
        packetsReceived: 100,
        packetsLost: 5,
        framesDropped: 2,
        freezeCount: 1,
        concealmentEvents: 3,
      }),
      { sourceId: "pc-1", sequence: 1, observedAtMs: 1_100 },
    );
    const second = normalizeWebRtcStats(
      report({
        id: "inbound-video",
        type: "inbound-rtp",
        kind: "video",
        timestamp: 2_000,
        packetsReceived: 190,
        packetsLost: 15,
        framesDropped: 5,
        freezeCount: 3,
        concealmentEvents: 7,
      }),
      { sourceId: "pc-1", sequence: 2, observedAtMs: 2_100 },
      first,
    );

    expect(second.inbound[0]).toMatchObject({
      packetsReceivedDelta: 90,
      packetsLostDelta: 10,
      intervalPacketLossPercent: 10,
      framesDroppedDelta: 3,
      freezeCountDelta: 2,
      concealmentEventsDelta: 4,
    });
  });

  it("samples the real getStats interface with stable source identity and sequence", async () => {
    let timestamp = 1_000;
    const provider: WebRtcStatsProvider = {
      connectionState: "connected",
      iceConnectionState: "connected",
      signalingState: "stable",
      async getStats() {
        timestamp += 1_000;
        return report({
          id: "audio",
          type: "inbound-rtp",
          kind: "audio",
          timestamp,
          jitter: timestamp === 2_000 ? 0.01 : 0.08,
          packetsReceived: timestamp === 2_000 ? 100 : 190,
          packetsLost: timestamp === 2_000 ? 0 : 10,
        });
      },
    };
    let now = 10_000;
    const observer = createWebRtcTelemetryObserver(provider, {
      sourceId: "peer-connection-7",
      now: () => ++now,
      onSample: () => {},
    });

    const first = await observer.sampleNow();
    const second = await observer.sampleNow();

    expect(first).toMatchObject({ sourceId: "peer-connection-7", sequence: 1, maxInboundJitterMs: 10 });
    expect(second).toMatchObject({ sourceId: "peer-connection-7", sequence: 2, maxInboundJitterMs: 80 });
    expect(second.inbound[0]).toMatchObject({
      packetsReceivedDelta: 90,
      packetsLostDelta: 10,
      intervalPacketLossPercent: 10,
    });
  });

  it("chooses a nominated succeeded candidate pair when transport selection is unavailable", () => {
    const sample = normalizeWebRtcStats(
      report(
        {
          id: "failed-pair",
          type: "candidate-pair",
          timestamp: 1,
          state: "failed",
          nominated: false,
          currentRoundTripTime: 9,
        },
        {
          id: "good-pair",
          type: "candidate-pair",
          timestamp: 2,
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.04,
        },
      ),
      { sourceId: "pc", sequence: 1, observedAtMs: 3 },
    );
    expect(sample.candidatePair).toMatchObject({ id: "good-pair", currentRoundTripTimeMs: 40 });
  });
});
