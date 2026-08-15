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
    <div className="omni-shell">
      <header role="banner" className="omni-shell-header" data-material="cardstock">
        <a href="/" className="omni-shell-brand">
          ACE Omni
        </a>
        <nav aria-label="Primary">
          {user ? (
            <div className="omni-shell-user">
              <span className="omni-shell-user-label">
                {user.displayName} ({user.role})
              </span>
              <button type="button" onClick={onLogout} className="omni-secondary-action">
                Log out
              </button>
            </div>
          ) : null}
        </nav>
      </header>
      <main className="omni-shell-main">{children}</main>
      <footer role="contentinfo" className="omni-shell-footer" data-material="paper" data-age="light">
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
      <div role="status" aria-live="polite" className="omni-loading-slip" data-material="paper">
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
