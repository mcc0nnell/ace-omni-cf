import { describe, expect, it } from "vitest";
import { deriveModalityReadiness } from "./modality-readiness";
import type { WebRtcTelemetrySample } from "./webrtc-telemetry";

function sample(overrides: Partial<WebRtcTelemetrySample> = {}): WebRtcTelemetrySample {
  return {
    version: 1,
    sourceId: "browser-a",
    sequence: 1,
    observedAtMs: 1_000,
    statsTimestampMs: 1_000,
    connectionState: "connected",
    iceConnectionState: "connected",
    signalingState: "stable",
    inbound: [
      {
        id: "audio-1",
        kind: "audio",
        statsTimestampMs: 1_000,
        packetsReceived: 20,
      },
      {
        id: "video-1",
        kind: "video",
        statsTimestampMs: 1_000,
        packetsReceived: 20,
        framesDecoded: 2,
      },
    ],
    remoteInbound: [],
    candidatePair: {
      id: "pair-1",
      statsTimestampMs: 1_000,
      state: "succeeded",
      nominated: true,
    },
    maxInboundJitterMs: null,
    maxJitterBufferAverageDelayMs: null,
    ...overrides,
  };
}

describe("modality readiness", () => {
  it("does not treat a stable SIP/WebRTC session as proof that video rendered", () => {
    const readiness = deriveModalityReadiness(
      sample(),
      { sessionEstablished: true },
    );

    expect(readiness.signaling.session).toBe("ready");
    expect(readiness.transport.ice).toBe("ready");
    expect(readiness.media.videoDecoded).toBe("ready");
    expect(readiness.media.videoRendered).toBe("unknown");
    expect(readiness.overall).toBe("pending");
  });

  it("captures the ACE-style stalled ICE condition independently from signaling", () => {
    const readiness = deriveModalityReadiness(
      sample({
        iceConnectionState: "checking",
        candidatePair: null,
        inbound: [],
      }),
      { sessionEstablished: true, firstVideoFrameObserved: false },
    );

    expect(readiness.signaling.session).toBe("ready");
    expect(readiness.transport.ice).toBe("pending");
    expect(readiness.transport.candidatePair).toBe("unknown");
    expect(readiness.media.videoRendered).toBe("pending");
    expect(readiness.overall).toBe("pending");
  });

  it("keeps RTT readiness independent from video readiness", () => {
    const readiness = deriveModalityReadiness(
      sample(),
      {
        sessionEstablished: true,
        firstVideoFrameObserved: true,
        rttNegotiated: true,
        firstT140CharacterObserved: false,
      },
      { rtt: true },
    );

    expect(readiness.media.videoRendered).toBe("ready");
    expect(readiness.rtt.negotiated).toBe("ready");
    expect(readiness.rtt.firstT140Character).toBe("pending");
    expect(readiness.rtt.ready).toBe("pending");
    expect(readiness.overall).toBe("pending");
  });

  it("becomes ready only when every required modality has observed evidence", () => {
    const readiness = deriveModalityReadiness(
      sample(),
      {
        sessionEstablished: true,
        firstVideoFrameObserved: true,
        rttNegotiated: true,
        firstT140CharacterObserved: true,
      },
      { rtt: true },
    );

    expect(readiness.overall).toBe("ready");
  });
});
