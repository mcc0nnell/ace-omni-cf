import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ExperimentPage from "./pages/ExperimentPage";
import JoinPage from "./pages/JoinPage";
import CallPage from "./pages/CallPage";

function Shell({
  user,
  onLogout,
  children,
}: {
  user: any;
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
        <Link
          to="/"
          style={{
            textDecoration: "none",
            color: "inherit",
            fontWeight: 700,
            fontSize: "1.15rem",
          }}
        >
          ACE Omni
        </Link>
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
        ACE Omni — TRS research laboratory. Government notice preserved from original MITRE
        release.
      </footer>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <Shell user={null} onLogout={handleLogout}>
              <LoginPage onLogin={setUser} />
            </Shell>
          )
        }
      />
      <Route
        path="/"
        element={
          user ? (
            <Shell user={user} onLogout={handleLogout}>
              <DashboardPage user={user} />
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/experiments/:id"
        element={
          user ? (
            <Shell user={user} onLogout={handleLogout}>
              <ExperimentPage />
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/call/:callId" element={<CallPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
