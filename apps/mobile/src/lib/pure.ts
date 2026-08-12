import type { DeploymentInfo } from "@qr-lifecycle/contracts";

export interface PairPayload {
  sessionToken: string;
  deployment: DeploymentInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function normalizeApiOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请输入部署地址");

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("部署地址格式不正确");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("部署地址必须使用 HTTPS（本机开发地址除外）");
  }
  if (url.username || url.password) throw new Error("部署地址不能包含用户名或密码");
  return url.origin;
}

export function normalizePairingCode(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidPairingCode(input: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/u.test(
    normalizePairingCode(input),
  );
}

export function parsePairPayload(value: unknown): PairPayload {
  if (!isRecord(value)) throw new Error("配对响应格式不正确");

  const nestedSession = isRecord(value.session) ? value.session : undefined;
  const sessionToken =
    (typeof value.sessionToken === "string" && value.sessionToken) ||
    (typeof value.token === "string" && value.token) ||
    (nestedSession && typeof nestedSession.token === "string" && nestedSession.token);
  const deployment = value.deployment;

  if (!sessionToken || !isRecord(deployment)) {
    throw new Error("配对响应缺少会话或部署信息");
  }
  if (
    (deployment.mode !== "self_hosted" && deployment.mode !== "managed") ||
    typeof deployment.apiOrigin !== "string" ||
    typeof deployment.productName !== "string" ||
    typeof deployment.registrationEnabled !== "boolean"
  ) {
    throw new Error("部署信息格式不正确");
  }

  return {
    sessionToken,
    deployment: {
      mode: deployment.mode,
      apiOrigin: normalizeApiOrigin(deployment.apiOrigin),
      productName: deployment.productName,
      registrationEnabled: deployment.registrationEnabled,
    },
  };
}

export function notificationChannelId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const raw = data.channelId;
  if (typeof raw !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

export function channelCursorKey(channelId: string): string {
  return `qr-lifecycle.photo-cursor.${channelId}`;
}

export function humanizeError(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误，请稍后重试";
}
