import type { Channel, QrVersion } from "@qr-lifecycle/contracts";

export interface ChannelRow {
  id: string;
  account_id: string;
  name: string;
  platform: Channel["platform"];
  slug: string;
  expires_at: string | null;
  remind_before_minutes: number;
  active_qr_version_id: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QrVersionRow {
  id: string;
  account_id: string;
  channel_id: string;
  decoded_payload_hash: string;
  source_asset_id: string | null;
  captured_at: string | null;
  activated_at: string;
  created_at: string;
}

export interface DeviceRow {
  id: string;
  account_id: string;
  device_key_hash: string;
  platform: "ios" | "android";
  display_name: string | null;
  apns_token: string | null;
  apns_environment: "production" | "sandbox" | null;
  notifications_enabled: number;
  created_at: string;
  updated_at: string;
}

export function channelFromRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    platform: row.platform,
    slug: row.slug,
    expiresAt: row.expires_at,
    remindBeforeMinutes: row.remind_before_minutes,
    activeQrVersionId: row.active_qr_version_id,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function qrVersionFromRow(row: QrVersionRow): QrVersion {
  return {
    id: row.id,
    accountId: row.account_id,
    channelId: row.channel_id,
    decodedPayloadHash: row.decoded_payload_hash,
    sourceAssetId: row.source_asset_id,
    capturedAt: row.captured_at,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
  };
}

export function deviceFromRow(row: DeviceRow): {
  id: string;
  platform: "ios" | "android";
  environment: "production" | "sandbox";
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    platform: row.platform,
    environment: row.apns_environment ?? "production",
    notificationsEnabled: row.notifications_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
