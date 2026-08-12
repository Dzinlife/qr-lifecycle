import {
  createChannelSchema,
  updateChannelSchema,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "@qr-lifecycle/contracts";

import { authenticate, newSession, type AuthContext } from "./auth";
import {
  randomPairingCode,
  randomToken,
  sha256,
  timingSafeEqualBytes,
} from "./crypto";
import {
  apiError,
  corsPreflight,
  escapeHtml,
  HttpError,
  json,
  noContent,
  readJson,
  withCors,
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
  type PairingRow,
  type QrVersionRow,
} from "./models";
import { sendDueReminders } from "./reminders";

const API_PREFIX = "/api/v1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/heic", "image/heif"]);

interface BootstrapInput {
  email: string;
  displayName: string;
  tenantName: string;
}

interface DeviceInput {
  apnsToken: string;
  environment: "production" | "sandbox";
  notificationsEnabled: boolean;
}

interface RecoveryOwnerRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  recovery_code_hash: string;
  user_id: string;
  email: string;
  display_name: string;
}

interface PublicChannelRow {
  id: string;
  tenant_id: string;
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

function parseBootstrapInput(value: unknown): BootstrapInput {
  const body = record(value);
  const email = optionalTrimmedString(
    body.email ?? body.ownerEmail,
    "owner@local.invalid",
    320,
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new HttpError(400, "invalid_email", "Email address is not valid");
  }
  return {
    email,
    displayName: optionalTrimmedString(body.displayName, "Owner", 120),
    tenantName: optionalTrimmedString(body.tenantName, "My workspace", 120),
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
  mode: "self_hosted" | "managed";
  apiOrigin: string;
  productName: string;
  registrationEnabled: boolean;
} {
  return {
    mode: env.DEPLOYMENT_MODE,
    apiOrigin: new URL(request.url).origin,
    productName: env.PRODUCT_NAME,
    registrationEnabled: env.REGISTRATION_ENABLED,
  };
}

function userAndTenant(auth: AuthContext): {
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; name: string; slug: string };
  membership: { role: "owner" | "member" };
} {
  return {
    user: { id: auth.userId, email: auth.email, displayName: auth.displayName },
    tenant: { id: auth.tenantId, name: auth.tenantName, slug: auth.tenantSlug },
    membership: { role: auth.role },
  };
}

async function health(request: Request, env: Env): Promise<Response> {
  const initialized = await env.DB.prepare(
    "SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1",
  ).first<{ id: string }>();
  return json({
    ok: true,
    bootstrapped: initialized !== null,
    deployment: deployment(request, env),
  });
}

async function bootstrap(request: Request, env: Env): Promise<Response> {
  if (env.DEPLOYMENT_MODE !== "self_hosted") {
    throw new HttpError(404, "not_found", "Bootstrap is not available");
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = ? LIMIT 1",
  )
    .bind("default")
    .first<{ id: string }>();
  if (existing) {
    throw new HttpError(409, "already_bootstrapped", "Deployment is already initialized");
  }

  const input = parseBootstrapInput(await readJson(request));
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const session = await newSession(30 * 24 * 60 * 60);
  const recoveryCode = randomToken();
  const recoveryCodeHash = await sha256(recoveryCode);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(userId, input.email, input.displayName, now, now),
      env.DB.prepare(
        `INSERT INTO tenants (
           id, name, slug, recovery_code_hash, created_at, updated_at
         ) VALUES (?, ?, 'default', ?, ?, ?)`,
      ).bind(tenantId, input.tenantName, recoveryCodeHash, now, now),
      env.DB.prepare(
        `INSERT INTO memberships (tenant_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`,
      ).bind(tenantId, userId, now),
      env.DB.prepare(
        `INSERT INTO sessions (
           id, tenant_id, user_id, token_hash, kind, expires_at, created_at, last_used_at
         ) VALUES (?, ?, ?, ?, 'web', ?, ?, ?)`,
      ).bind(
        session.id,
        tenantId,
        userId,
        session.tokenHash,
        session.expiresAt,
        now,
        now,
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, "already_bootstrapped", "Deployment is already initialized");
    }
    throw error;
  }

  return json(
    {
      sessionToken: session.token,
      recoveryCode,
      user: { id: userId, email: input.email, displayName: input.displayName },
      tenant: { id: tenantId, name: input.tenantName, slug: "default" },
      deployment: deployment(request, env),
    },
    { status: 201 },
  );
}

async function requestAuthCode(request: Request, env: Env): Promise<Response> {
  if (env.DEPLOYMENT_MODE === "self_hosted") {
    const body = record(await readJson(request));
    if (body.email !== undefined && typeof body.email !== "string") {
      throw new HttpError(400, "invalid_email", "Email address is not valid");
    }
    // Deliberately do not reveal whether an owner email exists.
    return json({ accepted: true, method: "recovery_code" }, { status: 202 });
  }
  throw new HttpError(
    501,
    "managed_auth_not_configured",
    "Managed email authentication is not configured",
  );
}

async function verifyAuthCode(request: Request, env: Env): Promise<Response> {
  if (env.DEPLOYMENT_MODE !== "self_hosted") {
    throw new HttpError(
      501,
      "managed_auth_not_configured",
      "Managed email authentication is not configured",
    );
  }
  const body = record(await readJson(request));
  const email = optionalTrimmedString(body.email, "", 320).toLowerCase();
  const recoveryCode = optionalTrimmedString(
    body.recoveryCode ?? body.code,
    "",
    256,
  );
  const owner = await env.DB.prepare(
    `SELECT
       t.id AS tenant_id,
       t.name AS tenant_name,
       t.slug AS tenant_slug,
       t.recovery_code_hash,
       u.id AS user_id,
       u.email,
       u.display_name
     FROM tenants t
     JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner'
     JOIN users u ON u.id = m.user_id
     WHERE u.email = ? COLLATE NOCASE
       AND t.recovery_code_hash IS NOT NULL
     ORDER BY t.created_at ASC
     LIMIT 1`,
  )
    .bind(email)
    .first<RecoveryOwnerRow>();
  const providedHash = await sha256(recoveryCode);
  const providedBytes = new TextEncoder().encode(providedHash);
  const expectedBytes = new TextEncoder().encode(
    owner?.recovery_code_hash ?? "0".repeat(64),
  );
  if (!owner || !timingSafeEqualBytes(providedBytes, expectedBytes)) {
    throw new HttpError(401, "invalid_code", "Email or recovery code is invalid");
  }

  const session = await newSession(30 * 24 * 60 * 60);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (
       id, tenant_id, user_id, token_hash, kind, expires_at, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, 'web', ?, ?, ?)`,
  )
    .bind(
      session.id,
      owner.tenant_id,
      owner.user_id,
      session.tokenHash,
      session.expiresAt,
      now,
      now,
    )
    .run();
  return json({
    sessionToken: session.token,
    user: {
      id: owner.user_id,
      email: owner.email,
      displayName: owner.display_name,
    },
    tenant: {
      id: owner.tenant_id,
      name: owner.tenant_name,
      slug: owner.tenant_slug,
    },
    deployment: deployment(request, env),
  });
}

async function me(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await authenticate(request, env);
  ctx.waitUntil(
    env.DB.prepare(
      "UPDATE sessions SET last_used_at = ? WHERE id = ? AND tenant_id = ?",
    )
      .bind(new Date().toISOString(), auth.sessionId, auth.tenantId)
      .run()
      .then(() => undefined),
  );
  return json({ ...userAndTenant(auth), deployment: deployment(request, env) });
}

function invalidSchema(issues: readonly { message: string }[]): never {
  throw new HttpError(400, "invalid_input", issues[0]?.message ?? "Input is invalid");
}

async function listChannels(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const result = await env.DB.prepare(
    `SELECT * FROM channels
     WHERE tenant_id = ?
     ORDER BY disabled_at IS NOT NULL ASC, updated_at DESC`,
  )
    .bind(auth.tenantId)
    .all<ChannelRow>();
  return json({ channels: result.results.map(channelFromRow) });
}

async function createChannel(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const parsed = createChannelSchema.safeParse(await readJson(request));
  if (!parsed.success) invalidSchema(parsed.error.issues);
  const input: CreateChannelInput = parsed.data;
  const now = new Date().toISOString();
  const row: ChannelRow = {
    id: crypto.randomUUID(),
    tenant_id: auth.tenantId,
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
         id, tenant_id, name, platform, slug, expires_at,
         remind_before_minutes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.tenant_id,
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
    "SELECT * FROM channels WHERE id = ? AND tenant_id = ? LIMIT 1",
  )
    .bind(channelId, auth.tenantId)
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
  values.push(new Date().toISOString(), channelId, auth.tenantId);
  try {
    await env.DB.prepare(
      `UPDATE channels SET ${assignments.join(", ")}
       WHERE id = ? AND tenant_id = ?`,
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
    "SELECT * FROM channels WHERE id = ? AND tenant_id = ? LIMIT 1",
  )
    .bind(channelId, auth.tenantId)
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
     WHERE id = ? AND tenant_id = ? AND disabled_at IS NULL`,
  )
    .bind(now, now, channelId, auth.tenantId)
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
    `SELECT id, tenant_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions
     WHERE channel_id = ? AND tenant_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(channelId, auth.tenantId)
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
    `${auth.tenantId}${decodedPayload}`,
  );

  const existing = await env.DB.prepare(
    `SELECT id, tenant_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions
     WHERE tenant_id = ? AND channel_id = ? AND decoded_payload_hash = ?
     LIMIT 1`,
  )
    .bind(auth.tenantId, channelId, decodedPayloadHash)
    .first<QrVersionRow>();
  if (existing) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE channels SET active_qr_version_id = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
    )
      .bind(existing.id, now, channelId, auth.tenantId)
      .run();
    const channel = await env.DB.prepare(
      "SELECT * FROM channels WHERE id = ? AND tenant_id = ? LIMIT 1",
    )
      .bind(channelId, auth.tenantId)
      .first<ChannelRow>();
    if (!channel) throw new HttpError(404, "channel_not_found", "Channel was not found");
    return json({ qrVersion: qrVersionFromRow(existing), channel: channelFromRow(channel) });
  }

  const versionId = crypto.randomUUID();
  const objectKey = `tenants/${auth.tenantId}/channels/${channelId}/${versionId}`;
  const now = new Date().toISOString();
  await env.QR_BUCKET.put(objectKey, image, {
    httpMetadata: {
      contentType: normalizedType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      tenantId: auth.tenantId,
      channelId,
      versionId,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO qr_versions (
           id, tenant_id, channel_id, object_key, content_type, byte_size,
           decoded_payload_hash, source_asset_id, captured_at, activated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        auth.tenantId,
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
         WHERE id = ? AND tenant_id = ?`,
      ).bind(versionId, now, channelId, auth.tenantId),
    ]);
  } catch (error) {
    await env.QR_BUCKET.delete(objectKey);
    throw error;
  }

  const [qrVersion, channel] = await Promise.all([
    env.DB.prepare(
      `SELECT id, tenant_id, channel_id, decoded_payload_hash, source_asset_id,
              captured_at, activated_at, created_at
       FROM qr_versions WHERE id = ? AND tenant_id = ? AND channel_id = ? LIMIT 1`,
    )
      .bind(versionId, auth.tenantId, channelId)
      .first<QrVersionRow>(),
    env.DB.prepare(
      "SELECT * FROM channels WHERE id = ? AND tenant_id = ? LIMIT 1",
    )
      .bind(channelId, auth.tenantId)
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

async function createPairingCode(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const code = randomPairingCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO pairing_codes (
       id, tenant_id, user_id, code_hash, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      auth.tenantId,
      auth.userId,
      await sha256(code),
      expiresAt,
      now.toISOString(),
    )
    .run();
  return json({ pairingCode: { code, expiresAt } }, { status: 201 });
}

async function pair(request: Request, env: Env): Promise<Response> {
  const body = record(await readJson(request));
  const code = typeof body.code === "string"
    ? body.code.trim().replace(/\s+/gu, "").toUpperCase()
    : "";
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/u.test(code)) {
    throw new HttpError(
      400,
      "invalid_pairing_code",
      "Pairing code must be the 10-character code from the web dashboard",
    );
  }
  const pairing = await env.DB.prepare(
    `SELECT id, tenant_id, user_id, expires_at, consumed_at
     FROM pairing_codes WHERE code_hash = ? LIMIT 1`,
  )
    .bind(await sha256(code))
    .first<PairingRow>();
  if (
    !pairing ||
    pairing.consumed_at !== null ||
    pairing.expires_at <= new Date().toISOString()
  ) {
    throw new HttpError(410, "pairing_code_expired", "Pairing code is expired or already used");
  }
  const session = await newSession(365 * 24 * 60 * 60);
  const now = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO sessions (
           id, tenant_id, user_id, pairing_code_id, token_hash, kind,
           expires_at, created_at, last_used_at
         )
         SELECT ?, tenant_id, user_id, id, ?, 'mobile', ?, ?, ?
         FROM pairing_codes
         WHERE id = ? AND tenant_id = ? AND consumed_at IS NULL AND expires_at > ?`,
      ).bind(
        session.id,
        session.tokenHash,
        session.expiresAt,
        now,
        now,
        pairing.id,
        pairing.tenant_id,
        now,
      ),
      env.DB.prepare(
        `UPDATE pairing_codes SET consumed_at = ?
         WHERE id = ? AND tenant_id = ? AND consumed_at IS NULL AND expires_at > ?`,
      ).bind(now, pairing.id, pairing.tenant_id, now),
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new HttpError(410, "pairing_code_expired", "Pairing code is expired or already used");
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE")
    ) {
      throw new HttpError(410, "pairing_code_expired", "Pairing code is expired or already used");
    }
    throw error;
  }
  return json({ sessionToken: session.token, deployment: deployment(request, env) });
}

async function upsertDevice(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.sessionKind !== "mobile") {
    throw new HttpError(403, "mobile_session_required", "A paired mobile session is required");
  }
  const input = parseDeviceInput(await readJson(request), env);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO devices (
       id, tenant_id, user_id, platform, apns_token, apns_environment,
       notifications_enabled, created_at, updated_at
     ) VALUES (?, ?, ?, 'ios', ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, apns_token) DO UPDATE SET
       user_id = excluded.user_id,
       apns_environment = excluded.apns_environment,
       notifications_enabled = excluded.notifications_enabled,
       updated_at = excluded.updated_at
     RETURNING *`,
  )
    .bind(
      crypto.randomUUID(),
      auth.tenantId,
      auth.userId,
      input.apnsToken,
      input.environment,
      input.notificationsEnabled ? 1 : 0,
      now,
      now,
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
  const auth = await authenticate(request, env);
  const result = await env.DB.prepare(
    "DELETE FROM devices WHERE id = ? AND tenant_id = ? AND user_id = ?",
  )
    .bind(deviceId, auth.tenantId, auth.userId)
    .run();
  if (result.meta.changes !== 1) {
    throw new HttpError(404, "device_not_found", "Device was not found");
  }
  return noContent();
}

async function publicChannel(env: Env, slug: string): Promise<PublicChannelRow | null> {
  return env.DB.prepare(
    `SELECT
       c.id, c.tenant_id, c.name, c.slug, c.expires_at, c.active_qr_version_id,
       q.object_key
     FROM channels c
     LEFT JOIN qr_versions q
       ON q.id = c.active_qr_version_id
      AND q.tenant_id = c.tenant_id
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
  if (method === "POST" && pathname === `${API_PREFIX}/bootstrap`) {
    return bootstrap(request, env);
  }
  if (method === "GET" && pathname === `${API_PREFIX}/me`) {
    return me(request, env, ctx);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/auth/request-code`) {
    return requestAuthCode(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/auth/verify-code`) {
    return verifyAuthCode(request, env);
  }
  if (pathname === `${API_PREFIX}/channels`) {
    if (method === "GET") return listChannels(request, env);
    if (method === "POST") return createChannel(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/pairing-codes`) {
    return createPairingCode(request, env);
  }
  if (method === "POST" && pathname === `${API_PREFIX}/pair`) {
    return pair(request, env);
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
        return corsPreflight(request, env);
      }
      const imageMatch = /^\/q\/([^/]+)\/image$/u.exec(url.pathname);
      if (imageMatch?.[1] && request.method === "GET") {
        return publicQrImage(request, env, decodeURIComponent(imageMatch[1]));
      }
      const pageMatch = /^\/q\/([^/]+)$/u.exec(url.pathname);
      if (pageMatch?.[1] && request.method === "GET") {
        return publicQrPage(env, decodeURIComponent(pageMatch[1]));
      }
      const response = await routeApi(request, env, ctx, url.pathname);
      return withCors(response, request, env);
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
      return withCors(response, request, env);
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
