-- ACE Omni Cloudflare D1 schema
-- Normalized from original MongoDB models; supports experiment versioning and evidence.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator', 'researcher', 'participant')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  alias TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'draft' CHECK (phase IN ('draft', 'active', 'archived')),
  config_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  modified_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_experiments_created_by ON experiments(created_by);
CREATE INDEX idx_experiments_phase ON experiments(phase);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  participant_config_id TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_invitations_experiment ON invitations(experiment_id);
CREATE INDEX idx_invitations_token ON invitations(token_hash);

CREATE TABLE calls (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  experiment_config_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'waiting', 'active', 'ended', 'failed')),
  participants_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT,
  duration_sec REAL,
  evidence_manifest_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_calls_experiment ON calls(experiment_id);
CREATE INDEX idx_calls_state ON calls(state);

CREATE TABLE call_events (
  id TEXT PRIMARY KEY NOT NULL,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  participant_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  client_clock_ms INTEGER,
  server_clock_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_call_events_call ON call_events(call_id);
CREATE INDEX idx_call_events_type ON call_events(type);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_created ON audit_events(created_at);
