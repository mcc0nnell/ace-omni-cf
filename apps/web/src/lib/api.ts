const API = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const csrf = document.cookie
    .split("; ")
    .find((c) => c.startsWith("omni_csrf="))
    ?.split("=")[1];

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (csrf && options.method && options.method !== "GET") {
    headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  login: (email: string, password: string) =>
    request<{ user: any; csrf: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request<{ user: any }>("/auth/me"),
  listExperiments: () => request<{ experiments: any[] }>("/experiments"),
  createExperiment: (data: any) =>
    request<{ id: string }>("/experiments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getExperiment: (id: string) => request<any>(`/experiments/${id}`),
  createInvitation: (experimentId: string, data: any) =>
    request<{ invitationId: string; token: string; joinUrl: string; expiresAt: string }>(
      `/experiments/${experimentId}/invitations`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  redeemInvitation: (token: string) =>
    request<any>("/invitations/redeem", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  createCall: (experimentId: string, name?: string) =>
    request<{ callId: string }>("/calls", {
      method: "POST",
      body: JSON.stringify({ experimentId, name }),
    }),
  getCall: (id: string) => request<any>(`/calls/${id}`),
};
