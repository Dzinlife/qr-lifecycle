import type {
  Channel,
  CreateChannelInput,
  DeploymentInfo,
  QrVersion,
  UpdateChannelInput,
} from "@qr-lifecycle/contracts";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface SessionResponse {
  sessionToken: string;
  recoveryCode?: string;
  user: User;
  tenant: Tenant;
  deployment: DeploymentInfo;
}

export interface MeResponse {
  user: User;
  tenant: Tenant;
  membership: { role: string };
  deployment: DeploymentInfo;
}

export interface HealthResponse {
  ok: boolean;
  bootstrapped: boolean;
  deployment: DeploymentInfo;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN_KEY = "qr-lifecycle.session-token";
const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "";

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    return new ApiError(
      payload.error?.message ?? `请求失败（${response.status}）`,
      payload.error?.code ?? "request_failed",
      response.status,
    );
  } catch {
    return new ApiError(`请求失败（${response.status}）`, "request_failed", response.status);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const token = readToken();
  if (authenticated && token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${configuredOrigin}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("无法连接服务器，请检查部署地址和网络。", "network_error", 0);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  getApiOrigin(): string {
    return configuredOrigin || window.location.origin;
  },

  getSessionToken(): string | null {
    return readToken();
  },

  setSessionToken(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },

  clearSession(): void {
    window.localStorage.removeItem(TOKEN_KEY);
  },

  health: () => request<HealthResponse>("/health", {}, false),

  bootstrap: (input: { email?: string; displayName?: string; tenantName?: string }) =>
    request<SessionResponse>(
      "/api/v1/bootstrap",
      { method: "POST", body: jsonBody(input) },
      false,
    ),

  requestCode: (email: string) =>
    request<{ accepted: true; method: string }>(
      "/api/v1/auth/request-code",
      { method: "POST", body: jsonBody({ email }) },
      false,
    ),

  verifyCode: (email: string, code: string) =>
    request<SessionResponse>(
      "/api/v1/auth/verify-code",
      { method: "POST", body: jsonBody({ email, code }) },
      false,
    ),

  verifyRecoveryCode: (email: string, recoveryCode: string) =>
    request<SessionResponse>(
      "/api/v1/auth/verify-code",
      { method: "POST", body: jsonBody({ email, recoveryCode }) },
      false,
    ),

  me: () => request<MeResponse>("/api/v1/me"),

  listChannels: () => request<{ channels: Channel[] }>("/api/v1/channels"),

  getChannel: (channelId: string) =>
    request<{ channel: Channel }>(`/api/v1/channels/${channelId}`),

  createChannel: (input: CreateChannelInput) =>
    request<{ channel: Channel }>("/api/v1/channels", {
      method: "POST",
      body: jsonBody(input),
    }),

  updateChannel: (channelId: string, input: UpdateChannelInput) =>
    request<{ channel: Channel }>(`/api/v1/channels/${channelId}`, {
      method: "PATCH",
      body: jsonBody(input),
    }),

  deleteChannel: (channelId: string) =>
    request<void>(`/api/v1/channels/${channelId}`, { method: "DELETE" }),

  listQrVersions: (channelId: string) =>
    request<{ qrVersions: QrVersion[] }>(`/api/v1/channels/${channelId}/qr-versions`),

  uploadQrVersion: (
    channelId: string,
    input: { image: File; decodedPayload: string; capturedAt?: string },
  ) => {
    const formData = new FormData();
    formData.append("image", input.image);
    formData.append("decodedPayload", input.decodedPayload);
    if (input.capturedAt) formData.append("capturedAt", input.capturedAt);
    return request<{ qrVersion: QrVersion; channel: Channel }>(
      `/api/v1/channels/${channelId}/qr-versions`,
      { method: "POST", body: formData },
    );
  },

  createPairingCode: () =>
    request<{ pairingCode: { code: string; expiresAt: string } }>(
      "/api/v1/pairing-codes",
      { method: "POST" },
    ),
};
