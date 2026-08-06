import type {
  EvidenceArtifactType,
  EvidenceManifest,
  ExperimentConfig,
  ExperimentSchedule,
  NormalizedExperimentConfig,
} from "@ace-omni/domain";

const API = "/api";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: "administrator" | "researcher";
}

export interface ExperimentSummary {
  id: string;
  name: string;
  alias: string;
  description: string;
  purpose: string;
  phase: string;
  config: NormalizedExperimentConfig;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentDetail extends ExperimentSummary {
  versions: Array<{
    id: string;
    version: number;
    config: NormalizedExperimentConfig;
    configSha256: string;
    revisionNote: string;
    createdAt: string;
  }>;
}

export interface ParticipantSession {
  callId: string;
  callName: string;
  experimentId: string;
  experimentVersionId: string;
  experimentConfigVersion: number;
  participantId: string;
  participantConfigId: string;
  participantName: string;
  role: "caller" | "callee";
  config: NormalizedExperimentConfig;
  participantToken: string;
  expiresAt: string;
}

export interface ResearchCallDetail {
  call: {
    id: string;
    experimentId: string;
    experimentVersionId: string;
    experimentConfigVersion: number;
    name: string;
    state: string;
    configSha256: string;
    configSnapshot: NormalizedExperimentConfig;
    schedule: ExperimentSchedule | null;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    replayOfCallId: string | null;
    evidenceManifestKey: string | null;
  };
  participants: Array<{ id: string; name: string; role: string; joinedAt: string | null }>;
  artifacts: Array<{
    id: string;
    type: EvidenceArtifactType;
    participantId: string | null;
    sha256: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  events: Array<{ id: string; sequence: number; type: string; callOffsetMs: number | null }>;
  manifest: EvidenceManifest | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function csrfToken(): string | undefined {
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("omni_csrf="))
    ?.slice("omni_csrf=".length);
  return value ? decodeURIComponent(value) : undefined;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const csrf = csrfToken();
  if (csrf && options.method && !["GET", "HEAD"].includes(options.method)) {
    headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error || `HTTP ${response.status}`, response.status, body.details ?? body.missing);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  login: (email: string, password: string) =>
    request<{ user: User; csrfToken: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),
  listExperiments: () => request<{ experiments: ExperimentSummary[] }>("/experiments"),
  createExperiment: (data: {
    name: string;
    alias: string;
    description?: string;
    purpose?: string;
    config: ExperimentConfig;
  }) => request<{ id: string; versionId: string; version: number; configSha256: string }>(
    "/experiments",
    { method: "POST", body: JSON.stringify(data) },
  ),
  getExperiment: (id: string) => request<ExperimentDetail>(`/experiments/${id}`),
  createExperimentVersion: (id: string, config: ExperimentConfig, revisionNote: string) =>
    request<{ versionId: string; version: number; configSha256: string }>(
      `/experiments/${id}/versions`,
      { method: "POST", body: JSON.stringify({ config, revisionNote }) },
    ),
  createCall: (experimentId: string, name?: string, version?: number) =>
    request<{ callId: string; version: number }>("/calls", {
      method: "POST",
      body: JSON.stringify({ experimentId, name, version }),
    }),
  issueInvitations: (callId: string, ttlMinutes = 120) =>
    request<{
      callId: string;
      invitations: Array<{
        invitationId: string;
        participantConfigId: string;
        role: string;
        token: string;
        joinUrl: string;
        expiresAt: string;
      }>;
    }>(`/calls/${callId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ ttlMinutes }),
    }),
  redeemInvitation: (token: string) => request<ParticipantSession>("/invitations/redeem", {
    method: "POST",
    body: JSON.stringify({ token }),
  }),
  createRoomCredential: (callId: string, participantToken: string) =>
    request<{ credential: string; expiresAt: string }>(`/calls/${callId}/room-credentials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${participantToken}` },
    }),
  authorizeEvidenceUpload: (
    callId: string,
    participantToken: string,
    input: {
      artifactType: EvidenceArtifactType;
      contentType: "audio/webm" | "video/webm" | "application/json";
      sizeBytes: number;
      sha256: string;
      capturedAt: string;
    },
  ) => request<{
    uploadId: string;
    uploadUrl: string;
    uploadToken: string;
    objectKey: string;
    expiresAt: string;
  }>(`/calls/${callId}/evidence/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${participantToken}` },
    body: JSON.stringify(input),
  }),
  async uploadEvidence(
    uploadUrl: string,
    uploadToken: string,
    body: Blob,
    contentType: "audio/webm" | "video/webm" | "application/json",
  ): Promise<{ artifactId: string; objectKey: string; sha256: string }> {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        "Content-Type": contentType,
      },
      body,
      credentials: "omit",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(error.error || "Evidence upload failed", response.status);
    }
    return response.json();
  },
  getCall: (id: string) => request<ResearchCallDetail>(`/calls/${id}`),
  listCalls: (experimentId: string) => request<{
    calls: Array<{ id: string; name: string; state: string; experimentConfigVersion: number; createdAt: string }>;
  }>(`/experiments/${experimentId}/calls`),
  finalizeCall: (id: string) => request<{ manifest: EvidenceManifest; objectKey: string; sha256: string }>(
    `/calls/${id}/finalize`,
    { method: "POST" },
  ),
  replayCall: (id: string) => request<{ callId: string; replayOfCallId: string }>(
    `/calls/${id}/replay`,
    { method: "POST" },
  ),
};
