import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"redeeming" | "ready" | "error">("redeeming");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [callId, setCallId] = useState("");

  useEffect(() => {
    if (!token) return;
    api
      .redeemInvitation(token)
      .then((data) => {
        setSession(data);
        sessionStorage.setItem(
          "omni_participant",
          JSON.stringify({
            participantId: data.participantId,
            participantName: data.participantName,
            role: data.role,
            experimentId: data.experimentId,
            config: data.config,
            dataCollection: data.dataCollection,
          })
        );
        setStatus("ready");
      })
      .catch((e) => {
        setError(e.message);
        setStatus("error");
      });
  }, [token]);

  function enterCall(e: React.FormEvent) {
    e.preventDefault();
    if (!callId.trim()) return;
    navigate(`/call/${callId.trim()}`);
  }

  if (status === "redeeming") {
    return <p role="status">Redeeming invitation…</p>;
  }

  if (status === "error") {
    return (
      <div role="alert" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <h1>Invitation invalid</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "2rem auto" }}>
      <h1>Welcome, {session.participantName}</h1>
      <p>
        You are joining experiment <strong>{session.experimentName}</strong> as{" "}
        <strong>{session.role}</strong>.
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        Camera and microphone will be requested when you enter the call. Screen capture is only
        used if the experiment configuration requires it and you grant permission.
      </p>

      <form onSubmit={enterCall} style={{ marginTop: "1.5rem" }}>
        <label htmlFor="callId" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
          Call ID (provided by researcher)
        </label>
        <input
          id="callId"
          value={callId}
          onChange={(e) => setCallId(e.target.value)}
          required
          placeholder="Paste call ID"
          style={{
            width: "100%",
            padding: "0.6rem 0.75rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--fg)",
            marginBottom: "1rem",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.65rem 1.25rem",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Enter call
        </button>
      </form>
    </div>
  );
}
