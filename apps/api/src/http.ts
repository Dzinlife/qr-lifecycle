export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class HttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(error: HttpError): Response {
  return json(
    { error: { code: error.code, message: error.message } } satisfies ApiErrorBody,
    { status: error.status },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected JSON body");
  }
  try {
    const parsed: unknown = await request.json();
    return parsed;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
