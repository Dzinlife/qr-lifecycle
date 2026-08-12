import { HttpError } from "./http";
import { randomToken, sha256 } from "./crypto";

export type SessionKind = "web" | "mobile";

export interface AuthContext {
  sessionId: string;
  accountId: string;
  deviceId: string | null;
  sessionKind: SessionKind;
  userAgent: string | null;
}

export interface NewSession {
  id: string;
  token: string;
  tokenHash: string;
  expiresAt: string;
}

interface AuthRow {
  session_id: string;
  account_id: string;
  device_id: string | null;
  session_kind: SessionKind;
  user_agent: string | null;
}

export const WEB_SESSION_SECONDS = 90 * 24 * 60 * 60;
export const MOBILE_SESSION_SECONDS = 365 * 24 * 60 * 60;

export async function newSession(lifetimeSeconds: number): Promise<NewSession> {
  const token = randomToken();
  return {
    id: crypto.randomUUID(),
    token,
    tokenHash: await sha256(token),
    expiresAt: new Date(Date.now() + lifetimeSeconds * 1_000).toISOString(),
  };
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function webCookieName(request: Request): string {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "fallinlife_session"
    : "__Host-fallinlife_session";
}

function requestToken(request: Request): { token: string; source: "bearer" | "cookie" } {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer ([A-Za-z0-9_-]{32,})$/u.exec(authorization)?.[1];
  if (bearer) return { token: bearer, source: "bearer" };

  const cookie = cookieValue(request, webCookieName(request));
  if (cookie && /^[A-Za-z0-9_-]{32,}$/u.test(cookie)) {
    return { token: cookie, source: "cookie" };
  }
  throw new HttpError(401, "unauthorized", "A valid session is required");
}

function assertSameOriginMutation(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) {
    throw new HttpError(403, "invalid_origin", "The request origin is not allowed");
  }
}

export async function authenticate(
  request: Request,
  env: Env,
  requiredKind?: SessionKind,
): Promise<AuthContext> {
  const credential = requestToken(request);
  const tokenHash = await sha256(credential.token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT
       id AS session_id,
       account_id,
       device_id,
       kind AS session_kind,
       user_agent
     FROM sessions
     WHERE token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > ?
     LIMIT 1`,
  )
    .bind(tokenHash, now)
    .first<AuthRow>();

  if (!row || (requiredKind && row.session_kind !== requiredKind)) {
    throw new HttpError(401, "unauthorized", "Session is invalid or expired");
  }
  if (row.session_kind === "web") {
    if (credential.source !== "cookie") {
      throw new HttpError(401, "web_cookie_required", "Web sessions require a secure cookie");
    }
    assertSameOriginMutation(request);
  } else if (credential.source !== "bearer") {
    throw new HttpError(401, "mobile_bearer_required", "Mobile sessions require a bearer token");
  }

  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    deviceId: row.device_id,
    sessionKind: row.session_kind,
    userAgent: row.user_agent,
  };
}

export function touchSession(env: Env, ctx: ExecutionContext, auth: AuthContext): void {
  ctx.waitUntil(
    env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ? AND account_id = ?")
      .bind(new Date().toISOString(), auth.sessionId, auth.accountId)
      .run()
      .then(() => undefined),
  );
}

export function webSessionCookie(request: Request, token: string): string {
  const local = ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
  return [
    `${webCookieName(request)}=${token}`,
    "Path=/",
    "HttpOnly",
    ...(local ? [] : ["Secure"]),
    "SameSite=Lax",
    `Max-Age=${WEB_SESSION_SECONDS}`,
  ].join("; ");
}

export function clearedWebSessionCookie(request: Request): string {
  const local = ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
  return [
    `${webCookieName(request)}=`,
    "Path=/",
    "HttpOnly",
    ...(local ? [] : ["Secure"]),
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}
