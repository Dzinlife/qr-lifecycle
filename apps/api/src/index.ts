import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "@qr-lifecycle/contracts";

import {
  authenticate,
  clearedWebSessionCookie,
  MOBILE_SESSION_SECONDS,
  newSession,
  touchSession,
  type AuthContext,
  WEB_SESSION_SECONDS,
  webSessionCookie,
} from "./auth";
import { verifyMobileIdentity } from "./apple-identity";
import { randomToken, sha256 } from "./crypto";
import {
  apiError,
  escapeHtml,
  HttpError,
  json,
  noContent,
  readJson,
} from "./http";
import {
  acceptInboxItem,
  commitDetection,
  ignoreInboxItem,
  listInbox,
  undoDetection,
} from "./detections";
import {
  channelFromRow,
  deviceFromRow,
  qrVersionFromRow,
  type ChannelRow,
  type DeviceRow,
  type QrVersionRow,
} from "./models";
import { sendDueReminders } from "./reminders";

const API_PREFIX = "/api/v1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/heic", "image/heif"]);

interface DeviceInput {
  apnsToken: string;
  environment: "production" | "sandbox";
  notificationsEnabled: boolean;
}

interface AccountIdentityRow {
  account_id: string;
  account_created_at: string;
}

interface MobileBootstrapInput {
  appTransactionJws?: string;
  installationId: string;
  deviceName: string;
}

interface WebBindingRow {
  id: string;
  browser_secret_hash: string;
  challenge_hash: string;
  account_id: string | null;
  approved_by_device_id: string | null;
  requested_user_agent: string | null;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

interface PublicChannelRow {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  expires_at: string | null;
  active_qr_version_id: string | null;
  object_key: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "invalid_input", "Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalTrimmedString(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "invalid_input", "Expected a non-empty string");
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new HttpError(400, "invalid_input", `Value exceeds ${maxLength} characters`);
  }
  return result;
}

function optionalBodyString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new HttpError(400, "invalid_input", "Expected a bounded string");
  }
  return value;
}

function parseMobileBootstrapInput(value: unknown): MobileBootstrapInput {
  const body = record(value);
  const installationId = optionalBodyString(body.installationId, 128) ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(installationId)) {
    throw new HttpError(400, "invalid_installation_identity", "Installation identity is invalid");
  }
  const appTransactionJws = optionalBodyString(body.appTransactionJws, 65_536);
  return {
    installationId,
    ...(appTransactionJws ? { appTransactionJws } : {}),
    deviceName: optionalTrimmedString(body.deviceName, "iPhone", 120),
  };
}

function parseDeviceInput(value: unknown, env: Env): DeviceInput {
  const body = record(value);
  const apnsToken = optionalTrimmedString(body.apnsToken ?? body.token, "", 256);
  if (!/^[a-fA-F0-9]{64,256}$/u.test(apnsToken)) {
    throw new HttpError(400, "invalid_device_token", "APNs token is not valid");
  }
  const environment = body.environment ?? env.APNS_ENVIRONMENT;
  if (environment !== "production" && environment !== "sandbox") {
    throw new HttpError(400, "invalid_environment", "Invalid APNs environment");
  }
  if (body.platform !== undefined && body.platform !== "ios") {
    throw new HttpError(400, "unsupported_platform", "Only iOS APNs devices are supported");
  }
  if (
    body.notificationsEnabled !== undefined &&
    typeof body.notificationsEnabled !== "boolean"
  ) {
    throw new HttpError(400, "invalid_input", "notificationsEnabled must be boolean");
  }
  return {
    apnsToken: apnsToken.toLowerCase(),
    environment,
    notificationsEnabled: body.notificationsEnabled !== false,
  };
}

function deployment(request: Request, env: Env): {
  apiOrigin: string;
  productName: string;
} {
  return {
    apiOrigin: new URL(request.url).origin,
    productName: env.PRODUCT_NAME,
  };
}

function requestUserAgent(request: Request): string | null {
  const value = request.headers.get("user-agent")?.trim();
  return value ? value.slice(0, 512) : null;
}

async function health(request: Request, env: Env): Promise<Response> {
  return json({
    ok: true,
    deployment: deployment(request, env),
  });
}

async function accountForIdentity(
  env: Env,
  identity: Awaited<ReturnType<typeof verifyMobileIdentity>>,
): Promise<AccountIdentityRow> {
  const existing = await env.DB.prepare(
    `SELECT i.account_id, a.created_at AS account_created_at
     FROM account_identities i
     JOIN accounts a ON a.id = i.account_id
     WHERE i.subject_hash = ? LIMIT 1`,
  )
    .bind(identity.subjectHash)
    .first<AccountIdentityRow>();
  if (existing) {
    await env.DB.prepare(
      "UPDATE account_identities SET last_verified_at = ? WHERE subject_hash = ?",
    )
      .bind(new Date().toISOString(), identity.subjectHash)
      .run();
    return existing;
  }

  const now = new Date().toISOString();
  const accountId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)",
      ).bind(accountId, now, now),
      env.DB.prepare(
        `INSERT INTO account_identities (
           id, account_id, provider, subject_hash, environment, created_at, last_verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        accountId,
        identity.provider,
        identity.subjectHash,
        identity.environment,
        now,
        now,
      ),
    ]);
    return { account_id: accountId, account_created_at: now };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
    const raced = await env.DB.prepare(
      `SELECT i.account_id, a.created_at AS account_created_at
       FROM account_identities i
       JOIN accounts a ON a.id = i.account_id
       WHERE i.subject_hash = ? LIMIT 1`,
    )
      .bind(identity.subjectHash)
      .first<AccountIdentityRow>();
    if (!raced) throw error;
    return raced;
  }
}

async function mobileBootstrap(request: Request, env: Env): Promise<Response> {
  const input = parseMobileBootstrapInput(await readJson(request));
  const identity = await verifyMobileIdentity(input, env);
  const account = await accountForIdentity(env, identity);
  const deviceKeyHash = await sha256(`device:${input.installationId}`);
  const now = new Date().toISOString();
  let device = await env.DB.prepare(
    "SELECT * FROM devices WHERE device_key_hash = ? LIMIT 1",
  )
    .bind(deviceKeyHash)
    .first<DeviceRow>();
  if (device && device.account_id !== account.account_id) {
    throw new HttpError(409, "device_identity_conflict", "This installation belongs to another account");
  }
  if (!device) {
    device = await env.DB.prepare(
      `INSERT INTO devices (
         id, account_id, device_key_hash, platform, display_name,
         notifications_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, 'ios', ?, 0, ?, ?) RETURNING *`,
    )
      .bind(
        crypto.randomUUID(),
        account.account_id,
        deviceKeyHash,
        input.deviceName,
        now,
        now,
      )
      .first<DeviceRow>();
  } else {
    device = await env.DB.prepare(
      `UPDATE devices SET display_name = ?, updated_at = ?
       WHERE id = ? AND account_id = ? RETURNING *`,
    )
      .bind(input.deviceName, now, device.id, account.account_id)
      .first<DeviceRow>();
  }
  if (!device) throw new Error("Device upsert did not return a record");

  const session = await newSession(MOBILE_SESSION_SECONDS);
  await env.DB.prepare(
    `INSERT INTO sessions (
       id, account_id, device_id, token_hash, kind, user_agent,
       expires_at, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, 'mobile', ?, ?, ?, ?)`,
  )
    .bind(
      session.id,
      account.account_id,
      device.id,
      session.tokenHash,
      requestUserAgent(request),
      session.expiresAt,
      now,
      now,
    )
    .run();
  return json({
    sessionToken: session.token,
    account: { id: account.account_id, createdAt: account.account_created_at },
    device: { id: device.id },
    deployment: deployment(request, env),
  }, { status: 201 });
}

async function createWebBinding(request: Request, env: Env): Promise<Response> {
  const id = crypto.randomUUID();
  const browserSecret = randomToken();
  const challenge = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO web_bindings (
       id, browser_secret_hash, challenge_hash, requested_user_agent, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      await sha256(browserSecret),
      await sha256(challenge),
      requestUserAgent(request),
      expiresAt,
      now.toISOString(),
    )
    .run();
  const qrValue = `qrlifecycle://web-bind?id=${encodeURIComponent(id)}&challenge=${encodeURIComponent(challenge)}`;
  return json(
    { binding: { id, challenge, qrValue, expiresAt }, browserSecret },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}

function bindingSecret(request: Request): string {
  const value = request.headers.get("x-binding-secret") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(value)) {
    throw new HttpError(401, "invalid_binding_secret", "Binding secret is invalid");
  }
  return value;
}

async function bindingForBrowser(
  request: Request,
  env: Env,
  bindingId: string,
): Promise<WebBindingRow> {
  const row = await env.DB.prepare(
    `SELECT * FROM web_bindings
     WHERE id = ? AND browser_secret_hash = ? LIMIT 1`,
  )
    .bind(bindingId, await sha256(bindingSecret(request)))
    .first<WebBindingRow>();
  if (!row) throw new HttpError(404, "binding_not_found", "Binding request was not found");
  return row;
}

async function webBindingStatus(
  request: Request,
  env: Env,
  bindingId: string,
): Promise<Response> {
  const row = await bindingForBrowser(request, env, bindingId);
  const expired = row.expires_at <= new Date().toISOString();
  const status = expired ? "expired" : row.approved_at ? "approved" : "pending";
  return json({ status, expiresAt: row.expires_at }, { headers: { "cache-control": "no-store" } });
}

async function approveWebBinding(
  request: Request,
  env: Env,
  bindingId: string,
): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  if (!auth.deviceId) throw new HttpError(401, "device_required", "Mobile device is missing");
  const body = record(await readJson(request));
  const challenge = optionalBodyString(body.challenge, 128) ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(challenge)) {
    throw new HttpError(400, "invalid_binding_challenge", "Binding challenge is invalid");
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE web_bindings
     SET account_id = ?, approved_by_device_id = ?, approved_at = ?
     WHERE id = ? AND challenge_hash = ? AND approved_at IS NULL
       AND consumed_at IS NULL AND expires_at > ?`,
  )
    .bind(
      auth.accountId,
      auth.deviceId,
      now,
      bindingId,
      await sha256(challenge),
      now,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(410, "binding_expired", "Binding request expired or was already used");
  }
  return noContent();
}

async function consumeWebBinding(
  request: Request,
  env: Env,
  bindingId: string,
): Promise<Response> {
  const row = await bindingForBrowser(request, env, bindingId);
  const now = new Date().toISOString();
  if (!row.account_id || !row.approved_at || row.consumed_at || row.expires_at <= now) {
    throw new HttpError(409, "binding_not_approved", "Binding request is not approved");
  }
  const session = await newSession(WEB_SESSION_SECONDS);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sessions (
         id, account_id, token_hash, kind, user_agent, expires_at, created_at, last_used_at
       )
       SELECT ?, account_id, ?, 'web', requested_user_agent, ?, ?, ?
       FROM web_bindings
       WHERE id = ? AND browser_secret_hash = ? AND account_id IS NOT NULL
         AND approved_at IS NOT NULL AND consumed_at IS NULL AND expires_at > ?`,
    ).bind(
      session.id,
      session.tokenHash,
      session.expiresAt,
      now,
      now,
      bindingId,
      row.browser_secret_hash,
      now,
    ),
    env.DB.prepare(
      `UPDATE web_bindings SET consumed_at = ?
       WHERE id = ? AND browser_secret_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    ).bind(now, bindingId, row.browser_secret_hash, now),
  ]);
  if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
    throw new HttpError(410, "binding_consumed", "Binding request was already used");
  }
  return json(
    { connected: true },
    {
      headers: {
        "set-cookie": webSessionCookie(request, session.token),
        "cache-control": "no-store",
      },
    },
  );
}

async function me(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  touchSession(env, ctx, auth);
  const account = await env.DB.prepare(
    "SELECT id, created_at FROM accounts WHERE id = ? LIMIT 1",
  )
    .bind(auth.accountId)
    .first<{ id: string; created_at: string }>();
  if (!account) throw new HttpError(401, "unauthorized", "Account no longer exists");
  return json({
    account: { id: account.id, createdAt: account.created_at },
    session: { id: auth.sessionId, kind: auth.sessionKind },
    deployment: deployment(request, env),
  });
}

async function logoutWeb(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "web");
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_id = ?",
  )
    .bind(new Date().toISOString(), auth.sessionId, auth.accountId)
    .run();
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearedWebSessionCookie(request) },
  });
}

async function listWebSessions(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  const rows = await env.DB.prepare(
    `SELECT id, user_agent, created_at, last_used_at, expires_at
     FROM sessions
     WHERE account_id = ? AND kind = 'web' AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_used_at DESC`,
  )
    .bind(auth.accountId, new Date().toISOString())
    .all<{
      id: string;
      user_agent: string | null;
      created_at: string;
      last_used_at: string;
      expires_at: string;
    }>();
  return json({
    sessions: rows.results.map((row) => ({
      id: row.id,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    })),
  });
}

async function revokeWebSession(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  const result = await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ?
     WHERE id = ? AND account_id = ? AND kind = 'web' AND revoked_at IS NULL`,
  )
    .bind(new Date().toISOString(), sessionId, auth.accountId)
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(404, "web_session_not_found", "Browser session was not found");
  }
  return noContent();
}

function invalidSchema(issues: readonly { message: string }[]): never {
  throw new HttpError(400, "invalid_input", issues[0]?.message ?? "Input is invalid");
}

async function listChannels(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const result = await env.DB.prepare(
    `SELECT * FROM channels
     WHERE account_id = ?
     ORDER BY disabled_at IS NOT NULL ASC, updated_at DESC`,
  )
    .bind(auth.accountId)
    .all<ChannelRow>();
  return json({ channels: result.results.map(channelFromRow) });
}

async function createChannel(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  const parsed = createChannelSchema.safeParse(await readJson(request));
  if (!parsed.success) invalidSchema(parsed.error.issues);
  const input: CreateChannelInput = parsed.data;
  const now = new Date().toISOString();
  const row: ChannelRow = {
    id: crypto.randomUUID(),
    account_id: auth.accountId,
    name: input.name,
    platform: input.platform,
    slug: input.slug,
    expires_at: input.expiresAt,
    remind_before_minutes: input.remindBeforeMinutes,
    active_qr_version_id: null,
    disabled_at: null,
    created_at: now,
    updated_at: now,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO channels (
         id, account_id, name, platform, slug, expires_at,
         remind_before_minutes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.account_id,
        row.name,
        row.platform,
        row.slug,
        row.expires_at,
        row.remind_before_minutes,
        row.created_at,
        row.updated_at,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, "slug_conflict", "This public slug is already in use");
    }
    throw error;
  }
  return json({ channel: channelFromRow(row) }, { status: 201 });
}

async function channelById(
  request: Request,
  env: Env,
  channelId: string,
): Promise<{ auth: AuthContext; row: ChannelRow }> {
  const auth = await authenticate(request, env);
  const row = await env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? AND account_id = ? LIMIT 1",
  )
    .bind(channelId, auth.accountId)
    .first<ChannelRow>();
  if (!row) throw new HttpError(404, "channel_not_found", "Channel was not found");
  return { auth, row };
}

async function getChannel(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const { row } = await channelById(request, env, channelId);
  return json({ channel: channelFromRow(row) });
}

async function updateChannel(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const { auth } = await channelById(request, env, channelId);
  const parsed = updateChannelSchema.safeParse(await readJson(request));
  if (!parsed.success) invalidSchema(parsed.error.issues);
  const input: UpdateChannelInput = parsed.data;
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    assignments.push("name = ?");
    values.push(input.name);
  }
  if (input.platform !== undefined) {
    assignments.push("platform = ?");
    values.push(input.platform);
  }
  if (input.slug !== undefined) {
    assignments.push("slug = ?");
    values.push(input.slug);
  }
  if (input.expiresAt !== undefined) {
    assignments.push("expires_at = ?");
    values.push(input.expiresAt);
  }
  if (input.remindBeforeMinutes !== undefined) {
    assignments.push("remind_before_minutes = ?");
    values.push(input.remindBeforeMinutes);
  }
  if (assignments.length === 0) {
    throw new HttpError(400, "empty_update", "At least one field must be updated");
  }
  assignments.push("updated_at = ?");
  values.push(new Date().toISOString(), channelId, auth.accountId);
  try {
    await env.DB.prepare(
      `UPDATE channels SET ${assignments.join(", ")}
       WHERE id = ? AND account_id = ?`,
    )
      .bind(...values)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, "slug_conflict", "This public slug is already in use");
    }
    throw error;
  }
  const updated = await env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? AND account_id = ? LIMIT 1",
  )
    .bind(channelId, auth.accountId)
    .first<ChannelRow>();
  if (!updated) throw new HttpError(404, "channel_not_found", "Channel was not found");
  return json({ channel: channelFromRow(updated) });
}

async function deleteChannel(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const auth = await authenticate(request, env);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE channels SET disabled_at = ?, updated_at = ?
     WHERE id = ? AND account_id = ? AND disabled_at IS NULL`,
  )
    .bind(now, now, channelId, auth.accountId)
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(404, "channel_not_found", "Channel was not found");
  }
  return noContent();
}

async function listQrVersions(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const { auth } = await channelById(request, env, channelId);
  const result = await env.DB.prepare(
    `SELECT id, account_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions
     WHERE channel_id = ? AND account_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(channelId, auth.accountId)
    .all<QrVersionRow>();
  return json({ qrVersions: result.results.map(qrVersionFromRow) });
}

function formString(form: FormData, name: string, required: boolean): string | null {
  const value = form.get(name);
  if (value === null && !required) return null;
  if (typeof value !== "string" || (required && value.trim().length === 0)) {
    throw new HttpError(400, "invalid_upload", `${name} must be a string`);
  }
  return value.trim();
}

function optionalCapturedAt(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, "invalid_captured_at", "capturedAt is not a valid instant");
  }
  return new Date(timestamp).toISOString();
}

async function uploadQrVersion(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const { auth } = await channelById(request, env, channelId);
  if (auth.sessionKind !== "mobile") {
    throw new HttpError(403, "mobile_session_required", "QR images are updated from the mobile app");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Expected multipart form data");
  }
  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader) {
    throw new HttpError(411, "length_required", "Content-Length is required for uploads");
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength > MAX_MULTIPART_BYTES) {
    throw new HttpError(413, "image_too_large", "QR image must not exceed 10 MiB");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_upload", "Multipart body could not be parsed");
  }
  const image = form.get("image");
  if (!(image instanceof File)) {
    throw new HttpError(400, "image_required", "A QR image is required");
  }
  const normalizedType = image.type.toLowerCase();
  if (!IMAGE_TYPES.has(normalizedType)) {
    throw new HttpError(415, "unsupported_image_type", "Use PNG, JPEG, or HEIC");
  }
  if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "image_too_large", "QR image must not exceed 10 MiB");
  }
  const decodedPayload = formString(form, "decodedPayload", true);
  if (!decodedPayload || decodedPayload.length > 8_192) {
    throw new HttpError(400, "invalid_payload", "Decoded QR payload is invalid");
  }
  const sourceAssetId = formString(form, "sourceAssetId", false);
  if (sourceAssetId && sourceAssetId.length > 512) {
    throw new HttpError(400, "invalid_source_asset", "sourceAssetId is too long");
  }
  const capturedAt = optionalCapturedAt(formString(form, "capturedAt", false));
  const decodedPayloadHash = await sha256(
    `${auth.accountId}${decodedPayload}`,
  );

  const existing = await env.DB.prepare(
    `SELECT id, account_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions
     WHERE account_id = ? AND channel_id = ? AND decoded_payload_hash = ?
     LIMIT 1`,
  )
    .bind(auth.accountId, channelId, decodedPayloadHash)
    .first<QrVersionRow>();
  if (existing) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE channels SET active_qr_version_id = ?, updated_at = ?
       WHERE id = ? AND account_id = ?`,
    )
      .bind(existing.id, now, channelId, auth.accountId)
      .run();
    const channel = await env.DB.prepare(
      "SELECT * FROM channels WHERE id = ? AND account_id = ? LIMIT 1",
    )
      .bind(channelId, auth.accountId)
      .first<ChannelRow>();
    if (!channel) throw new HttpError(404, "channel_not_found", "Channel was not found");
    return json({ qrVersion: qrVersionFromRow(existing), channel: channelFromRow(channel) });
  }

  const versionId = crypto.randomUUID();
  const objectKey = `accounts/${auth.accountId}/channels/${channelId}/${versionId}`;
  const now = new Date().toISOString();
  await env.QR_BUCKET.put(objectKey, image, {
    httpMetadata: {
      contentType: normalizedType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      accountId: auth.accountId,
      channelId,
      versionId,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO qr_versions (
           id, account_id, channel_id, object_key, content_type, byte_size,
           decoded_payload_hash, source_asset_id, captured_at, activated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        auth.accountId,
        channelId,
        objectKey,
        normalizedType,
        image.size,
        decodedPayloadHash,
        sourceAssetId,
        capturedAt,
        now,
        now,
      ),
      env.DB.prepare(
        `UPDATE channels SET active_qr_version_id = ?, updated_at = ?
         WHERE id = ? AND account_id = ?`,
      ).bind(versionId, now, channelId, auth.accountId),
    ]);
  } catch (error) {
    await env.QR_BUCKET.delete(objectKey);
    throw error;
  }

  const [qrVersion, channel] = await Promise.all([
    env.DB.prepare(
      `SELECT id, account_id, channel_id, decoded_payload_hash, source_asset_id,
              captured_at, activated_at, created_at
       FROM qr_versions WHERE id = ? AND account_id = ? AND channel_id = ? LIMIT 1`,
    )
      .bind(versionId, auth.accountId, channelId)
      .first<QrVersionRow>(),
    env.DB.prepare(
      "SELECT * FROM channels WHERE id = ? AND account_id = ? LIMIT 1",
    )
      .bind(channelId, auth.accountId)
      .first<ChannelRow>(),
  ]);
  if (!qrVersion || !channel) {
    throw new Error("QR version activation did not produce expected records");
  }
  return json(
    { qrVersion: qrVersionFromRow(qrVersion), channel: channelFromRow(channel) },
    { status: 201 },
  );
}

async function upsertDevice(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  if (!auth.deviceId) throw new HttpError(401, "device_required", "Mobile device is missing");
  const input = parseDeviceInput(await readJson(request), env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE devices
     SET apns_token = NULL, apns_environment = NULL,
         notifications_enabled = 0, updated_at = ?
     WHERE apns_token = ? AND id <> ?`,
  )
    .bind(now, input.apnsToken, auth.deviceId)
    .run();
  const row = await env.DB.prepare(
    `UPDATE devices
     SET apns_token = ?, apns_environment = ?, notifications_enabled = ?, updated_at = ?
     WHERE id = ? AND account_id = ? RETURNING *`,
  )
    .bind(
      input.apnsToken,
      input.environment,
      input.notificationsEnabled ? 1 : 0,
      now,
      auth.deviceId,
      auth.accountId,
    )
    .first<DeviceRow>();
  if (!row) throw new Error("Device upsert did not return a record");
  return json({ device: deviceFromRow(row) }, { status: 201 });
}

async function deleteDevice(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  if (auth.deviceId !== deviceId) {
    throw new HttpError(403, "device_mismatch", "A device can only disconnect itself");
  }
  const result = await env.DB.prepare(
    "DELETE FROM devices WHERE id = ? AND account_id = ?",
  )
    .bind(deviceId, auth.accountId)
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(404, "device_not_found", "Device was not found");
  }
  return noContent();
}

async function publicChannel(env: Env, slug: string): Promise<PublicChannelRow | null> {
  return env.DB.prepare(
    `SELECT
       c.id, c.account_id, c.name, c.slug, c.expires_at, c.active_qr_version_id,
       q.object_key
     FROM channels c
     LEFT JOIN qr_versions q
       ON q.id = c.active_qr_version_id
      AND q.account_id = c.account_id
      AND q.channel_id = c.id
     WHERE c.slug = ? AND c.disabled_at IS NULL
     LIMIT 1`,
  )
    .bind(slug)
    .first<PublicChannelRow>();
}

function unavailablePage(productName: string): Response {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>二维码暂不可用</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f7f9;color:#202124}.card{max-width:28rem;padding:2rem;text-align:center;background:#fff;border-radius:1.25rem;box-shadow:0 8px 30px #0001}h1{font-size:1.35rem}</style></head><body><main class="card"><h1>二维码暂不可用</h1><p>运营者正在更新入口，请稍后重试。</p><small>${escapeHtml(productName)}</small></main></body></html>`,
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function publicQrPage(env: Env, slug: string): Promise<Response> {
  const channel = await publicChannel(env, slug);
  if (!channel?.active_qr_version_id || !channel.object_key) {
    return unavailablePage(env.PRODUCT_NAME);
  }
  const title = escapeHtml(channel.name);
  const expires = channel.expires_at
    ? `<p>建议在 <time datetime="${escapeHtml(channel.expires_at)}">${escapeHtml(channel.expires_at)}</time> 前使用</p>`
    : "";
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>${title}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f7f9;color:#202124}.card{max-width:30rem;padding:1.5rem;text-align:center;background:#fff;border-radius:1.25rem;box-shadow:0 8px 30px #0001}img{display:block;width:min(80vw,24rem);height:auto;margin:1rem auto;border-radius:.75rem}h1{font-size:1.35rem}</style></head><body><main class="card"><h1>${title}</h1><img src="/q/${encodeURIComponent(slug)}/image?v=${encodeURIComponent(channel.active_qr_version_id)}" alt="${title} 群二维码">${expires}<small>页面会自动刷新 · ${escapeHtml(env.PRODUCT_NAME)}</small></main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

async function publicQrImage(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  const channel = await publicChannel(env, slug);
  if (!channel?.object_key) return unavailablePage(env.PRODUCT_NAME);
  const object = await env.QR_BUCKET.get(channel.object_key);
  if (!object) return unavailablePage(env.PRODUCT_NAME);
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: { etag: object.httpEtag, "cache-control": "public, max-age=60" },
    });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=60, stale-while-revalidate=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

async function routeApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "GET" && (pathname === "/health" || pathname === `${API_PREFIX}/health`)) {
    return health(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/mobile/bootstrap`) {
    return mobileBootstrap(request, env);
  }
  if (method === "GET" && pathname === `${API_PREFIX}/me`) {
    return me(request, env, ctx);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/web/logout`) {
    return logoutWeb(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/web-bindings`) {
    return createWebBinding(request, env);
  }
  if (method === "GET" && pathname === `${API_PREFIX}/web-sessions`) {
    return listWebSessions(request, env);
  }
  if (pathname === `${API_PREFIX}/channels`) {
    if (method === "GET") return listChannels(request, env);
    if (method === "POST") return createChannel(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/devices`) {
    return upsertDevice(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/detections/commit`) {
    return commitDetection(request, env);
  }
  if (method === "GET" && pathname === `${API_PREFIX}/inbox`) {
    return listInbox(request, env);
  }

  const webBindingMatch = new RegExp(
    `^${API_PREFIX}/web-bindings/([^/]+)(?:/(approve|consume))?$`,
    "u",
  ).exec(pathname);
  if (webBindingMatch?.[1]) {
    const bindingId = decodeURIComponent(webBindingMatch[1]);
    if (method === "GET" && !webBindingMatch[2]) {
      return webBindingStatus(request, env, bindingId);
    }
    if (method === "POST" && webBindingMatch[2] === "approve") {
      return approveWebBinding(request, env, bindingId);
    }
    if (method === "POST" && webBindingMatch[2] === "consume") {
      return consumeWebBinding(request, env, bindingId);
    }
  }

  const webSessionMatch = new RegExp(`^${API_PREFIX}/web-sessions/([^/]+)$`, "u").exec(
    pathname,
  );
  if (webSessionMatch?.[1] && method === "DELETE") {
    return revokeWebSession(request, env, decodeURIComponent(webSessionMatch[1]));
  }

  const inboxActionMatch = new RegExp(
    `^${API_PREFIX}/inbox/([^/]+)/(accept|ignore)$`,
    "u",
  ).exec(pathname);
  if (inboxActionMatch?.[1] && inboxActionMatch[2] && method === "POST") {
    const detectionId = decodeURIComponent(inboxActionMatch[1]);
    return inboxActionMatch[2] === "accept"
      ? acceptInboxItem(request, env, detectionId)
      : ignoreInboxItem(request, env, detectionId);
  }
  const detectionUndoMatch = new RegExp(
    `^${API_PREFIX}/detections/([^/]+)/undo$`,
    "u",
  ).exec(pathname);
  if (detectionUndoMatch?.[1] && method === "POST") {
    return undoDetection(request, env, decodeURIComponent(detectionUndoMatch[1]));
  }

  const qrVersionsMatch = new RegExp(
    `^${API_PREFIX}/channels/([^/]+)/qr-versions$`,
    "u",
  ).exec(pathname);
  if (qrVersionsMatch?.[1]) {
    const channelId = decodeURIComponent(qrVersionsMatch[1]);
    if (method === "GET") return listQrVersions(request, env, channelId);
    if (method === "POST") return uploadQrVersion(request, env, channelId);
  }
  const channelMatch = new RegExp(`^${API_PREFIX}/channels/([^/]+)$`, "u").exec(
    pathname,
  );
  if (channelMatch?.[1]) {
    const channelId = decodeURIComponent(channelMatch[1]);
    if (method === "GET") return getChannel(request, env, channelId);
    if (method === "PATCH") return updateChannel(request, env, channelId);
    if (method === "DELETE") return deleteChannel(request, env, channelId);
  }
  const deviceMatch = new RegExp(`^${API_PREFIX}/devices/([^/]+)$`, "u").exec(pathname);
  if (deviceMatch?.[1] && method === "DELETE") {
    return deleteDevice(request, env, decodeURIComponent(deviceMatch[1]));
  }
  throw new HttpError(404, "not_found", "Route was not found");
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method.toUpperCase() === "OPTIONS") {
        return new Response(null, { status: 204 });
      }
      const imageMatch = /^\/q\/([^/]+)\/image$/u.exec(url.pathname);
      if (imageMatch?.[1] && request.method === "GET") {
        return publicQrImage(request, env, decodeURIComponent(imageMatch[1]));
      }
      const pageMatch = /^\/q\/([^/]+)$/u.exec(url.pathname);
      if (pageMatch?.[1] && request.method === "GET") {
        return publicQrPage(env, decodeURIComponent(pageMatch[1]));
      }
      return await routeApi(request, env, ctx, url.pathname);
    } catch (error) {
      const response =
        error instanceof HttpError
          ? apiError(error)
          : (() => {
              console.error(
                JSON.stringify({
                  message: "request failed",
                  error: error instanceof Error ? error.message : String(error),
                  path: new URL(request.url).pathname,
                }),
              );
              return apiError(
                new HttpError(500, "internal_error", "An internal error occurred"),
              );
            })();
      return response;
    }
  },

  async scheduled(controller, env): Promise<void> {
    const result = await sendDueReminders(
      env,
      undefined,
      new Date(controller.scheduledTime),
    );
    console.log(JSON.stringify({ message: "reminder scan complete", ...result }));
  },
} satisfies ExportedHandler<Env>;
