import type { Channel, QrVersion } from "@qr-lifecycle/contracts";

export interface ChannelRow {
  id: string;
  tenant_id: string;
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
  tenant_id: string;
  channel_id: string;
  decoded_payload_hash: string;
  source_asset_id: string | null;
  captured_at: string | null;
  activated_at: string;
  created_at: string;
}

export interface AuthRow {
  session_id: string;
  tenant_id: string;
  user_id: string;
  session_kind: "web" | "mobile";
  email: string;
  display_name: string;
  tenant_name: string;
  tenant_slug: string;
  role: "owner" | "member";
}

export interface PairingRow {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface DeviceRow {
  id: string;
  tenant_id: string;
  user_id: string;
  platform: "ios" | "android";
  apns_token: string;
  apns_environment: "production" | "sandbox";
  notifications_enabled: number;
  created_at: string;
  updated_at: string;
}

export function channelFromRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    tenantId: row.tenant_id,
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
    tenantId: row.tenant_id,
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
    environment: row.apns_environment,
    notificationsEnabled: row.notifications_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
