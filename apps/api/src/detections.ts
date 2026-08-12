import {
  acceptInboxItemSchema,
  detectedCommunityQrSchema,
  type AcceptInboxItemInput,
  type Channel,
  type ChannelPlatform,
  type CommitDetectionResponse,
  type DetectedCommunityQr,
  type Detection,
  type DetectionAction,
  type DetectionDecision,
  type FieldConfidences,
  type InboxItem,
  type OcrLine,
  type QrVersion,
} from "@qr-lifecycle/contracts";

import { authenticate } from "./auth";
import { randomToken, sha256 } from "./crypto";
import { HttpError, json, readJson } from "./http";
import {
  channelFromRow,
  qrVersionFromRow,
  type ChannelRow,
  type QrVersionRow,
} from "./models";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/heic", "image/heif"]);

interface DetectionRow {
  id: string;
  account_id: string;
  client_detection_id: string;
  asset_id: string;
  captured_at: string | null;
  creation_time: number | null;
  decoded_payload_hash: string;
  ocr_lines_json: string;
  platform: ChannelPlatform | null;
  detected_name: string | null;
  detected_expires_at: string | null;
  expiry_source: DetectedCommunityQr["expirySource"];
  field_confidences_json: string;
  suggested_channel_id: string | null;
  match_confidence: number;
  status: Detection["status"];
  action: DetectionAction;
  decision_confidence: number;
  decision_reason: string;
  channel_id: string | null;
  qr_version_id: string | null;
  pending_object_key: string | null;
  pending_content_type: string | null;
  pending_byte_size: number | null;
  previous_channel_name: string | null;
  previous_channel_platform: ChannelPlatform | null;
  previous_channel_expires_at: string | null;
  previous_active_qr_version_id: string | null;
  previous_disabled_at: string | null;
  created_channel: number;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  undone_at: string | null;
}

interface PendingImage {
  objectKey: string;
  contentType: string;
  byteSize: number;
}

interface MatchResult {
  channel: ChannelRow | null;
  confidence: number;
  reason: string;
}

interface DetectionCommitResult {
  row: DetectionRow;
  deleteObjectKey: string | null;
}

function parseJsonColumn<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function detectionFromRow(row: DetectionRow): Detection {
  return {
    id: row.id,
    accountId: row.account_id,
    clientDetectionId: row.client_detection_id,
    assetId: row.asset_id,
    capturedAt: row.captured_at,
    creationTime: row.creation_time,
    ocrLines: parseJsonColumn<OcrLine[]>(row.ocr_lines_json, []),
    platform: row.platform,
    name: row.detected_name,
    expiresAt: row.detected_expires_at,
    expirySource: row.expiry_source,
    fieldConfidences: parseJsonColumn<FieldConfidences>(
      row.field_confidences_json,
      { platform: 0, name: 0, expiresAt: 0 },
    ),
    suggestedChannelId: row.suggested_channel_id,
    matchConfidence: row.match_confidence,
    status: row.status,
    action: row.action,
    reason: row.decision_reason,
    channelId: row.channel_id,
    qrVersionId: row.qr_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    undoneAt: row.undone_at,
  };
}

function decisionFromRow(row: DetectionRow): DetectionDecision {
  return {
    action: row.action,
    automatic:
      row.action === "auto_create" ||
      row.action === "auto_update",
    confidence: row.decision_confidence,
    reason: row.decision_reason,
    channelId: row.channel_id,
    qrVersionId: row.qr_version_id,
  };
}

function invalidSchema(issues: readonly { message: string }[]): never {
  throw new HttpError(400, "invalid_input", issues[0]?.message ?? "Input is invalid");
}

async function detectionById(
  env: Env,
  accountId: string,
  detectionId: string,
): Promise<DetectionRow | null> {
  return env.DB.prepare(
    "SELECT * FROM detections WHERE id = ? AND account_id = ? LIMIT 1",
  )
    .bind(detectionId, accountId)
    .first<DetectionRow>();
}

async function channelRowById(
  env: Env,
  accountId: string,
  channelId: string | null,
): Promise<ChannelRow | null> {
  if (!channelId) return null;
  return env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? AND account_id = ? LIMIT 1",
  )
    .bind(channelId, accountId)
    .first<ChannelRow>();
}

async function qrVersionRowById(
  env: Env,
  accountId: string,
  versionId: string | null,
): Promise<QrVersionRow | null> {
  if (!versionId) return null;
  return env.DB.prepare(
    `SELECT id, account_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions WHERE id = ? AND account_id = ? LIMIT 1`,
  )
    .bind(versionId, accountId)
    .first<QrVersionRow>();
}

async function responseForRow(env: Env, row: DetectionRow): Promise<Response> {
  const [channel, qrVersion] = await Promise.all([
    channelRowById(env, row.account_id, row.channel_id),
    qrVersionRowById(env, row.account_id, row.qr_version_id),
  ]);
  const body: CommitDetectionResponse = {
    detection: detectionFromRow(row),
    decision: decisionFromRow(row),
    channel: channel ? channelFromRow(channel) : null,
    qrVersion: qrVersion ? qrVersionFromRow(qrVersion) : null,
  };
  return json(body);
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 240);
}

function platformSlug(platform: ChannelPlatform): string {
  switch (platform) {
    case "wechat_group":
      return "wechat";
    case "xiaohongshu_group":
      return "xiaohongshu";
    case "discord":
      return "discord";
    default:
      return "group";
  }
}

async function generatedSlug(
  env: Env,
  name: string,
  platform: ChannelPlatform,
): Promise<string> {
  const latin = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 44);
  const stem = latin.length >= 2 ? latin : platformSlug(platform);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = randomToken(6).toLocaleLowerCase().replaceAll("_", "-");
    const slug = `${stem}-${suffix}`.slice(0, 64).replace(/-$/u, "x");
    const existing = await env.DB.prepare(
      "SELECT id FROM channels WHERE slug = ? LIMIT 1",
    )
      .bind(slug)
      .first<{ id: string }>();
    if (!existing) return slug;
  }
  throw new HttpError(409, "slug_conflict", "Could not allocate a public slug");
}

function createChannelRow(
  accountId: string,
  input: { name: string; platform: ChannelPlatform; expiresAt: string | null },
  slug: string,
  now: string,
): ChannelRow {
  return {
    id: crypto.randomUUID(),
    account_id: accountId,
    name: input.name,
    platform: input.platform,
    slug,
    expires_at: input.expiresAt,
    remind_before_minutes: 1_440,
    active_qr_version_id: null,
    disabled_at: null,
    created_at: now,
    updated_at: now,
  };
}

function parseDetectionMetadata(rawMetadata: unknown): DetectedCommunityQr {
  if (typeof rawMetadata === "string" && rawMetadata.length > 256 * 1024) {
    throw new HttpError(413, "metadata_too_large", "Detection metadata is too large");
  }
  let value = rawMetadata;
  if (typeof rawMetadata === "string") {
    if (rawMetadata.length === 0) {
      throw new HttpError(400, "metadata_required", "Structured detection metadata is required");
    }
    try {
      value = JSON.parse(rawMetadata);
    } catch {
      throw new HttpError(400, "invalid_metadata", "Detection metadata is not valid JSON");
    }
  }
  const parsed = detectedCommunityQrSchema.safeParse(value);
  if (!parsed.success) invalidSchema(parsed.error.issues);
  return parsed.data;
}

function parseImage(value: FormDataEntryValue | null): File {
  if (!(value instanceof File)) {
    throw new HttpError(400, "image_required", "A QR image is required");
  }
  const contentType = value.type.toLocaleLowerCase();
  if (!IMAGE_TYPES.has(contentType)) {
    throw new HttpError(415, "unsupported_image_type", "Use PNG, JPEG, or HEIC");
  }
  if (value.size <= 0 || value.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "image_too_large", "QR image must not exceed 10 MiB");
  }
  return value;
}

function parseCommitForm(form: FormData): {
  input: DetectedCommunityQr;
  image: File;
} {
  const rawMetadata = form.get("metadata");
  if (rawMetadata === null) {
    throw new HttpError(400, "metadata_required", "Structured detection metadata is required");
  }
  return {
    input: parseDetectionMetadata(rawMetadata),
    image: parseImage(form.get("image")),
  };
}

async function readCommitRequest(request: Request): Promise<{
  input: DetectedCommunityQr;
  image: File | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLocaleLowerCase().startsWith("application/json")) {
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const byteLength = Number(contentLength);
      if (!Number.isFinite(byteLength) || byteLength > 256 * 1024) {
        throw new HttpError(413, "metadata_too_large", "Detection metadata is too large");
      }
    }
    return { input: parseDetectionMetadata(await readJson(request)), image: null };
  }
  if (!contentType.toLocaleLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Expected JSON or multipart form data");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const byteLength = Number(contentLength);
    if (!Number.isFinite(byteLength) || byteLength > MAX_MULTIPART_BYTES) {
      throw new HttpError(413, "image_too_large", "QR image must not exceed 10 MiB");
    }
  }
  try {
    return parseCommitForm(await request.formData());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_upload", "Multipart body could not be parsed");
  }
}

async function matchChannel(
  env: Env,
  accountId: string,
  input: DetectedCommunityQr,
): Promise<MatchResult> {
  const channels = await env.DB.prepare(
    `SELECT * FROM channels
     WHERE account_id = ? AND disabled_at IS NULL
     ORDER BY updated_at DESC LIMIT 1000`,
  )
    .bind(accountId)
    .all<ChannelRow>();
  const channelMap = new Map(channels.results.map((channel) => [channel.id, channel]));
  const normalized = input.name ? normalizeName(input.name) : "";

  if (input.suggestedChannelId) {
    const suggested = channelMap.get(input.suggestedChannelId) ?? null;
    if (suggested) {
      const aliasRows = normalized
        ? await env.DB.prepare(
            `SELECT 1 AS matched FROM channel_aliases
             WHERE account_id = ? AND channel_id = ? AND normalized_name = ? LIMIT 1`,
          )
            .bind(accountId, suggested.id, normalized)
            .all<{ matched: number }>()
        : { results: [] };
      const nameMatches =
        normalized.length > 0 &&
        (normalizeName(suggested.name) === normalized || aliasRows.results.length === 1);
      const platformMatches = !input.platform || input.platform === suggested.platform;
      if (nameMatches && platformMatches) {
        return {
          channel: suggested,
          confidence: Math.min(
            input.matchConfidence,
            input.fieldConfidences.name,
            0.98,
          ),
          reason: "Verified the device suggestion using a account-local name or alias",
        };
      }
      return {
        channel: suggested,
        confidence: 0,
        reason:
          "The device suggestion conflicts with the account-local channel identity",
      };
    }
  }

  if (!normalized) {
    return {
      channel: null,
      confidence: 0,
      reason: "No reliable channel name was detected",
    };
  }
  const aliasRows = await env.DB.prepare(
    `SELECT channel_id FROM channel_aliases
     WHERE account_id = ? AND normalized_name = ?`,
  )
    .bind(accountId, normalized)
    .all<{ channel_id: string }>();
  const matchingIds = new Set(
    aliasRows.results
      .map((alias) => alias.channel_id)
      .filter((id) => channelMap.has(id)),
  );
  for (const channel of channels.results) {
    if (normalizeName(channel.name) === normalized) matchingIds.add(channel.id);
  }
  if (matchingIds.size !== 1) {
    return {
      channel: null,
      confidence: 0,
      reason:
        matchingIds.size > 1
          ? "The detected name matches multiple channels"
          : "No account-local channel name or alias matched",
    };
  }
  const channelId = matchingIds.values().next().value as string | undefined;
  const channel = channelId ? channelMap.get(channelId) ?? null : null;
  if (channel && input.platform && channel.platform !== input.platform) {
    return {
      channel,
      confidence: 0,
      reason: "The detected platform conflicts with the matched channel",
    };
  }
  return {
    channel,
    confidence: Math.min(0.98, input.fieldConfidences.name),
    reason: "Matched one account-local normalized channel name or alias",
  };
}

function insertAliasStatement(
  env: Env,
  accountId: string,
  channelId: string,
  displayName: string | null,
  now: string,
): D1PreparedStatement | null {
  if (!displayName) return null;
  const normalized = normalizeName(displayName);
  if (!normalized) return null;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO channel_aliases (
       id, account_id, channel_id, normalized_name, display_name, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), accountId, channelId, normalized, displayName, now);
}

function insertDetectionStatement(env: Env, row: DetectionRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO detections (
       id, account_id, client_detection_id, asset_id, captured_at, creation_time,
       decoded_payload_hash, ocr_lines_json, platform, detected_name,
       detected_expires_at, expiry_source, field_confidences_json,
       suggested_channel_id, match_confidence, status, action,
       decision_confidence, decision_reason, channel_id, qr_version_id,
       pending_object_key, pending_content_type, pending_byte_size,
       previous_channel_name, previous_channel_platform,
       previous_channel_expires_at, previous_active_qr_version_id,
       previous_disabled_at, created_channel, created_at, updated_at,
       decided_at, undone_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       asset_id = excluded.asset_id,
       captured_at = excluded.captured_at,
       creation_time = excluded.creation_time,
       ocr_lines_json = excluded.ocr_lines_json,
       platform = excluded.platform,
       detected_name = excluded.detected_name,
       detected_expires_at = excluded.detected_expires_at,
       expiry_source = excluded.expiry_source,
       field_confidences_json = excluded.field_confidences_json,
       suggested_channel_id = excluded.suggested_channel_id,
       match_confidence = excluded.match_confidence,
       status = excluded.status,
       action = excluded.action,
       decision_confidence = excluded.decision_confidence,
       decision_reason = excluded.decision_reason,
       channel_id = excluded.channel_id,
       qr_version_id = excluded.qr_version_id,
       pending_object_key = excluded.pending_object_key,
       pending_content_type = excluded.pending_content_type,
       pending_byte_size = excluded.pending_byte_size,
       previous_channel_name = excluded.previous_channel_name,
       previous_channel_platform = excluded.previous_channel_platform,
       previous_channel_expires_at = excluded.previous_channel_expires_at,
       previous_active_qr_version_id = excluded.previous_active_qr_version_id,
       previous_disabled_at = excluded.previous_disabled_at,
       created_channel = excluded.created_channel,
       updated_at = excluded.updated_at,
       decided_at = excluded.decided_at,
       undone_at = excluded.undone_at`,
  ).bind(
    row.id,
    row.account_id,
    row.client_detection_id,
    row.asset_id,
    row.captured_at,
    row.creation_time,
    row.decoded_payload_hash,
    row.ocr_lines_json,
    row.platform,
    row.detected_name,
    row.detected_expires_at,
    row.expiry_source,
    row.field_confidences_json,
    row.suggested_channel_id,
    row.match_confidence,
    row.status,
    row.action,
    row.decision_confidence,
    row.decision_reason,
    row.channel_id,
    row.qr_version_id,
    row.pending_object_key,
    row.pending_content_type,
    row.pending_byte_size,
    row.previous_channel_name,
    row.previous_channel_platform,
    row.previous_channel_expires_at,
    row.previous_active_qr_version_id,
    row.previous_disabled_at,
    row.created_channel,
    row.created_at,
    row.updated_at,
    row.decided_at,
    row.undone_at,
  );
}

function baseDetectionRow(
  accountId: string,
  input: DetectedCommunityQr,
  decodedPayloadHash: string,
  image: PendingImage | null,
  match: MatchResult,
  now: string,
): DetectionRow {
  return {
    id: crypto.randomUUID(),
    account_id: accountId,
    client_detection_id: input.clientDetectionId,
    asset_id: input.assetId,
    captured_at: input.capturedAt,
    creation_time: input.creationTime,
    decoded_payload_hash: decodedPayloadHash,
    ocr_lines_json: JSON.stringify(input.ocrLines),
    platform: input.platform,
    detected_name: input.name,
    detected_expires_at: input.expiresAt,
    expiry_source: input.expirySource,
    field_confidences_json: JSON.stringify(input.fieldConfidences),
    suggested_channel_id: match.channel?.id ?? null,
    match_confidence: match.confidence,
    status: "needs_review",
    action: "needs_review",
    decision_confidence: match.confidence,
    decision_reason: match.reason,
    channel_id: null,
    qr_version_id: null,
    pending_object_key: image?.objectKey ?? null,
    pending_content_type: image?.contentType ?? null,
    pending_byte_size: image?.byteSize ?? null,
    previous_channel_name: null,
    previous_channel_platform: null,
    previous_channel_expires_at: null,
    previous_active_qr_version_id: null,
    previous_disabled_at: null,
    created_channel: 0,
    created_at: now,
    updated_at: now,
    decided_at: null,
    undone_at: null,
  };
}

function qrVersionRow(
  row: DetectionRow,
  channelId: string,
  now: string,
): QrVersionRow & {
  object_key: string;
  content_type: string;
  byte_size: number;
} {
  if (!row.pending_object_key || !row.pending_content_type || !row.pending_byte_size) {
    throw new Error("Detection has no pending image");
  }
  return {
    id: crypto.randomUUID(),
    account_id: row.account_id,
    channel_id: channelId,
    object_key: row.pending_object_key,
    content_type: row.pending_content_type,
    byte_size: row.pending_byte_size,
    decoded_payload_hash: row.decoded_payload_hash,
    source_asset_id: row.asset_id,
    captured_at: row.captured_at,
    activated_at: now,
    created_at: now,
  };
}

function insertQrVersionStatement(
  env: Env,
  version: ReturnType<typeof qrVersionRow>,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO qr_versions (
       id, account_id, channel_id, object_key, content_type, byte_size,
       decoded_payload_hash, source_asset_id, captured_at, activated_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    version.id,
    version.account_id,
    version.channel_id,
    version.object_key,
    version.content_type,
    version.byte_size,
    version.decoded_payload_hash,
    version.source_asset_id,
    version.captured_at,
    version.activated_at,
    version.created_at,
  );
}

async function existingQrVersion(
  env: Env,
  row: DetectionRow,
  channelId: string,
): Promise<QrVersionRow | null> {
  return env.DB.prepare(
    `SELECT id, account_id, channel_id, decoded_payload_hash, source_asset_id,
            captured_at, activated_at, created_at
     FROM qr_versions
     WHERE account_id = ? AND channel_id = ? AND decoded_payload_hash = ?
     LIMIT 1`,
  )
    .bind(row.account_id, channelId, row.decoded_payload_hash)
    .first<QrVersionRow>();
}

function channelFieldUpdates(
  row: DetectionRow,
  channel: ChannelRow,
): { name: string; platform: ChannelPlatform; expiresAt: string | null } {
  const confidences = parseJsonColumn<FieldConfidences>(row.field_confidences_json, {
    platform: 0,
    name: 0,
    expiresAt: 0,
  });
  return {
    name:
      row.detected_name && confidences.name >= 0.9
        ? row.detected_name
        : channel.name,
    platform:
      row.platform && confidences.platform >= 0.9
        ? row.platform
        : channel.platform,
    expiresAt:
      confidences.expiresAt >= 0.65
        ? row.detected_expires_at
        : channel.expires_at,
  };
}

async function commitCreate(
  env: Env,
  row: DetectionRow,
  input: { name: string; platform: ChannelPlatform; expiresAt: string | null },
  action: "accepted_create",
  confidence: number,
  reason: string,
): Promise<DetectionCommitResult> {
  const now = new Date().toISOString();
  const slug = await generatedSlug(env, input.name, input.platform);
  const channel = createChannelRow(row.account_id, input, slug, now);
  const version = qrVersionRow(row, channel.id, now);
  row.status = "committed";
  row.action = action;
  row.decision_confidence = confidence;
  row.decision_reason = reason;
  row.channel_id = channel.id;
  row.qr_version_id = version.id;
  row.created_channel = 1;
  row.updated_at = now;
  row.decided_at = now;

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO channels (
         id, account_id, name, platform, slug, expires_at, remind_before_minutes,
         active_qr_version_id, disabled_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).bind(
      channel.id,
      channel.account_id,
      channel.name,
      channel.platform,
      channel.slug,
      channel.expires_at,
      channel.remind_before_minutes,
      channel.created_at,
      channel.updated_at,
    ),
    insertQrVersionStatement(env, version),
    env.DB.prepare(
      `UPDATE channels SET active_qr_version_id = ?, updated_at = ?
       WHERE id = ? AND account_id = ?`,
    ).bind(version.id, now, channel.id, row.account_id),
  ];
  const alias = insertAliasStatement(env, row.account_id, channel.id, input.name, now);
  if (alias) statements.push(alias);
  statements.push(insertDetectionStatement(env, row));
  await env.DB.batch(statements);
    return { row, deleteObjectKey: null };
}

async function commitUpdate(
  env: Env,
  row: DetectionRow,
  channel: ChannelRow,
  action: "accepted_update",
  confidence: number,
  reason: string,
): Promise<DetectionCommitResult> {
  const now = new Date().toISOString();
  const existing = await existingQrVersion(env, row, channel.id);
  row.previous_channel_name = channel.name;
  row.previous_channel_platform = channel.platform;
  row.previous_channel_expires_at = channel.expires_at;
  row.previous_active_qr_version_id = channel.active_qr_version_id;
  row.previous_disabled_at = channel.disabled_at;
  row.channel_id = channel.id;
  row.status = "committed";
  row.updated_at = now;
  row.decided_at = now;

  if (existing) {
    const deleteObjectKey = row.pending_object_key;
    row.action = "duplicate";
    row.decision_confidence = confidence;
    row.decision_reason = "This channel already has the same QR payload";
    row.qr_version_id = existing.id;
    row.pending_object_key = null;
    row.pending_content_type = null;
    row.pending_byte_size = null;
    await insertDetectionStatement(env, row).run();
    return { row, deleteObjectKey };
  }

  const version = qrVersionRow(row, channel.id, now);
  const updates = channelFieldUpdates(row, channel);
  row.action = action;
  row.decision_confidence = confidence;
  row.decision_reason = reason;
  row.qr_version_id = version.id;
  const statements: D1PreparedStatement[] = [
    insertQrVersionStatement(env, version),
    env.DB.prepare(
      `UPDATE channels SET
         name = ?, platform = ?, expires_at = ?, active_qr_version_id = ?,
         disabled_at = NULL, updated_at = ?
       WHERE id = ? AND account_id = ?`,
    ).bind(
      updates.name,
      updates.platform,
      updates.expiresAt,
      version.id,
      now,
      channel.id,
      row.account_id,
    ),
  ];
  const alias = insertAliasStatement(
    env,
    row.account_id,
    channel.id,
    row.detected_name,
    now,
  );
  if (alias) statements.push(alias);
  statements.push(insertDetectionStatement(env, row));
  await env.DB.batch(statements);
  return { row, deleteObjectKey: null };
}

async function saveReview(
  env: Env,
  row: DetectionRow,
  confidence: number,
  reason: string,
): Promise<DetectionCommitResult> {
  row.decision_confidence = confidence;
  row.decision_reason = reason;
  await insertDetectionStatement(env, row).run();
  return { row, deleteObjectKey: null };
}

export async function commitDetection(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await authenticate(request, env, "mobile");
  const { input } = await readCommitRequest(request);
  const existing = await env.DB.prepare(
    `SELECT * FROM detections
     WHERE account_id = ? AND client_detection_id = ? LIMIT 1`,
  )
    .bind(auth.accountId, input.clientDetectionId)
    .first<DetectionRow>();
  if (existing) return responseForRow(env, existing);

  const now = new Date().toISOString();
  const detectionId = crypto.randomUUID();
  const match = await matchChannel(env, auth.accountId, input);
  const decodedPayloadHash = await sha256(`${auth.accountId}${input.decodedPayload}`);

  const row = baseDetectionRow(
    auth.accountId,
    input,
    decodedPayloadHash,
    null,
    match,
    now,
  );
  row.id = detectionId;
  const identityConfidence = input.name && input.platform
    ? Math.min(input.fieldConfidences.name, input.fieldConfidences.platform)
    : match.confidence;
  try {
    const result = await saveReview(
      env,
      row,
      identityConfidence,
      `${match.reason}; user confirmation is required and the original image remains on-device`,
    );
    return responseForRow(env, result.row);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      const raced = await env.DB.prepare(
        `SELECT * FROM detections
         WHERE account_id = ? AND client_detection_id = ? LIMIT 1`,
      )
        .bind(auth.accountId, input.clientDetectionId)
        .first<DetectionRow>();
      if (raced) return responseForRow(env, raced);
    }
    throw error;
  }
}

export async function listInbox(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const result = await env.DB.prepare(
    `SELECT * FROM detections
     WHERE account_id = ? AND status = 'needs_review'
     ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(auth.accountId)
    .all<DetectionRow>();
  const channels = await env.DB.prepare(
    "SELECT * FROM channels WHERE account_id = ?",
  )
    .bind(auth.accountId)
    .all<ChannelRow>();
  const channelMap = new Map(
    channels.results.map((channel) => [channel.id, channelFromRow(channel)]),
  );
  const items: InboxItem[] = result.results.map((row) => ({
    detection: detectionFromRow(row),
    suggestedChannel: row.suggested_channel_id
      ? channelMap.get(row.suggested_channel_id) ?? null
      : null,
  }));
  return json({ items });
}

function parseAcceptValue(value: unknown): AcceptInboxItemInput {
  const parsed = acceptInboxItemSchema.safeParse(value);
  if (!parsed.success) invalidSchema(parsed.error.issues);
  return parsed.data;
}

async function readAcceptRequest(request: Request): Promise<{
  input: AcceptInboxItemInput;
  image: File | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLocaleLowerCase().startsWith("application/json")) {
    return { input: parseAcceptValue(await readJson(request)), image: null };
  }
  if (!contentType.toLocaleLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Expected JSON or multipart form data");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const byteLength = Number(contentLength);
    if (!Number.isFinite(byteLength) || byteLength > MAX_MULTIPART_BYTES) {
      throw new HttpError(413, "image_too_large", "QR image must not exceed 10 MiB");
    }
  }
  try {
    const form = await request.formData();
    const rawInput = form.get("input");
    let inputValue: unknown = {};
    if (typeof rawInput === "string" && rawInput.length > 0) {
      if (rawInput.length > 64 * 1024) {
        throw new HttpError(413, "input_too_large", "Confirmation input is too large");
      }
      try {
        inputValue = JSON.parse(rawInput);
      } catch {
        throw new HttpError(400, "invalid_input", "Confirmation input is not valid JSON");
      }
    }
    return {
      input: parseAcceptValue(inputValue),
      image: parseImage(form.get("image")),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_upload", "Multipart body could not be parsed");
  }
}

export async function acceptInboxItem(
  request: Request,
  env: Env,
  detectionId: string,
): Promise<Response> {
  const auth = await authenticate(request, env);
  const row = await detectionById(env, auth.accountId, detectionId);
  if (!row) throw new HttpError(404, "detection_not_found", "Detection was not found");
  if (row.status === "committed") return responseForRow(env, row);
  if (row.status !== "needs_review") {
    throw new HttpError(409, "detection_not_reviewable", "Detection can no longer be accepted");
  }
  const { input, image } = await readAcceptRequest(request);
  let uploadedObjectKey: string | null = null;
  if (image) {
    uploadedObjectKey = `accounts/${auth.accountId}/detections/${row.id}`;
    const contentType = image.type.toLocaleLowerCase();
    await env.QR_BUCKET.put(uploadedObjectKey, image, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        accountId: auth.accountId,
        detectionId: row.id,
        source: "confirmed-on-device",
      },
    });
    row.pending_object_key = uploadedObjectKey;
    row.pending_content_type = contentType;
    row.pending_byte_size = image.size;
  }
  if (!row.pending_object_key || !row.pending_content_type || !row.pending_byte_size) {
    if (uploadedObjectKey) await env.QR_BUCKET.delete(uploadedObjectKey);
    throw new HttpError(
      400,
      "image_required",
      "The original QR image is required when confirming this detection",
    );
  }

  let result: DetectionCommitResult;
  const channelId = input.createNew
    ? null
    : input.channelId ?? row.suggested_channel_id;
  if (channelId) {
    const channel = await channelRowById(env, auth.accountId, channelId);
    if (!channel || channel.disabled_at) {
      if (uploadedObjectKey) await env.QR_BUCKET.delete(uploadedObjectKey);
      throw new HttpError(404, "channel_not_found", "Channel was not found");
    }
    if (input.name !== undefined) row.detected_name = input.name;
    if (input.platform !== undefined) row.platform = input.platform;
    if (input.expiresAt !== undefined) row.detected_expires_at = input.expiresAt;
    if (
      input.name !== undefined ||
      input.platform !== undefined ||
      input.expiresAt !== undefined
    ) {
      const confidences = parseJsonColumn<FieldConfidences>(
        row.field_confidences_json,
        { platform: 0, name: 0, expiresAt: 0 },
      );
      row.field_confidences_json = JSON.stringify({
        platform: input.platform !== undefined ? 1 : confidences.platform,
        name: input.name !== undefined ? 1 : confidences.name,
        expiresAt: input.expiresAt !== undefined ? 1 : confidences.expiresAt,
      } satisfies FieldConfidences);
    }
    try {
      result = await commitUpdate(
        env,
        row,
        channel,
        "accepted_update",
        1,
        "The user confirmed the target channel",
      );
    } catch (error) {
      if (uploadedObjectKey) await env.QR_BUCKET.delete(uploadedObjectKey);
      throw error;
    }
  } else {
    const name = input.name ?? row.detected_name;
    const platform = input.platform ?? row.platform;
    const expiresAt = input.expiresAt !== undefined
      ? input.expiresAt
      : row.detected_expires_at;
    if (!name || !platform) {
      if (uploadedObjectKey) await env.QR_BUCKET.delete(uploadedObjectKey);
      throw new HttpError(
        400,
        "channel_identity_required",
        "A channel name and platform are required",
      );
    }
    row.detected_name = name;
    row.platform = platform;
    row.detected_expires_at = expiresAt;
    try {
      result = await commitCreate(
        env,
        row,
        { name, platform, expiresAt },
        "accepted_create",
        1,
        "The user confirmed creation of a new channel",
      );
    } catch (error) {
      if (uploadedObjectKey) await env.QR_BUCKET.delete(uploadedObjectKey);
      throw error;
    }
  }
  if (result.deleteObjectKey) await env.QR_BUCKET.delete(result.deleteObjectKey);
  return responseForRow(env, result.row);
}

export async function ignoreInboxItem(
  request: Request,
  env: Env,
  detectionId: string,
): Promise<Response> {
  const auth = await authenticate(request, env);
  const row = await detectionById(env, auth.accountId, detectionId);
  if (!row) throw new HttpError(404, "detection_not_found", "Detection was not found");
  if (row.status === "ignored") return json({ detection: detectionFromRow(row) });
  if (row.status !== "needs_review") {
    throw new HttpError(409, "detection_not_reviewable", "Detection can no longer be ignored");
  }
  const objectKey = row.pending_object_key;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE detections SET
       status = 'ignored', action = 'ignore', decision_reason = ?,
       pending_object_key = NULL, pending_content_type = NULL,
       pending_byte_size = NULL, updated_at = ?, decided_at = ?
     WHERE id = ? AND account_id = ? AND status = 'needs_review'`,
  )
    .bind("The user ignored this detection", now, now, row.id, auth.accountId)
    .run();
  if (objectKey) await env.QR_BUCKET.delete(objectKey);
  const updated = await detectionById(env, auth.accountId, row.id);
  if (!updated) throw new Error("Ignored detection disappeared");
  return json({ detection: detectionFromRow(updated) });
}

export async function undoDetection(
  request: Request,
  env: Env,
  detectionId: string,
): Promise<Response> {
  const auth = await authenticate(request, env);
  const row = await detectionById(env, auth.accountId, detectionId);
  if (!row) throw new HttpError(404, "detection_not_found", "Detection was not found");
  if (row.status === "undone") {
    const channel = await channelRowById(env, auth.accountId, row.channel_id);
    return json({
      detection: detectionFromRow(row),
      channel: channel ? channelFromRow(channel) : null,
    });
  }
  if (row.status !== "committed") {
    throw new HttpError(409, "detection_not_undoable", "Detection has no committed change to undo");
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let channel: ChannelRow | null = null;
  if (row.channel_id) {
    channel = await channelRowById(env, auth.accountId, row.channel_id);
  }
  if (row.action !== "duplicate") {
    if (!channel) {
      throw new HttpError(409, "undo_conflict", "The affected channel no longer exists");
    }
    if (channel.active_qr_version_id !== row.qr_version_id) {
      throw new HttpError(
        409,
        "undo_conflict",
        "A newer QR version is active; undo that update first",
      );
    }
    if (row.created_channel === 1) {
      statements.push(
        env.DB.prepare(
          `UPDATE channels SET disabled_at = ?, updated_at = ?
           WHERE id = ? AND account_id = ? AND active_qr_version_id = ?`,
        ).bind(now, now, channel.id, auth.accountId, row.qr_version_id),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `UPDATE channels SET
             name = ?, platform = ?, expires_at = ?, active_qr_version_id = ?,
             disabled_at = ?, updated_at = ?
           WHERE id = ? AND account_id = ? AND active_qr_version_id = ?`,
        ).bind(
          row.previous_channel_name,
          row.previous_channel_platform,
          row.previous_channel_expires_at,
          row.previous_active_qr_version_id,
          row.previous_disabled_at,
          now,
          channel.id,
          auth.accountId,
          row.qr_version_id,
        ),
      );
    }
  }
  statements.push(
    env.DB.prepare(
      `UPDATE detections SET
         status = 'undone', action = 'undo', decision_reason = ?,
         updated_at = ?, undone_at = ?
       WHERE id = ? AND account_id = ? AND status = 'committed'`,
    ).bind("The committed detection was undone", now, now, row.id, auth.accountId),
  );
  const results = await env.DB.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) {
    throw new HttpError(409, "undo_conflict", "Detection was changed concurrently");
  }
  const [updated, updatedChannel] = await Promise.all([
    detectionById(env, auth.accountId, row.id),
    channelRowById(env, auth.accountId, row.channel_id),
  ]);
  if (!updated) throw new Error("Undone detection disappeared");
  return json({
    detection: detectionFromRow(updated),
    channel: updatedChannel ? channelFromRow(updatedChannel) : null,
  });
}
