import { HttpError } from "./http";
import type { AuthRow } from "./models";
import { randomToken, sha256 } from "./crypto";

export interface AuthContext {
  sessionId: string;
  tenantId: string;
  userId: string;
  sessionKind: "web" | "mobile";
  email: string;
  displayName: string;
  tenantName: string;
  tenantSlug: string;
  role: "owner" | "member";
}

export interface NewSession {
  id: string;
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export async function newSession(lifetimeSeconds: number): Promise<NewSession> {
  const token = randomToken();
  return {
    id: crypto.randomUUID(),
    token,
    tokenHash: await sha256(token),
    expiresAt: new Date(Date.now() + lifetimeSeconds * 1_000).toISOString(),
  };
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/u.exec(authorization);
  if (!match?.[1]) {
    throw new HttpError(401, "unauthorized", "A valid bearer token is required");
  }
  return match[1];
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const tokenHash = await sha256(bearerToken(request));
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.tenant_id,
       s.user_id,
       s.kind AS session_kind,
       u.email,
       u.display_name,
       t.name AS tenant_name,
       t.slug AS tenant_slug,
       m.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN tenants t ON t.id = s.tenant_id
     JOIN memberships m
       ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
     WHERE s.token_hash = ?
       AND s.tenant_id = m.tenant_id
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
     LIMIT 1`,
  )
    .bind(tokenHash, now)
    .first<AuthRow>();

  if (!row) {
    throw new HttpError(401, "unauthorized", "Session is invalid or expired");
  }

  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionKind: row.session_kind,
    email: row.email,
    displayName: row.display_name,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}
