/**
 * Deterministic browser-media primitives for ACE Omni research calls.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import type {
  ExperimentSchedule,
  ScheduledManipulation,
} from "@ace-omni/domain";

export * from "./webrtc-telemetry";

export interface AudioClockObservation {
  callClockStartMs: number;
  observedAtMs: number;
  audioContextTimeSec: number;
  sampleRate: number;
}

export interface WorkletScheduleCommand {
  kind: "schedule";
  id: string;
  type: ScheduledManipulation["type"];
  targetStream: ScheduledManipulation["targetStream"];
  startFrame: number;
  endFrame: number;
  parameters: Record<string, unknown>;
  seed: number;
}

/** Mulberry32: small deterministic PRNG whose output is stable across browsers. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function buildWorkletCommand(
  manipulation: ScheduledManipulation,
  observation: AudioClockObservation,
): WorkletScheduleCommand {
  const startAtMs = observation.callClockStartMs + manipulation.startOffsetMs;
  const startContextSec =
    observation.audioContextTimeSec + (startAtMs - observation.observedAtMs) / 1_000;
  const startFrame = Math.max(0, Math.round(startContextSec * observation.sampleRate));
  const durationFrames = Math.max(1, Math.round(
    (manipulation.durationMs / 1_000) * observation.sampleRate,
  ));
  return {
    kind: "schedule",
    id: manipulation.id,
    type: manipulation.type,
    targetStream: manipulation.targetStream,
    startFrame,
    endFrame: startFrame + durationFrames,
    parameters: manipulation.parameters,
    seed: manipulation.seed,
  };
}

export interface ManipulationScheduleHandlers {
  onAcknowledged(manipulation: ScheduledManipulation, actualTimeMs: number): void;
  onExecute(manipulation: ScheduledManipulation, actualTimeMs: number): void;
  onComplete?(manipulation: ScheduledManipulation, actualTimeMs: number): void;
}

export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Schedules only manipulations cryptographically assigned to this runtime
 * participant. The acknowledgement and execution callbacks receive observed
 * client wall-clock time so the server can preserve schedule variance.
 */
export function scheduleParticipantManipulations(
  schedule: ExperimentSchedule,
  participantId: string,
  handlers: ManipulationScheduleHandlers,
  clock: SchedulerClock = systemClock,
): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  for (const manipulation of schedule.manipulations) {
    if (manipulation.targetParticipantId !== participantId) continue;
    handlers.onAcknowledged(manipulation, clock.now());
    const startAtMs = schedule.callClockStartMs + manipulation.startOffsetMs;
    timers.push(clock.setTimeout(() => {
      handlers.onExecute(manipulation, clock.now());
      if (handlers.onComplete) {
        timers.push(clock.setTimeout(
          () => handlers.onComplete?.(manipulation, clock.now()),
          manipulation.durationMs,
        ));
      }
    }, Math.max(0, startAtMs - clock.now())));
  }
  return () => timers.forEach((timer) => clock.clearTimeout(timer));
}

export interface AudioManipulationGraph {
  context: AudioContext;
  node: AudioWorkletNode;
  stream: MediaStream;
  schedule(manipulation: ScheduledManipulation, callClockStartMs: number): void;
  onExecution(listener: (event: { id: string; kind: "executed" | "completed"; actualTimeMs: number }) => void): () => void;
  close(): Promise<void>;
}

export async function createAudioManipulationGraph(
  input: MediaStream,
  workletModuleUrl: string,
  processorName = "ace-omni-manipulation",
): Promise<AudioManipulationGraph> {
  const context = new AudioContext();
  await context.audioWorklet.addModule(workletModuleUrl);
  await context.resume();
  const source = context.createMediaStreamSource(input);
  const node = new AudioWorkletNode(context, processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [Math.max(1, source.channelCount || 1)],
  });
  const destination = context.createMediaStreamDestination();
  const clockBases = new Map<string, number>();
  const executionListeners = new Set<
    (event: { id: string; kind: "executed" | "completed"; actualTimeMs: number }) => void
  >();
  node.port.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data as { id?: unknown; kind?: unknown; frame?: unknown };
    if (
      typeof message.id !== "string" ||
      (message.kind !== "executed" && message.kind !== "completed") ||
      typeof message.frame !== "number"
    ) return;
    const base = clockBases.get(message.id);
    if (base === undefined) return;
    const actualTimeMs = Math.round(base + (message.frame / context.sampleRate) * 1_000);
    for (const listener of executionListeners) {
      listener({ id: message.id, kind: message.kind, actualTimeMs });
    }
  });
  node.port.start();
  source.connect(node).connect(destination);
  return {
    context,
    node,
    stream: destination.stream,
    schedule(manipulation, callClockStartMs) {
      const observedAtMs = Date.now();
      const audioContextTimeSec = context.currentTime;
      clockBases.set(manipulation.id, observedAtMs - audioContextTimeSec * 1_000);
      node.port.postMessage(buildWorkletCommand(manipulation, {
        callClockStartMs,
        observedAtMs,
        audioContextTimeSec,
        sampleRate: context.sampleRate,
      }));
    },
    onExecution(listener) {
      executionListeners.add(listener);
      return () => executionListeners.delete(listener);
    },
    async close() {
      source.disconnect();
      node.disconnect();
      destination.disconnect();
      await context.close();
    },
  };
}

export interface ActiveRecording {
  mimeType: string;
  stop(): Promise<Blob>;
}

export function startRecording(stream: MediaStream, preferredMimeTypes: string[]): ActiveRecording {
  const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  let stopped: Promise<Blob> | null = null;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(250);
  return {
    mimeType: recorder.mimeType || mimeType || "application/octet-stream",
    stop() {
      if (stopped) return stopped;
      stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", () => {
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        }, { once: true });
        recorder.addEventListener("error", () => reject(new Error("MediaRecorder failed")), { once: true });
        recorder.stop();
      });
      return stopped;
    },
  };
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
