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

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const configured: unknown = Reflect.get(env, "CORS_ORIGINS");
  const origins = typeof configured === "string" ? configured : "";
  if (origins === "*") return "*";
  const allowed = origins.split(",").map((value: string) => value.trim());
  return allowed.includes(origin) ? origin : null;
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const result = new Response(response.body, response);
  result.headers.set("access-control-allow-origin", origin);
  result.headers.set("vary", "Origin");
  return result;
}

export function corsPreflight(request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "Authorization,Content-Type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
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
