import type {
  AcceptInboxItemInput,
  Channel,
  CommitDetectionResponse,
  DetectedCommunityQr,
  IgnoreDetectionResponse,
  InboxItem,
  InboxResponse,
  QrCandidate,
  QrVersion,
  UndoDetectionResponse,
} from "@qr-lifecycle/contracts";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";

import { normalizeApiOrigin, parsePairPayload, type PairPayload } from "@/lib/pure";
import type { MobileSession } from "@/session/storage";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function url(origin: string, path: string): string {
  return `${normalizeApiOrigin(origin)}/api/v1${path}`;
}

async function readError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Some proxies replace API errors with an HTML response.
  }
  return new ApiError(
    body?.error?.message ?? `请求失败（${response.status}）`,
    response.status,
    body?.error?.code,
  );
}

async function request<T>(
  origin: string,
  path: string,
  init: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await expoFetch(url(origin, path), { ...init, headers });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function pairDeployment(origin: string, code: string): Promise<PairPayload> {
  const raw = await request<unknown>(origin, "/pair", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return parsePairPayload(raw);
}

export async function listChannels(session: MobileSession): Promise<Channel[]> {
  const raw = await request<Channel[] | { channels: Channel[] }>(
    session.deployment.apiOrigin,
    "/channels",
    { method: "GET" },
    session.token,
  );
  return Array.isArray(raw) ? raw : raw.channels;
}

export async function getChannel(session: MobileSession, channelId: string): Promise<Channel> {
  const raw = await request<Channel | { channel: Channel }>(
    session.deployment.apiOrigin,
    `/channels/${encodeURIComponent(channelId)}`,
    { method: "GET" },
    session.token,
  );
  return "channel" in raw ? raw.channel : raw;
}

export async function listQrVersions(
  session: MobileSession,
  channelId: string,
): Promise<QrVersion[]> {
  const raw = await request<QrVersion[] | { qrVersions: QrVersion[] }>(
    session.deployment.apiOrigin,
    `/channels/${encodeURIComponent(channelId)}/qr-versions`,
    { method: "GET" },
    session.token,
  );
  return Array.isArray(raw) ? raw : raw.qrVersions;
}

function imageFile(candidate: QrCandidate): File {
  return new File(candidate.imageUri);
}

export async function uploadQrCandidate(
  session: MobileSession,
  channelId: string,
  candidate: QrCandidate,
): Promise<QrVersion> {
  const form = new FormData();
  form.append("image", imageFile(candidate));
  form.append("decodedPayload", candidate.payload);
  if (candidate.assetId) form.append("sourceAssetId", candidate.assetId);
  if (candidate.creationTime !== null) {
    form.append("capturedAt", new Date(candidate.creationTime).toISOString());
  }

  const raw = await request<QrVersion | { qrVersion: QrVersion }>(
    session.deployment.apiOrigin,
    `/channels/${encodeURIComponent(channelId)}/qr-versions`,
    { method: "POST", body: form },
    session.token,
  );
  return "qrVersion" in raw ? raw.qrVersion : raw;
}

export async function commitDetection(
  session: MobileSession,
  detection: DetectedCommunityQr,
  candidate: QrCandidate,
  signal?: AbortSignal,
): Promise<CommitDetectionResponse> {
  const form = new FormData();
  form.append("metadata", JSON.stringify(detection));
  form.append("image", imageFile(candidate));

  return request<CommitDetectionResponse>(
    session.deployment.apiOrigin,
    "/detections/commit",
    { method: "POST", body: form, ...(signal ? { signal } : {}) },
    session.token,
  );
}

export async function listInbox(session: MobileSession): Promise<InboxItem[]> {
  const raw = await request<InboxItem[] | InboxResponse>(
    session.deployment.apiOrigin,
    "/inbox",
    { method: "GET" },
    session.token,
  );
  return Array.isArray(raw) ? raw : raw.items;
}

export async function acceptInboxItem(
  session: MobileSession,
  detectionId: string,
  input: AcceptInboxItemInput = {},
): Promise<CommitDetectionResponse> {
  return request<CommitDetectionResponse>(
    session.deployment.apiOrigin,
    `/inbox/${encodeURIComponent(detectionId)}/accept`,
    { method: "POST", body: JSON.stringify(input) },
    session.token,
  );
}

export async function ignoreInboxItem(
  session: MobileSession,
  detectionId: string,
): Promise<IgnoreDetectionResponse> {
  return request<IgnoreDetectionResponse>(
    session.deployment.apiOrigin,
    `/inbox/${encodeURIComponent(detectionId)}/ignore`,
    { method: "POST", body: JSON.stringify({}) },
    session.token,
  );
}

export async function undoDetection(
  session: MobileSession,
  detectionId: string,
): Promise<UndoDetectionResponse> {
  return request<UndoDetectionResponse>(
    session.deployment.apiOrigin,
    `/detections/${encodeURIComponent(detectionId)}/undo`,
    { method: "POST", body: JSON.stringify({}) },
    session.token,
  );
}

export async function updateChannelExpiry(
  session: MobileSession,
  channelId: string,
  expiresAt: string | null,
): Promise<void> {
  await request(
    session.deployment.apiOrigin,
    `/channels/${encodeURIComponent(channelId)}`,
    { method: "PATCH", body: JSON.stringify({ expiresAt }) },
    session.token,
  );
}

export async function registerDevice(
  session: MobileSession,
  token: string,
  environment: "sandbox" | "production",
): Promise<string | undefined> {
  const raw = await request<{ id?: string; device?: { id?: string } }>(
    session.deployment.apiOrigin,
    "/devices",
    {
      method: "POST",
      body: JSON.stringify({
        platform: "ios",
        apnsToken: token,
        environment,
        notificationsEnabled: true,
      }),
    },
    session.token,
  );
  return raw.device?.id ?? raw.id;
}

export async function unregisterDevice(session: MobileSession): Promise<void> {
  if (!session.deviceId) return;
  await request(
    session.deployment.apiOrigin,
    `/devices/${encodeURIComponent(session.deviceId)}`,
    { method: "DELETE" },
    session.token,
  );
}
