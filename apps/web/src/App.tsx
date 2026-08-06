import { useEffect, useState } from "react";
import { api } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ExperimentPage from "./pages/ExperimentPage";
import JoinPage from "./pages/JoinPage";
import CallPage from "./pages/CallPage";
import ResearchCallPage from "./pages/ResearchCallPage";
import type { User } from "./lib/api";

function Shell({
  user,
  onLogout,
  children,
}: {
  user: User | null;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        role="banner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <a
          href="/"
          style={{
            textDecoration: "none",
            color: "inherit",
            fontWeight: 700,
            fontSize: "1.15rem",
          }}
        >
          ACE Omni
        </a>
        <nav aria-label="Primary">
          {user ? (
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                {user.displayName} ({user.role})
              </span>
              <button
                type="button"
                onClick={onLogout}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--fg)",
                  padding: "0.35rem 0.75rem",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </nav>
      </header>
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
      <footer
        role="contentinfo"
        style={{
          padding: "0.75rem 1.5rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.8rem",
          color: "var(--muted)",
        }}
      >
        ACE Omni — TRS research laboratory. Government notice preserved from original release.
      </footer>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <p role="status">Redirecting…</p>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (window.location.pathname === "/join" || window.location.pathname.startsWith("/call/")) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  if (loading) {
    return (
      <div role="status" aria-live="polite" style={{ padding: "2rem", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  const path = window.location.pathname;
  if (path === "/join") return <JoinPage />;

  const participantCall = path.match(/^\/call\/([^/]+)$/);
  if (participantCall) return <CallPage callId={participantCall[1]} />;

  if (path === "/login") {
    return user ? <Redirect to="/" /> : (
      <Shell user={null} onLogout={handleLogout}>
        <LoginPage onLogin={setUser} />
      </Shell>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (path === "/") {
    return (
      <Shell user={user} onLogout={handleLogout}>
        <DashboardPage user={user} />
      </Shell>
    );
  }

  const experiment = path.match(/^\/experiments\/([^/]+)$/);
  if (experiment) {
    return (
      <Shell user={user} onLogout={handleLogout}>
        <ExperimentPage id={experiment[1]} />
      </Shell>
    );
  }

  const researchCall = path.match(/^\/research\/calls\/([^/]+)$/);
  if (researchCall) {
    return (
      <Shell user={user} onLogout={handleLogout}>
        <ResearchCallPage callId={researchCall[1]} />
      </Shell>
    );
  }

  return <Redirect to="/" />;
}
