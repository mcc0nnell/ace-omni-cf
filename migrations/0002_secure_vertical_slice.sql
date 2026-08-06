-- ACE Omni secure, versioned vertical-slice schema.
-- ©2024 The MITRE Corporation. Approved for Public Release 24-0463.

PRAGMA foreign_keys = ON;

ALTER TABLE sessions ADD COLUMN token_hash TEXT;
ALTER TABLE sessions ADD COLUMN csrf_hash TEXT;
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;
CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions(token_hash);

ALTER TABLE experiments ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX idx_experiments_alias_unique ON experiments(alias);

CREATE TABLE experiment_versions (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  config_json TEXT NOT NULL,
  config_sha256 TEXT NOT NULL CHECK (length(config_sha256) = 64),
  revision_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, version)
);

CREATE INDEX idx_experiment_versions_experiment
  ON experiment_versions(experiment_id, version DESC);

CREATE TRIGGER experiment_versions_immutable_update
BEFORE UPDATE ON experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'experiment versions are immutable');
END;

CREATE TRIGGER experiment_versions_immutable_delete
BEFORE DELETE ON experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'experiment versions are immutable');
END;

ALTER TABLE invitations ADD COLUMN call_id TEXT REFERENCES calls(id) ON DELETE CASCADE;
ALTER TABLE invitations ADD COLUMN experiment_version_id TEXT REFERENCES experiment_versions(id);
ALTER TABLE invitations ADD COLUMN participant_id TEXT;
ALTER TABLE invitations ADD COLUMN revoked_at TEXT;
CREATE INDEX idx_invitations_call ON invitations(call_id);
CREATE INDEX idx_invitations_expiry ON invitations(expires_at);

ALTER TABLE calls ADD COLUMN experiment_version_id TEXT REFERENCES experiment_versions(id);
ALTER TABLE calls ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE calls ADD COLUMN config_snapshot_json TEXT;
ALTER TABLE calls ADD COLUMN config_sha256 TEXT;
ALTER TABLE calls ADD COLUMN schedule_json TEXT;
ALTER TABLE calls ADD COLUMN schedule_signature TEXT;
ALTER TABLE calls ADD COLUMN replay_of_call_id TEXT REFERENCES calls(id);
ALTER TABLE calls ADD COLUMN duration_ms INTEGER;
ALTER TABLE calls ADD COLUMN failed_reason TEXT;
ALTER TABLE calls ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_calls_created_by ON calls(created_by, created_at DESC);
CREATE INDEX idx_calls_version ON calls(experiment_version_id);

CREATE TABLE participant_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE RESTRICT,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  experiment_version_id TEXT NOT NULL REFERENCES experiment_versions(id),
  participant_id TEXT NOT NULL UNIQUE,
  participant_config_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('caller', 'callee', 'communications_assistant')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_participant_sessions_call ON participant_sessions(call_id);
CREATE INDEX idx_participant_sessions_expiry ON participant_sessions(expires_at);

CREATE TABLE room_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  participant_session_id TEXT NOT NULL REFERENCES participant_sessions(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_room_credentials_session ON room_credentials(participant_session_id);
CREATE INDEX idx_room_credentials_expiry ON room_credentials(expires_at);

CREATE TABLE call_participants (
  id TEXT PRIMARY KEY NOT NULL,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  participant_session_id TEXT NOT NULL UNIQUE REFERENCES participant_sessions(id),
  participant_config_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('caller', 'callee', 'communications_assistant')),
  joined_at TEXT,
  left_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (call_id, participant_config_id),
  UNIQUE (call_id, role)
);

CREATE INDEX idx_call_participants_call ON call_participants(call_id);

ALTER TABLE call_events ADD COLUMN sequence INTEGER;
ALTER TABLE call_events ADD COLUMN call_offset_ms INTEGER;
CREATE UNIQUE INDEX idx_call_events_sequence
  ON call_events(call_id, sequence)
  WHERE sequence IS NOT NULL;

CREATE TRIGGER call_events_immutable_update
BEFORE UPDATE ON call_events
BEGIN
  SELECT RAISE(ABORT, 'call events are immutable');
END;

CREATE TRIGGER call_events_immutable_delete
BEFORE DELETE ON call_events
BEGIN
  SELECT RAISE(ABORT, 'call events are immutable');
END;

CREATE TABLE evidence_upload_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  expected_content_type TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256) = 64),
  expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes >= 0),
  captured_at TEXT NOT NULL,
  max_bytes INTEGER NOT NULL CHECK (max_bytes > 0),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_evidence_upload_expiry ON evidence_upload_credentials(expires_at);

CREATE TABLE evidence_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE RESTRICT,
  participant_id TEXT,
  artifact_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  etag TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_evidence_artifacts_call ON evidence_artifacts(call_id, artifact_type);

CREATE TABLE evidence_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  call_id TEXT NOT NULL UNIQUE REFERENCES calls(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  manifest_json TEXT NOT NULL,
  generated_by TEXT NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL
);

CREATE TRIGGER evidence_manifests_immutable_update
BEFORE UPDATE ON evidence_manifests
BEGIN
  SELECT RAISE(ABORT, 'evidence manifests are immutable');
END;

CREATE TRIGGER evidence_manifests_immutable_delete
BEFORE DELETE ON evidence_manifests
BEGIN
  SELECT RAISE(ABORT, 'evidence manifests are immutable');
END;
