import type {
  Account,
  Channel,
  DeploymentInfo,
  QrVersion,
  UpdateChannelInput,
  WebBinding,
  WebBindingStatus,
} from "@qr-lifecycle/contracts";

export interface MeResponse {
  account: Account;
  session: { id: string; kind: "web" | "mobile" };
  deployment: DeploymentInfo;
}

export interface CreateWebBindingResponse {
  binding: WebBinding;
  browserSecret: string;
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

const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "";

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(`${configuredOrigin}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError("无法连接 fallinlife 服务，请稍后重试。", "network_error", 0);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const jsonBody = (value: unknown) => JSON.stringify(value);
const bindingHeaders = (browserSecret: string) => ({ "X-Binding-Secret": browserSecret });

export const api = {
  getApiOrigin(): string {
    return configuredOrigin || window.location.origin;
  },

  me: () => request<MeResponse>("/api/v1/me"),

  createWebBinding: () =>
    request<CreateWebBindingResponse>("/api/v1/web-bindings", { method: "POST" }),

  getWebBindingStatus: (bindingId: string, browserSecret: string) =>
    request<{ status: WebBindingStatus; expiresAt: string }>(
      `/api/v1/web-bindings/${encodeURIComponent(bindingId)}`,
      { headers: bindingHeaders(browserSecret) },
    ),

  consumeWebBinding: (bindingId: string, browserSecret: string) =>
    request<{ connected: true }>(
      `/api/v1/web-bindings/${encodeURIComponent(bindingId)}/consume`,
      { method: "POST", headers: bindingHeaders(browserSecret) },
    ),

  logout: () => request<void>("/api/v1/web/logout", { method: "POST" }),

  listChannels: () => request<{ channels: Channel[] }>("/api/v1/channels"),

  getChannel: (channelId: string) =>
    request<{ channel: Channel }>(`/api/v1/channels/${encodeURIComponent(channelId)}`),

  updateChannel: (channelId: string, input: UpdateChannelInput) =>
    request<{ channel: Channel }>(`/api/v1/channels/${encodeURIComponent(channelId)}`, {
      method: "PATCH",
      body: jsonBody(input),
    }),

  deleteChannel: (channelId: string) =>
    request<void>(`/api/v1/channels/${encodeURIComponent(channelId)}`, {
      method: "DELETE",
    }),

  listQrVersions: (channelId: string) =>
    request<{ qrVersions: QrVersion[] }>(
      `/api/v1/channels/${encodeURIComponent(channelId)}/qr-versions`,
    ),
};
