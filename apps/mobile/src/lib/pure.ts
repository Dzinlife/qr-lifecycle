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
  if (!trimmed) throw new Error("服务地址未配置");

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("服务地址格式不正确");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("服务地址必须使用 HTTPS（本机开发地址除外）");
  }
  if (url.username || url.password) throw new Error("服务地址不能包含用户名或密码");
  return url.origin;
}

export function notificationChannelId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const raw = data.channelId;
  if (typeof raw !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

export interface WebBindingQr {
  bindingId: string;
  challenge: string;
}

export function parseWebBindingQr(value: string): WebBindingQr | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "qrlifecycle:" || parsed.hostname !== "web-bind") return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  if ([...parsed.searchParams.keys()].some((key) => key !== "id" && key !== "challenge")) {
    return null;
  }

  const bindingId = parsed.searchParams.get("id");
  const challenge = parsed.searchParams.get("challenge");
  if (
    !bindingId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindingId) ||
    !challenge ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
  ) {
    return null;
  }
  return { bindingId, challenge };
}

export function channelCursorKey(channelId: string): string {
  return `qr-lifecycle.photo-cursor.${channelId}`;
}

export function humanizeError(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误，请稍后重试";
}
