import { useState, FormEvent } from "react";
import { api } from "../lib/api";

export default function LoginPage({ onLogin }: { onLogin: (u: any) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(email, password);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "3rem auto" }}>
      <h1 style={{ marginTop: 0 }}>Sign in</h1>
      <p style={{ color: "var(--muted)" }}>
        Researcher / administrator access to the TRS experiment laboratory.
      </p>
      <form onSubmit={handleSubmit} aria-describedby={error ? "login-error" : undefined}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "0.6rem 0.75rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          />
        </div>
        <div style={{ marginBottom: "1.25rem" }}>
          <label htmlFor="password" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.6rem 0.75rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          />
        </div>
        {error && (
          <div
            id="login-error"
            role="alert"
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              background: "color-mix(in srgb, var(--danger) 15%, transparent)",
              borderRadius: 6,
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "0.7rem",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Local-only synthetic accounts can be created with <code>npm run seed:local</code>.
        No credentials are embedded in the production web bundle.
      </p>
    </div>
  );
}
