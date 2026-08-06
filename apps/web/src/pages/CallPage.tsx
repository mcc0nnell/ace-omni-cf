import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";

type ParticipantInfo = {
  participantId: string;
  participantName: string;
  role: string;
  experimentId: string;
  config: any;
  dataCollection: any;
};

type Caption = { id: string; text: string; isFinal: boolean; atMs: number };

const MOCK_UTTERANCES = [
  "Hello, this is a test of the caption system.",
  "The weather today is partly cloudy with a chance of rain.",
  "Please confirm your account number ending in four five six seven.",
  "I need assistance with my relay service configuration.",
  "Thank you for participating in this research study.",
  "Can you hear me clearly through the audio channel?",
  "The experiment is applying a caption delay now.",
  "Background noise injection should start shortly.",
];

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const [info, setInfo] = useState<ParticipantInfo | null>(null);
  const [status, setStatus] = useState<string>("Connecting…");
  const [peers, setPeers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [callClockStart, setCallClockStart] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [ended, setEnded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const captionTimerRef = useRef<number | null>(null);
  const captionIdx = useRef(0);

  useEffect(() => {
    const raw = sessionStorage.getItem("omni_participant");
    if (!raw) {
      setStatus("No participant session — redeem an invitation first.");
      return;
    }
    setInfo(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (!info || !callId) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        });
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        pc.ontrack = (ev) => {
          const [remote] = ev.streams;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({ type: "ice_candidate", candidate: ev.candidate })
            );
          }
        };

        const proto = location.protocol === "https:" ? "wss" : "ws";
        const qs = new URLSearchParams({
          token: "participant",
          participantId: info!.participantId,
          name: info!.participantName,
          role: info!.role,
        });
        const ws = new WebSocket(`${proto}://${location.host}/api/calls/${callId}/ws?${qs}`);
        wsRef.current = ws;

        ws.onopen = () => setStatus("Connected to room — waiting for peer…");
        ws.onclose = () => setStatus("Disconnected");
        ws.onerror = () => setStatus("WebSocket error");

        ws.onmessage = async (ev) => {
          const msg = JSON.parse(ev.data);
          switch (msg.type) {
            case "welcome":
              setPeers(msg.participants || []);
              if (msg.callClockStartMs) setCallClockStart(msg.callClockStartMs);
              setStatus(
                msg.state === "active" ? "Call active" : "Waiting for other participant…"
              );
              break;
            case "participant_joined":
            case "participant_left":
              setPeers(msg.participants || []);
              break;
            case "call_started":
              setCallClockStart(msg.callClockStartMs);
              setStatus("Call active");
              if (pc.signalingState === "stable" && !pc.currentRemoteDescription) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                const others = (msg.participants || []).filter(
                  (p: any) => p.id !== info!.participantId
                );
                if (others[0]) {
                  ws.send(
                    JSON.stringify({ type: "offer", targetId: others[0].id, sdp: offer })
                  );
                }
              }
              break;
            case "offer":
              if (msg.fromId === info!.participantId) break;
              await pc.setRemoteDescription(msg.sdp);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(
                JSON.stringify({ type: "answer", targetId: msg.fromId, sdp: answer })
              );
              break;
            case "answer":
              if (msg.fromId === info!.participantId) break;
              await pc.setRemoteDescription(msg.sdp);
              break;
            case "ice_candidate":
              if (msg.candidate) {
                try {
                  await pc.addIceCandidate(msg.candidate);
                } catch {}
              }
              break;
            case "schedule_issued":
              setSchedule(msg.schedule);
              setStatus("Experiment schedule received");
              break;
            case "caption":
              setCaptions((prev) => [
                ...prev.slice(-40),
                {
                  id: crypto.randomUUID(),
                  text: msg.text,
                  isFinal: msg.isFinal,
                  atMs: msg.atMs,
                },
              ]);
              break;
            case "call_ended":
              setEnded(true);
              setStatus("Call ended");
              break;
          }
        };
      } catch (err: any) {
        setStatus(`Media error: ${err.message}`);
      }
    }

    start();
    return () => {
      cancelled = true;
      wsRef.current?.close();
      pcRef.current?.close();
      localStream?.getTracks().forEach((t) => t.stop());
      if (captionTimerRef.current) window.clearInterval(captionTimerRef.current);
    };
  }, [info, callId]);

  useEffect(() => {
    if (!callClockStart || ended || !info) return;
    const delayMs = info.config?.captions?.captionDelayMs ?? 0;
    const finalizedOnly = info.config?.captions?.showFinalizedOnly ?? false;

    captionTimerRef.current = window.setInterval(() => {
      const text = MOCK_UTTERANCES[captionIdx.current % MOCK_UTTERANCES.length];
      captionIdx.current += 1;
      const atMs = Date.now();
      const id = crypto.randomUUID();

      const display = () => {
        setCaptions((prev) => [...prev.slice(-40), { id, text, isFinal: true, atMs }]);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "caption", text, isFinal: true, atMs }));
        }
      };

      if (delayMs > 0) window.setTimeout(display, delayMs);
      else display();

      if (!finalizedOnly) {
        const partial = text.slice(0, Math.ceil(text.length * 0.6)) + "…";
        setCaptions((prev) => [
          ...prev.slice(-40),
          { id: id + "-p", text: partial, isFinal: false, atMs },
        ]);
      }
    }, 4500);

    return () => {
      if (captionTimerRef.current) window.clearInterval(captionTimerRef.current);
    };
  }, [callClockStart, ended, info]);

  useEffect(() => {
    if (!schedule || !callClockStart) return;
    const timers: number[] = [];
    for (const m of schedule.manipulations || []) {
      const startAt = callClockStart + m.startOffsetMs;
      const delay = Math.max(0, startAt - Date.now());
      const t = window.setTimeout(() => {
        setStatus(`Manipulation active: ${m.type}`);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "manipulation_executed",
              manipulationId: m.id,
              atMs: Date.now(),
            })
          );
        }
        window.setTimeout(() => setStatus("Call active"), m.durationMs);
      }, delay);
      timers.push(t);
    }
    return () => timers.forEach(window.clearTimeout);
  }, [schedule, callClockStart]);

  const endCall = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
    }
    setEnded(true);
    setStatus("Call ended");
    pcRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());
  }, [localStream]);

  if (!info) return <p role="status">{status}</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
            Call · {info.participantName} ({info.role})
          </h1>
          <p
            style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        </div>
        {!ended && (
          <button
            type="button"
            onClick={endCall}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "none",
              background: "var(--danger)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            End call
          </button>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <figure style={{ margin: 0 }}>
          <figcaption className="sr-only">Local video</figcaption>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            aria-label="Your camera"
            style={{ width: "100%", background: "#000", borderRadius: 8, aspectRatio: "4/3" }}
          />
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 4 }}>You</div>
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption className="sr-only">Remote video</figcaption>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            aria-label="Remote participant"
            style={{ width: "100%", background: "#000", borderRadius: 8, aspectRatio: "4/3" }}
          />
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 4 }}>
            {peers.find((p) => p.id !== info.participantId)?.name ?? "Waiting…"}
          </div>
        </figure>
      </div>

      <section
        aria-labelledby="captions-heading"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "1rem",
          minHeight: 160,
        }}
      >
        <h2 id="captions-heading" style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>
          Captions
        </h2>
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          style={{ maxHeight: 200, overflowY: "auto", fontSize: "1.05rem", lineHeight: 1.45 }}
        >
          {captions.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Captions will appear here once the call is active.
            </p>
          ) : (
            captions.map((c) => (
              <p
                key={c.id}
                style={{
                  margin: "0 0 0.4rem",
                  opacity: c.isFinal ? 1 : 0.65,
                  fontStyle: c.isFinal ? "normal" : "italic",
                }}
              >
                {c.text}
              </p>
            ))
          )}
        </div>
      </section>

      {schedule && (
        <details style={{ marginTop: "1rem" }}>
          <summary>Experiment schedule (revision {schedule.scheduleRevision})</summary>
          <pre style={{ fontSize: "0.75rem", overflow: "auto" }}>
            {JSON.stringify(schedule.manipulations, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
