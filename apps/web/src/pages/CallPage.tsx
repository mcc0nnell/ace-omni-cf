import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExperimentScheduleSchema,
  type EvidenceArtifactType,
  type ExperimentSchedule,
  type ScheduledManipulation,
} from "@ace-omni/domain";
import {
  createAudioManipulationGraph,
  createSeededRandom,
  sha256Blob,
  startRecording,
  type ActiveRecording,
  type AudioManipulationGraph,
} from "@ace-omni/media";
import { api, type ParticipantSession } from "../lib/api";

interface PublicParticipant {
  id: string;
  name: string;
  role: string;
}

interface Caption {
  id: string;
  text: string;
  isFinal: boolean;
  atMs: number;
}

interface RecordingEntry {
  artifactType: EvidenceArtifactType;
  contentType: "audio/webm" | "video/webm";
  capturedAt: string;
  recording: ActiveRecording;
}

function audioOnly(stream: MediaStream): MediaStream {
  return new MediaStream(stream.getAudioTracks());
}

function manipulationRandom(manipulation: ScheduledManipulation, utteranceId: string): number {
  let hash = manipulation.seed >>> 0;
  for (let index = 0; index < utteranceId.length; index += 1) {
    hash = Math.imul(hash ^ utteranceId.charCodeAt(index), 16_777_619) >>> 0;
  }
  return createSeededRandom(hash)();
}

export default function CallPage({ callId }: { callId: string }) {
  const [session] = useState<ParticipantSession | null>(() => {
    if (!callId) return null;
    const value = sessionStorage.getItem(`omni_participant:${callId}`);
    if (!value) return null;
    try {
      return JSON.parse(value) as ParticipantSession;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState("Preparing authenticated room…");
  const [peers, setPeers] = useState<PublicParticipant[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [schedule, setSchedule] = useState<ExperimentSchedule | null>(null);
  const [ended, setEnded] = useState(false);
  const [evidenceProgress, setEvidenceProgress] = useState("Not started");
  const [mediaConnected, setMediaConnected] = useState(false);
  const [peerState, setPeerState] = useState({
    connection: "new",
    ice: "new",
    gathering: "new",
    signaling: "stable",
    candidates: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const outgoingGraphRef = useRef<AudioManipulationGraph | null>(null);
  const incomingGraphRef = useRef<AudioManipulationGraph | null>(null);
  const callClockStartRef = useRef<number | null>(null);
  const scheduleRef = useRef<ExperimentSchedule | null>(null);
  const activeRef = useRef(false);
  const recordingsRef = useRef(new Map<EvidenceArtifactType, RecordingEntry>());
  const finishEvidenceRef = useRef<() => Promise<void>>(async () => {});
  const evidenceFinishingRef = useRef(false);
  const rawCaptionLogRef = useRef<Array<Record<string, unknown>>>([]);
  const displayedCaptionLogRef = useRef<Array<Record<string, unknown>>>([]);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const manipulatedRemoteAudioRef = useRef<HTMLAudioElement>(null);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    if (!session || !callId || session.callId !== callId) return;
    let cancelled = false;

    const ownConfig = session.config.participants.find(
      (participant) => participant.id === session.participantConfigId,
    );
    if (!ownConfig) {
      setStatus("Pinned participant configuration is missing");
      return;
    }
    const participantSession = session;
    const securedCallId = callId;
    const participantConfig = ownConfig;

    const addTimer = (timer: ReturnType<typeof setTimeout>) => timersRef.current.push(timer);

    const registerExecution = (graph: AudioManipulationGraph) => graph.onExecution((event) => {
      if (event.kind !== "executed") return;
      send({
        type: "manipulation_executed",
        manipulationId: event.id,
        clientClockMs: event.actualTimeMs,
      });
    });

    const startRecorder = (
      artifactType: EvidenceArtifactType,
      stream: MediaStream,
      contentType: "audio/webm" | "video/webm",
    ) => {
      if (recordingsRef.current.has(artifactType)) return;
      const relevantTracks = contentType === "audio/webm" ? stream.getAudioTracks() : stream.getVideoTracks();
      if (relevantTracks.length === 0) return;
      const recordingStream = contentType === "audio/webm" ? audioOnly(stream) : stream;
      const recording = startRecording(
        recordingStream,
        contentType === "audio/webm"
          ? ["audio/webm;codecs=opus", "audio/webm"]
          : ["video/webm;codecs=vp8,opus", "video/webm"],
      );
      recordingsRef.current.set(artifactType, {
        artifactType,
        contentType,
        capturedAt: new Date().toISOString(),
        recording,
      });
      send({ type: "recording_started", artifactType, clientClockMs: Date.now() });
    };

    const startLocalEvidence = () => {
      const policy = session.config.evidencePolicy;
      const local = localStreamRef.current;
      if (!local) return;
      if (policy.microphoneAudio) startRecorder("microphone_audio", local, "audio/webm");
      if (policy.localVideo) startRecorder("local_video", local, "video/webm");
      if (policy.manipulatedAudio && outgoingGraphRef.current) {
        startRecorder("manipulated_audio", outgoingGraphRef.current.stream, "audio/webm");
      }
    };

    const startRemoteEvidence = () => {
      if (!activeRef.current || !remoteStreamRef.current) return;
      const policy = session.config.evidencePolicy;
      if (policy.receivedAudio) startRecorder("received_audio", remoteStreamRef.current, "audio/webm");
      if (policy.remoteVideo) startRecorder("remote_video", remoteStreamRef.current, "video/webm");
    };

    const scheduleAssignedManipulations = (signedSchedule: ExperimentSchedule) => {
      const assigned = signedSchedule.manipulations.filter(
        (manipulation) => manipulation.targetParticipantId === session.participantId,
      );
      for (const manipulation of assigned) {
        send({
          type: "manipulation_ack",
          manipulationId: manipulation.id,
          clientClockMs: Date.now(),
        });
        const graph = manipulation.targetStream === "incoming"
          ? incomingGraphRef.current
          : outgoingGraphRef.current;
        if (manipulation.targetStream !== "captions" && graph) {
          graph.schedule(manipulation, signedSchedule.callClockStartMs);
          continue;
        }
        if (manipulation.targetStream === "captions") {
          const delay = Math.max(
            0,
            signedSchedule.callClockStartMs + manipulation.startOffsetMs - Date.now(),
          );
          addTimer(setTimeout(() => {
            setStatus(`Caption condition active: ${manipulation.type}`);
            send({
              type: "manipulation_executed",
              manipulationId: manipulation.id,
              clientClockMs: Date.now(),
            });
            addTimer(setTimeout(() => {
              if (activeRef.current) setStatus("Call active");
            }, manipulation.durationMs));
          }, delay));
        }
      }
    };

    const displayIncomingCaption = (message: {
      fromId: string;
      utteranceId: string;
      text: string;
      isFinal: boolean;
      clientClockMs: number;
    }) => {
      rawCaptionLogRef.current.push({ ...message, receivedAt: Date.now() });
      const signedSchedule = scheduleRef.current;
      const start = callClockStartRef.current;
      const offset = start === null ? -1 : Date.now() - start;
      const activeCaptionManipulations = signedSchedule?.manipulations.filter(
        (manipulation) =>
          manipulation.targetParticipantId === session.participantId &&
          manipulation.targetStream === "captions" &&
          offset >= manipulation.startOffsetMs &&
          offset < manipulation.startOffsetMs + manipulation.durationMs,
      ) ?? [];
      const dropout = activeCaptionManipulations.find((entry) => entry.type === "caption_dropout");
      if (dropout) {
        const probability = Number(dropout.parameters.probability ?? 1);
        if (manipulationRandom(dropout, message.utteranceId) < probability) return;
      }
      let text = message.text;
      const error = activeCaptionManipulations.find((entry) => entry.type === "caption_error");
      if (error && manipulationRandom(error, message.utteranceId) < Number(error.parameters.probability ?? 1)) {
        text = text.replace(/[aeiou]/i, "□");
      }
      const scheduledDelay = activeCaptionManipulations
        .filter((entry) => entry.type === "caption_delay")
        .reduce((delay, entry) => Math.max(delay, Number(entry.parameters.delayMs ?? 0)), 0);
      const delay = ownConfig.captions.baseDelayMs + scheduledDelay;
      addTimer(setTimeout(() => {
        const displayedAt = Date.now();
        const caption = { id: message.utteranceId, text, isFinal: message.isFinal, atMs: displayedAt };
        setCaptions((existing) => [...existing.slice(-39), caption]);
        displayedCaptionLogRef.current.push({ ...caption, fromId: message.fromId });
        send({
          type: "caption_displayed",
          utteranceId: message.utteranceId,
          text,
          isFinal: message.isFinal,
          clientClockMs: displayedAt,
        });
      }, delay));
    };

    const startMockCaptions = (callClockStartMs: number) => {
      const utterances = session.config.mockAsr.utterances ?? [
        "Synthetic ACE Omni caption stream is active.",
      ];
      let index = 0;
      const emit = () => {
        if (!activeRef.current) return;
        const text = utterances[index % utterances.length]!;
        index += 1;
        const utteranceId = `${session.participantId}:${index}`;
        const clientClockMs = Date.now();
        rawCaptionLogRef.current.push({
          utteranceId,
          text,
          isFinal: true,
          fromId: session.participantId,
          clientClockMs,
        });
        send({ type: "caption_raw", utteranceId, text, isFinal: true, clientClockMs });
      };
      addTimer(setTimeout(() => {
        emit();
        const interval = setInterval(emit, session.config.timing.mockCaptionIntervalMs);
        timersRef.current.push(interval);
      }, Math.max(0, callClockStartMs - Date.now())));
    };

    const uploadBlob = async (
      artifactType: EvidenceArtifactType,
      contentType: "audio/webm" | "video/webm" | "application/json",
      capturedAt: string,
      blob: Blob,
    ) => {
      const sha256 = await sha256Blob(blob);
      const authorization = await api.authorizeEvidenceUpload(callId, session.participantToken, {
        artifactType,
        contentType,
        sizeBytes: blob.size,
        sha256,
        capturedAt,
      });
      await api.uploadEvidence(
        authorization.uploadUrl,
        authorization.uploadToken,
        blob,
        contentType,
      );
    };

    const finishEvidence = async () => {
      if (evidenceFinishingRef.current) return;
      evidenceFinishingRef.current = true;
      setEvidenceProgress("Stopping recorders…");
      const entries = [...recordingsRef.current.values()];
      for (const entry of entries) {
        send({ type: "recording_stopped", artifactType: entry.artifactType, clientClockMs: Date.now() });
      }
      try {
        const artifacts: Array<{
          type: EvidenceArtifactType;
          contentType: "audio/webm" | "video/webm" | "application/json";
          capturedAt: string;
          blob: Blob;
        }> = await Promise.all(entries.map(async (entry) => ({
          type: entry.artifactType,
          contentType: entry.contentType,
          capturedAt: entry.capturedAt,
          blob: await entry.recording.stop(),
        })));
        const policy = session.config.evidencePolicy;
        if (policy.rawCaptions) {
          artifacts.push({
            type: "captions_raw",
            contentType: "application/json",
            capturedAt: new Date().toISOString(),
            blob: new Blob([JSON.stringify(rawCaptionLogRef.current)], { type: "application/json" }),
          });
        }
        if (policy.displayedCaptions) {
          artifacts.push({
            type: "captions_displayed",
            contentType: "application/json",
            capturedAt: new Date().toISOString(),
            blob: new Blob([JSON.stringify(displayedCaptionLogRef.current)], { type: "application/json" }),
          });
        }
        let uploaded = 0;
        for (const artifact of artifacts) {
          await uploadBlob(artifact.type, artifact.contentType, artifact.capturedAt, artifact.blob);
          uploaded += 1;
          setEvidenceProgress(`Uploaded ${uploaded}/${artifacts.length} artifacts`);
        }
        setEvidenceProgress(`Evidence uploaded (${uploaded} artifacts)`);
      } catch (reason) {
        setEvidenceProgress(`Evidence upload failed: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        pcRef.current?.close();
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
    finishEvidenceRef.current = finishEvidence;

    async function start() {
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: participantConfig.media.audio,
          video: participantConfig.media.video ? { width: 640, height: 480 } : false,
        });
        if (cancelled) {
          rawStream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = rawStream;
        if (localVideoRef.current) localVideoRef.current.srcObject = rawStream;

        let outgoingAudioTracks = rawStream.getAudioTracks();
        if (outgoingAudioTracks.length > 0) {
          const graph = await createAudioManipulationGraph(
            audioOnly(rawStream),
            "/audio/omni-manipulation-worklet.js",
          );
          outgoingGraphRef.current = graph;
          registerExecution(graph);
          outgoingAudioTracks = graph.stream.getAudioTracks();
        }
        const outgoingStream = new MediaStream([
          ...outgoingAudioTracks,
          ...rawStream.getVideoTracks(),
        ]);
        const peer = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = peer;
        outgoingStream.getTracks().forEach((track) => peer.addTrack(track, outgoingStream));
        peer.onconnectionstatechange = () => {
          const connected = peer.connectionState === "connected";
          setMediaConnected(connected);
          setPeerState((current) => ({ ...current, connection: peer.connectionState }));
          if (connected) setStatus("WebRTC media connected");
        };
        peer.oniceconnectionstatechange = () => {
          setPeerState((current) => ({ ...current, ice: peer.iceConnectionState }));
        };
        peer.onicegatheringstatechange = () => {
          setPeerState((current) => ({ ...current, gathering: peer.iceGatheringState }));
        };
        peer.onsignalingstatechange = () => {
          setPeerState((current) => ({ ...current, signaling: peer.signalingState }));
        };
        peer.onicecandidate = (event) => {
          if (event.candidate && peerIdRef.current) {
            setPeerState((current) => ({ ...current, candidates: current.candidates + 1 }));
            send({
              type: "ice_candidate",
              targetId: peerIdRef.current,
              candidate: event.candidate.toJSON(),
            });
          }
        };
        peer.ontrack = (event) => {
          const remote = event.streams[0] ?? new MediaStream([event.track]);
          remoteStreamRef.current = remote;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
          if (remote.getAudioTracks().length > 0 && !incomingGraphRef.current) {
            void createAudioManipulationGraph(
              audioOnly(remote),
              "/audio/omni-manipulation-worklet.js",
            ).then((graph) => {
              incomingGraphRef.current = graph;
              registerExecution(graph);
              if (remoteVideoRef.current) remoteVideoRef.current.muted = true;
              if (manipulatedRemoteAudioRef.current) manipulatedRemoteAudioRef.current.srcObject = graph.stream;
              const signedSchedule = scheduleRef.current;
              if (signedSchedule) {
                for (const manipulation of signedSchedule.manipulations) {
                  if (
                    manipulation.targetParticipantId === participantSession.participantId &&
                    manipulation.targetStream === "incoming"
                  ) graph.schedule(manipulation, signedSchedule.callClockStartMs);
                }
              }
            }).catch((reason: Error) => setStatus(`Incoming audio graph failed: ${reason.message}`));
          }
          startRemoteEvidence();
        };

        const { credential } = await api.createRoomCredential(securedCallId, participantSession.participantToken);
        const webSocketProtocol = location.protocol === "https:" ? "wss" : "ws";
        const socket = new WebSocket(
          `${webSocketProtocol}://${location.host}/api/calls/${securedCallId}/ws`,
          ["ace-omni.v1", `credential.${credential}`],
        );
        wsRef.current = socket;
        socket.addEventListener("open", () => setStatus("Authorized room connected; waiting for peer…"));
        socket.addEventListener("close", () => {
          if (activeRef.current) setStatus("Room connection closed");
        });
        socket.addEventListener("error", () => setStatus("Authenticated room connection failed"));
        socket.addEventListener("message", (event) => {
          void (async () => {
            const message = JSON.parse(String(event.data)) as Record<string, any>;
            if (message.type === "welcome") {
              const participants = (message.participants ?? []) as PublicParticipant[];
              setPeers(participants);
              peerIdRef.current = participants.find((participant) => participant.id !== participantSession.participantId)?.id ?? null;
              if (typeof message.callClockStartMs === "number") callClockStartRef.current = message.callClockStartMs;
              if (message.schedule) {
                const parsed = ExperimentScheduleSchema.safeParse(message.schedule);
                if (parsed.success) {
                  scheduleRef.current = parsed.data;
                  setSchedule(parsed.data);
                  scheduleAssignedManipulations(parsed.data);
                }
              }
              return;
            }
            if (message.type === "participant_joined" || message.type === "participant_left") {
              const participants = (message.participants ?? []) as PublicParticipant[];
              setPeers(participants);
              peerIdRef.current = participants.find((participant) => participant.id !== participantSession.participantId)?.id ?? null;
              return;
            }
            if (message.type === "call_started") {
              const startAt = Number(message.callClockStartMs);
              callClockStartRef.current = startAt;
              activeRef.current = true;
              setStatus("Call active; awaiting signed schedule");
              startLocalEvidence();
              startRemoteEvidence();
              startMockCaptions(startAt);
              const participants = (message.participants ?? []) as PublicParticipant[];
              peerIdRef.current = participants.find((participant) => participant.id !== participantSession.participantId)?.id ?? peerIdRef.current;
              if (participantSession.role === "caller" && peerIdRef.current && !peer.currentRemoteDescription) {
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                send({ type: "offer", targetId: peerIdRef.current, sdp: offer });
              }
              return;
            }
            if (message.type === "schedule_issued") {
              const parsed = ExperimentScheduleSchema.safeParse(message.schedule);
              if (!parsed.success || parsed.data.callId !== securedCallId) {
                setStatus("Rejected malformed or cross-room schedule");
                return;
              }
              scheduleRef.current = parsed.data;
              setSchedule(parsed.data);
              scheduleAssignedManipulations(parsed.data);
              setStatus("Signed experiment schedule received");
              return;
            }
            if (message.type === "offer") {
              peerIdRef.current = String(message.fromId);
              await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              send({ type: "answer", targetId: message.fromId, sdp: answer });
              return;
            }
            if (message.type === "answer") {
              peerIdRef.current = String(message.fromId);
              await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit);
              return;
            }
            if (message.type === "ice_candidate" && message.candidate) {
              await peer.addIceCandidate(message.candidate as RTCIceCandidateInit);
              return;
            }
            if (message.type === "caption_raw" && message.fromId !== participantSession.participantId) {
              displayIncomingCaption(message as {
                fromId: string;
                utteranceId: string;
                text: string;
                isFinal: boolean;
                clientClockMs: number;
              });
              return;
            }
            if (message.type === "call_ended") {
              activeRef.current = false;
              setEnded(true);
              setStatus("Call ended; securing configured evidence…");
              await finishEvidence();
              return;
            }
            if (message.type === "error") {
              setStatus(`Room rejected message: ${String(message.code)}`);
            }
          })().catch((reason: Error) => setStatus(`Call protocol error: ${reason.message}`));
        });
      } catch (reason) {
        setStatus(`Unable to start secured media: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }

    void start();
    return () => {
      cancelled = true;
      activeRef.current = false;
      timersRef.current.forEach((timer) => clearTimeout(timer));
      wsRef.current?.close();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      void outgoingGraphRef.current?.close();
      void incomingGraphRef.current?.close();
    };
  }, [callId, send, session]);

  const endCall = useCallback(() => {
    send({ type: "end_call", clientClockMs: Date.now() });
    setStatus("Ending call through authoritative room…");
  }, [send]);

  if (!session) {
    return (
      <div role="alert">
        <h1>Participant session required</h1>
        <p>Redeem the call-bound invitation in this browser context before entering the room.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.3rem" }}>{session.callName}</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>
            Server identity: {session.participantName} ({session.role}) · experiment v{session.experimentConfigVersion}
          </p>
          <p data-testid="call-status" role="status" aria-live="polite" style={{ margin: "0.25rem 0 0" }}>{status}</p>
        </div>
        <button
          data-testid="end-call"
          type="button"
          onClick={endCall}
          disabled={ended}
          style={{ padding: "0.55rem 1rem", borderRadius: 6, border: 0, background: "var(--danger)", color: "white", fontWeight: 600 }}
        >
          End call
        </button>
      </header>

      <p data-testid="webrtc-state" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        WebRTC: {peerState.connection} · ICE {peerState.ice}/{peerState.gathering} · signaling {peerState.signaling} · candidates {peerState.candidates}
      </p>
      <div
        data-testid="media-state"
        data-connected={String(mediaConnected)}
        data-connection-state={peerState.connection}
        data-ice-state={peerState.ice}
        data-gathering-state={peerState.gathering}
        data-candidates={String(peerState.candidates)}
        style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}
      >
        <figure style={{ margin: 0 }}>
          <video ref={localVideoRef} autoPlay playsInline muted aria-label="Synthetic local camera" style={{ width: "100%", aspectRatio: "4/3", background: "#000", borderRadius: 8 }} />
          <figcaption>You · {session.participantName}</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          <video ref={remoteVideoRef} autoPlay playsInline aria-label="Remote participant video" style={{ width: "100%", aspectRatio: "4/3", background: "#000", borderRadius: 8 }} />
          <audio ref={manipulatedRemoteAudioRef} autoPlay aria-label="Manipulated remote audio" />
          <figcaption>{peers.find((peer) => peer.id !== session.participantId)?.name ?? "Waiting for peer"}</figcaption>
        </figure>
      </div>

      <section aria-labelledby="captions-heading" style={{ marginTop: "1rem", padding: "1rem", minHeight: 150, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <h2 id="captions-heading" style={{ marginTop: 0 }}>Mock captions</h2>
        <div data-testid="caption-log" role="log" aria-live="polite">
          {captions.length === 0 ? <p style={{ color: "var(--muted)" }}>Waiting for synthetic utterances…</p> : captions.map((caption) => (
            <p key={caption.id} style={{ opacity: caption.isFinal ? 1 : 0.7 }}>{caption.text}</p>
          ))}
        </div>
      </section>

      <section aria-labelledby="evidence-heading" style={{ marginTop: "1rem" }}>
        <h2 id="evidence-heading">Evidence capture</h2>
        <p data-testid="evidence-status" role="status">{evidenceProgress}</p>
      </section>

      {schedule && (
        <details data-testid="signed-schedule" style={{ marginTop: "1rem" }}>
          <summary>
            Signed schedule revision {schedule.scheduleRevision} · {schedule.manipulations.length} expanded conditions
          </summary>
          <p>Algorithm: {schedule.algorithm} · signature: <code>{schedule.signature}</code></p>
          <pre style={{ overflow: "auto", fontSize: "0.75rem" }}>{JSON.stringify(schedule.manipulations, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
