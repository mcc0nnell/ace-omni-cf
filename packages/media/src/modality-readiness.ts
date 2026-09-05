import type { WebRtcTelemetrySample } from "./webrtc-telemetry";

export type ReadinessState = "unknown" | "pending" | "ready" | "failed";

export interface ModalityReadinessSignals {
  /** Signaling-layer session establishment, for example a SIP dialog. */
  sessionEstablished?: boolean;
  sessionFailed?: boolean;
  /** Browser/presentation observation. Decoding a frame is not enough. */
  firstVideoFrameObserved?: boolean;
  videoRenderFailed?: boolean;
  /** RTT observations are intentionally external to WebRTC RTP telemetry. */
  rttNegotiated?: boolean;
  rttFailed?: boolean;
  firstT140CharacterObserved?: boolean;
}

export interface ModalityReadinessRequirements {
  audio?: boolean;
  video?: boolean;
  rtt?: boolean;
}

export interface ModalityReadinessObservation {
  version: 1;
  sourceId: string;
  sequence: number;
  observedAtMs: number;
  signaling: {
    session: ReadinessState;
    peerConnection: ReadinessState;
  };
  transport: {
    ice: ReadinessState;
    candidatePair: ReadinessState;
  };
  media: {
    audioInbound: ReadinessState;
    videoInbound: ReadinessState;
    videoDecoded: ReadinessState;
    videoRendered: ReadinessState;
  };
  rtt: {
    negotiated: ReadinessState;
    firstT140Character: ReadinessState;
    ready: ReadinessState;
  };
  required: {
    audio: boolean;
    video: boolean;
    rtt: boolean;
  };
  overall: ReadinessState;
}

function observedFlag(value: boolean | undefined, failed = false): ReadinessState {
  if (failed) return "failed";
  if (value === true) return "ready";
  if (value === false) return "pending";
  return "unknown";
}

function signalingState(value: string): ReadinessState {
  if (value === "stable") return "ready";
  if (value === "closed") return "failed";
  if (value === "unknown") return "unknown";
  return "pending";
}

function iceState(value: string): ReadinessState {
  if (value === "connected" || value === "completed") return "ready";
  if (value === "failed" || value === "closed") return "failed";
  if (value === "unknown") return "unknown";
  return "pending";
}

function candidatePairState(sample: WebRtcTelemetrySample): ReadinessState {
  const pair = sample.candidatePair;
  if (!pair) return "unknown";
  if (pair.state === "succeeded") return "ready";
  if (pair.state === "failed") return "failed";
  return "pending";
}

function inboundState(
  sample: WebRtcTelemetrySample,
  kind: "audio" | "video",
): ReadinessState {
  const streams = sample.inbound.filter((entry) => entry.kind === kind);
  if (streams.length === 0) return "unknown";
  return streams.some((entry) => (entry.packetsReceived ?? 0) > 0) ? "ready" : "pending";
}

function decodedVideoState(sample: WebRtcTelemetrySample): ReadinessState {
  const streams = sample.inbound.filter((entry) => entry.kind === "video");
  if (streams.length === 0) return "unknown";
  return streams.some((entry) => (entry.framesDecoded ?? 0) > 0) ? "ready" : "pending";
}

function combine(states: ReadinessState[]): ReadinessState {
  if (states.some((state) => state === "failed")) return "failed";
  if (states.every((state) => state === "ready")) return "ready";
  if (states.every((state) => state === "unknown")) return "unknown";
  return "pending";
}

/**
 * Derives a portable readiness observation without treating signaling, ICE,
 * media decoding, media presentation, or RTT as interchangeable facts.
 */
export function deriveModalityReadiness(
  sample: WebRtcTelemetrySample,
  signals: ModalityReadinessSignals = {},
  requirements: ModalityReadinessRequirements = {},
): ModalityReadinessObservation {
  const required = {
    audio: requirements.audio ?? true,
    video: requirements.video ?? true,
    rtt: requirements.rtt ?? false,
  };

  const session = observedFlag(signals.sessionEstablished, signals.sessionFailed);
  const peerConnection = signalingState(sample.signalingState);
  const ice = iceState(sample.iceConnectionState);
  const candidatePair = candidatePairState(sample);
  const audioInbound = inboundState(sample, "audio");
  const videoInbound = inboundState(sample, "video");
  const videoDecoded = decodedVideoState(sample);
  const videoRendered = observedFlag(
    signals.firstVideoFrameObserved,
    signals.videoRenderFailed,
  );
  const negotiated = observedFlag(signals.rttNegotiated, signals.rttFailed);
  const firstT140Character = observedFlag(signals.firstT140CharacterObserved, signals.rttFailed);
  const rttReady = combine([negotiated, firstT140Character]);

  const requiredStates: ReadinessState[] = [session, peerConnection, ice, candidatePair];
  if (required.audio) requiredStates.push(audioInbound);
  if (required.video) requiredStates.push(videoInbound, videoDecoded, videoRendered);
  if (required.rtt) requiredStates.push(rttReady);

  return {
    version: 1,
    sourceId: sample.sourceId,
    sequence: sample.sequence,
    observedAtMs: sample.observedAtMs,
    signaling: { session, peerConnection },
    transport: { ice, candidatePair },
    media: { audioInbound, videoInbound, videoDecoded, videoRendered },
    rtt: { negotiated, firstT140Character, ready: rttReady },
    required,
    overall: combine(requiredStates),
  };
}
