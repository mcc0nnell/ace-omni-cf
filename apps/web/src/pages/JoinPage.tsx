import { useEffect, useRef, useState } from "react";
import { api, type ParticipantSession } from "../lib/api";

export default function JoinPage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  const redemptionStarted = useRef(false);
  const [status, setStatus] = useState<"redeeming" | "ready" | "error">("redeeming");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ParticipantSession | null>(null);

  useEffect(() => {
    if (!token || redemptionStarted.current) return;
    redemptionStarted.current = true;
    api.redeemInvitation(token)
      .then((participant) => {
        sessionStorage.setItem(`omni_participant:${participant.callId}`, JSON.stringify(participant));
        window.history.replaceState(null, "", "/join");
        setSession(participant);
        setStatus("ready");
      })
      .catch((reason: Error) => {
        setError(reason.message);
        setStatus("error");
      });
  }, [token]);

  if (status === "redeeming") return <p role="status">Redeeming signed invitation…</p>;
  if (status === "error") {
    return (
      <div role="alert" style={{ maxWidth: 520, margin: "2rem auto" }}>
        <h1>Invitation unavailable</h1>
        <p>{error}</p>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div style={{ maxWidth: 560, margin: "2rem auto", padding: "1.25rem", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
      <h1>Invitation redeemed</h1>
      <p data-testid="participant-identity">
        The server assigned you as <strong>{session.participantName}</strong> ({session.role})
        for <strong>{session.callName}</strong>.
      </p>
      <p style={{ color: "var(--muted)" }}>
        This identity, role, call, and immutable experiment version came from the signed,
        single-use invitation. They cannot be edited in the browser.
      </p>
      <p>
        Pinned experiment version: {session.experimentConfigVersion}<br />
        Session expires: {new Date(session.expiresAt).toLocaleString()}
      </p>
      <button
        data-testid="enter-call"
        type="button"
        onClick={() => window.location.assign(`/call/${session.callId}`)}
        style={{ padding: "0.7rem 1.25rem", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600 }}
      >
        Enter secured call
      </button>
    </div>
  );
}
