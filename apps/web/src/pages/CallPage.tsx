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
import {
  ReliableRoomClient,
  type DurableRoomMessage,
  type RoomConnectionStatus,
} from "../lib/reliable-room-client";

interface PublicParticipant {
  id: string;
  name: string;
  role: string;
}

interface Caption {
  id: string;
  fromId: string;
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
  const [roomConnected, setRoomConnected] = useState(false);
  const [pendingRoomEvents, setPendingRoomEvents] = useState(0);
  const [peerState, setPeerState] = useState({
    connection: "new",
    ice: "new",
    gathering: "new",
    signaling: "stable",
    candidates: 0,
  });

  const roomClientRef = useRef<ReliableRoomClient | null>(null);
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
  const scheduledManipulationsRef = useRef(new Set<string>());
  const mockCaptionsStartedRef = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const manipulatedRemoteAudioRef = useRef<HTMLAudioElement>(null);

  const send = useCallback((message: Record<string, unknown>) => {
    return roomClientRef.current?.sendEphemeral(message) ?? false;
  }, []);

  const sendDurable = useCallback((message: DurableRoomMessage, clientEventId: string) => {
    try {
      const client = roomClientRef.current;
      if (!client) throw new Error("authenticated room transport is not ready");
      client.sendDurable(message, clientEventId);
    } catch (reason) {
      setStatus(`Unable to preserve research event: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, []);

  useEffect(() => {
    if (!session || !callId || session.callId !== callId) return;
    let cancelled = false;
    scheduledManipulationsRef.current.clear();
    mockCaptionsStartedRef.current = false;

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
      sendDurable({
        type: "manipulation_executed",
        manipulationId: event.id,
        clientClockMs: event.actualTimeMs,
      }, `execute:${event.id}`);
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
      sendDurable(
        { type: "recording_started", artifactType, clientClockMs: Date.now() },
        `recording:${artifactType}:started`,
      );
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
        const scheduleKey = `${signedSchedule.scheduleRevision}:${manipulation.id}`;
        if (scheduledManipulationsRef.current.has(scheduleKey)) continue;
        scheduledManipulationsRef.current.add(scheduleKey);
        sendDurable({
          type: "manipulation_ack",
          manipulationId: manipulation.id,
          clientClockMs: Date.now(),
        }, `ack:${scheduleKey}`);
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
            sendDurable({
              type: "manipulation_executed",
              manipulationId: manipulation.id,
              clientClockMs: Date.now(),
            }, `execute:${manipulation.id}`);
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
        const caption = {
          id: message.utteranceId,
          fromId: message.fromId,
          text,
          isFinal: message.isFinal,
          atMs: displayedAt,
        };
        setCaptions((existing) => [...existing.slice(-39), caption]);
        displayedCaptionLogRef.current.push({ ...caption, fromId: message.fromId });
        sendDurable({
          type: "caption_displayed",
          utteranceId: message.utteranceId,
          text,
          isFinal: message.isFinal,
          clientClockMs: displayedAt,
        }, `caption:${message.utteranceId}:displayed`);
      }, delay));
    };

    const startMockCaptions = (callClockStartMs: number) => {
      if (mockCaptionsStartedRef.current) return;
      mockCaptionsStartedRef.current = true;
      const utterances = session.config.mockAsr.utterances ?? [
        "Synthetic ACE Omni caption stream is active.",
      ];
      const sequenceKey = `omni_caption_sequence:${securedCallId}:${participantSession.participantId}`;
      let index = 0;
      try {
        const restored = Number.parseInt(localStorage.getItem(sequenceKey) ?? "0", 10);
        if (Number.isSafeInteger(restored) && restored >= 0) index = restored;
      } catch {
        // Continue with an in-memory sequence; the transport reports storage failures separately.
      }
      const emit = () => {
        if (!activeRef.current) return;
        const text = utterances[index % utterances.length]!;
        index += 1;
        try {
          localStorage.setItem(sequenceKey, String(index));
        } catch {
          // Continue the live synthetic stream; transport persistence is checked separately.
        }
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
        sendDurable(
          { type: "recording_stopped", artifactType: entry.artifactType, clientClockMs: Date.now() },
          `recording:${entry.artifactType}:stopped`,
        );
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

        let negotiating = false;
        const negotiateAsCaller = async (iceRestart = false) => {
          if (
            participantSession.role !== "caller" ||
            !peerIdRef.current ||
            negotiating ||
            peer.signalingState !== "stable"
          ) return;
          negotiating = true;
          try {
            const offer = await peer.createOffer(
              iceRestart && peer.currentRemoteDescription ? { iceRestart: true } : undefined,
            );
            await peer.setLocalDescription(offer);
            send({ type: "offer", targetId: peerIdRef.current, sdp: offer });
          } finally {
            negotiating = false;
          }
        };

        const activateCall = (startAt: number) => {
          callClockStartRef.current = startAt;
          activeRef.current = true;
          startLocalEvidence();
          startRemoteEvidence();
          startMockCaptions(startAt);
        };

        const handleRoomMessage = (message: Record<string, any>) => {
          if (cancelled) return;
          void (async () => {
            if (message.type === "event_ack") return;
            if (message.type === "welcome") {
              const participants = (message.participants ?? []) as PublicParticipant[];
              setPeers(participants);
              peerIdRef.current = participants.find(
                (participant) => participant.id !== participantSession.participantId,
              )?.id ?? null;
              if (typeof message.callClockStartMs === "number") {
                callClockStartRef.current = message.callClockStartMs;
              }
              if (message.schedule) {
                const parsed = ExperimentScheduleSchema.safeParse(message.schedule);
                if (parsed.success && parsed.data.callId === securedCallId) {
                  scheduleRef.current = parsed.data;
                  setSchedule(parsed.data);
                  scheduleAssignedManipulations(parsed.data);
                }
              }
              if (message.state === "active" && typeof message.callClockStartMs === "number") {
                activateCall(message.callClockStartMs);
                setStatus("Call active; authoritative room state resynchronized");
                await negotiateAsCaller(Boolean(peer.currentRemoteDescription));
              }
              return;
            }
            if (message.type === "participant_joined" || message.type === "participant_left") {
              const participants = (message.participants ?? []) as PublicParticipant[];
              setPeers(participants);
              peerIdRef.current = participants.find(
                (participant) => participant.id !== participantSession.participantId,
              )?.id ?? null;
              if (message.type === "participant_joined" && activeRef.current) {
                await negotiateAsCaller(Boolean(peer.currentRemoteDescription));
              }
              return;
            }
            if (message.type === "call_started") {
              const startAt = Number(message.callClockStartMs);
              activateCall(startAt);
              setStatus("Call active; awaiting signed schedule");
              const participants = (message.participants ?? []) as PublicParticipant[];
              peerIdRef.current = participants.find(
                (participant) => participant.id !== participantSession.participantId,
              )?.id ?? peerIdRef.current;
              await negotiateAsCaller(false);
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
            if (message.type === "call_ended" || message.type === "call_failed") {
              activeRef.current = false;
              setEnded(true);
              setStatus(message.type === "call_failed"
                ? `Call failed: ${String(message.reason)}`
                : "Call ended; securing configured evidence…");
              await finishEvidence();
              return;
            }
            if (message.type === "error") {
              setStatus(`Room rejected message: ${String(message.code)}`);
            }
          })().catch((reason: Error) => setStatus(`Call protocol error: ${reason.message}`));
        };

        const reportTransportStatus = (transport: RoomConnectionStatus) => {
          if (cancelled) return;
          setRoomConnected(transport.phase === "connected");
          setPendingRoomEvents(transport.pendingEvents);
          if (transport.phase === "connecting") {
            setStatus(`Authorizing room connection (attempt ${transport.attempt})…`);
          } else if (transport.phase === "reconnecting") {
            setStatus(
              `Room interrupted; retrying in ${transport.retryInMs} ms · ${transport.pendingEvents} research events pending`,
            );
          } else if (transport.phase === "connected" && activeRef.current) {
            setStatus((current) => (
              current.startsWith("Room interrupted") || current.startsWith("Authorizing room")
                ? "Call active"
                : current
            ));
          } else if (transport.phase === "connected" && !activeRef.current) {
            setStatus("Authorized room connected; waiting for peer…");
          }
        };

        const webSocketProtocol = location.protocol === "https:" ? "wss" : "ws";
        const roomClient = new ReliableRoomClient({
          url: `${webSocketProtocol}://${location.host}/api/calls/${securedCallId}/ws`,
          storageKey: `omni_room_transport:${securedCallId}:${participantSession.participantId}`,
          issueCredential: async () => (
            await api.createRoomCredential(securedCallId, participantSession.participantToken)
          ).credential,
          onMessage: handleRoomMessage,
          onStatus: reportTransportStatus,
          onError: (reason) => {
            if (!cancelled) setStatus(`Authenticated room transport error: ${reason.message}`);
          },
        });
        roomClientRef.current = roomClient;
        roomClient.start();
      } catch (reason) {
        setStatus(`Unable to start secured media: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }

    void start();
    return () => {
      cancelled = true;
      activeRef.current = false;
      timersRef.current.forEach((timer) => clearTimeout(timer));
      roomClientRef.current?.stop();
      roomClientRef.current = null;
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      void outgoingGraphRef.current?.close();
      void incomingGraphRef.current?.close();
    };
  }, [callId, send, sendDurable, session]);

  const endCall = useCallback(() => {
    const delivered = send({ type: "end_call", clientClockMs: Date.now() });
    setStatus(delivered
      ? "Ending call through authoritative room…"
      : "Room is reconnecting; end call is temporarily unavailable");
  }, [send]);

  if (!session) {
    return (
      <div role="alert">
        <h1>Participant session required</h1>
        <p>Redeem the call-bound invitation in this browser context before entering the room.</p>
      </div>
    );
  }

  const ownParticipant = session.config.participants.find(
    (participant) => participant.id === session.participantConfigId,
  );
  const captionAppearance = ownParticipant?.captions.appearance ?? {
    fontSize: "medium" as const,
    highContrast: false,
    attribution: true,
  };

  return (
    <div className="omni-call-shell">
      <header className="omni-call-header">
        <div>
          <h1 className="omni-call-title">{session.callName}</h1>
          <p className="omni-call-meta">
            Server identity: {session.participantName} ({session.role}) · experiment v{session.experimentConfigVersion}
          </p>
          <p className="omni-call-status" data-testid="call-status" role="status" aria-live="polite">{status}</p>
          <p className="omni-call-delivery" data-testid="room-delivery">
            Research event delivery: {pendingRoomEvents === 0
              ? "synchronized"
              : `${pendingRoomEvents} awaiting authoritative acknowledgement`}
          </p>
        </div>
        <button
          className="omni-end-call"
          data-testid="end-call"
          type="button"
          onClick={endCall}
          disabled={ended || !roomConnected}
        >
          End call
        </button>
      </header>

      <p className="omni-webrtc-state" data-testid="webrtc-state">
        WebRTC: {peerState.connection} · ICE {peerState.ice}/{peerState.gathering} · signaling {peerState.signaling} · candidates {peerState.candidates}
      </p>
      <div
        className="omni-media-grid"
        data-testid="media-state"
        data-connected={String(mediaConnected)}
        data-connection-state={peerState.connection}
        data-ice-state={peerState.ice}
        data-gathering-state={peerState.gathering}
        data-candidates={String(peerState.candidates)}
      >
        <figure className="omni-media-figure">
          <video className="omni-media-video" ref={localVideoRef} autoPlay playsInline muted aria-label="Synthetic local camera" />
          <figcaption>You · {session.participantName}</figcaption>
        </figure>
        <figure className="omni-media-figure">
          <video className="omni-media-video" ref={remoteVideoRef} autoPlay playsInline aria-label="Remote participant video" />
          <audio ref={manipulatedRemoteAudioRef} autoPlay aria-label="Manipulated remote audio" />
          <figcaption>{peers.find((peer) => peer.id !== session.participantId)?.name ?? "Waiting for peer"}</figcaption>
        </figure>
      </div>

      <section
        className="omni-caption-panel"
        aria-labelledby="captions-heading"
        data-caption-size={captionAppearance.fontSize}
        data-high-contrast={String(captionAppearance.highContrast)}
        data-attribution={String(captionAppearance.attribution)}
      >
        <h2 className="omni-caption-heading" id="captions-heading">Mock captions</h2>
        <div className="omni-caption-log" data-testid="caption-log" role="log" aria-live="polite">
          {captions.length === 0 ? <p className="omni-caption-empty">Waiting for synthetic utterances…</p> : captions.map((caption) => (
            <p className="omni-caption-line" data-final={String(caption.isFinal)} key={caption.id}>
              {captionAppearance.attribution && (
                <span className="omni-caption-speaker">
                  {peers.find((peer) => peer.id === caption.fromId)?.name ?? "Remote participant"}: {" "}
                </span>
              )}
              {caption.text}
            </p>
          ))}
        </div>
      </section>

      <section className="omni-evidence" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence capture</h2>
        <p data-testid="evidence-status" role="status">{evidenceProgress}</p>
      </section>

      {schedule && (
        <details className="omni-schedule" data-testid="signed-schedule">
          <summary>
            Signed schedule revision {schedule.scheduleRevision} · {schedule.manipulations.length} expanded conditions
          </summary>
          <p>Algorithm: {schedule.algorithm} · signature: <code>{schedule.signature}</code></p>
          <pre>{JSON.stringify(schedule.manipulations, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
