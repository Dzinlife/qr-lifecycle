PRAGMA foreign_keys = ON;

-- QR Lifecycle is now one official service. Remove the self-hosted workspace
-- identity graph and rebuild private data around a hidden mobile account.
DROP TABLE reminder_deliveries;
DROP TABLE detections;
DROP TABLE channel_aliases;
DROP TABLE qr_versions;
DROP TABLE devices;
DROP TABLE sessions;
DROP TABLE pairing_codes;
DROP TABLE memberships;
DROP TABLE channels;
DROP TABLE users;
DROP TABLE tenants;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (
    provider IN ('apple_app_transaction', 'development_installation')
  ),
  subject_hash TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (
    environment IN ('Production', 'Sandbox', 'Xcode', 'Development')
  ),
  created_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX account_identities_account_idx
  ON account_identities (account_id, provider);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_key_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  display_name TEXT,
  apns_token TEXT,
  apns_environment TEXT CHECK (
    apns_environment IS NULL OR apns_environment IN ('production', 'sandbox')
  ),
  notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (
    notifications_enabled IN (0, 1)
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX devices_apns_token_idx
  ON devices (apns_token) WHERE apns_token IS NOT NULL;
CREATE INDEX devices_account_enabled_idx
  ON devices (account_id, notifications_enabled);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'mobile')),
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX sessions_account_kind_idx
  ON sessions (account_id, kind, revoked_at, expires_at);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at, revoked_at);

CREATE TABLE web_bindings (
  id TEXT PRIMARY KEY,
  browser_secret_hash TEXT NOT NULL UNIQUE,
  challenge_hash TEXT NOT NULL,
  account_id TEXT,
  approved_by_device_id TEXT,
  requested_user_agent TEXT,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by_device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE INDEX web_bindings_pending_idx
  ON web_bindings (expires_at, approved_at, consumed_at);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (
    platform IN ('wechat_group', 'xiaohongshu_group', 'discord', 'other')
  ),
  slug TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  remind_before_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (
    remind_before_minutes BETWEEN 0 AND 43200
  ),
  active_qr_version_id TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX channels_account_updated_idx ON channels (account_id, updated_at DESC);
CREATE INDEX channels_reminders_idx ON channels (disabled_at, expires_at);

CREATE TABLE qr_versions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  decoded_payload_hash TEXT NOT NULL,
  source_asset_id TEXT,
  captured_at TEXT,
  activated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  UNIQUE (account_id, channel_id, decoded_payload_hash)
);

CREATE INDEX qr_versions_account_channel_idx
  ON qr_versions (account_id, channel_id, created_at DESC);

CREATE TABLE channel_aliases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  UNIQUE (account_id, channel_id, normalized_name)
);

CREATE INDEX channel_aliases_account_name_idx
  ON channel_aliases (account_id, normalized_name);

CREATE TABLE detections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_detection_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  captured_at TEXT,
  creation_time INTEGER,
  decoded_payload_hash TEXT NOT NULL,
  ocr_lines_json TEXT NOT NULL,
  platform TEXT CHECK (
    platform IS NULL OR
    platform IN ('wechat_group', 'xiaohongshu_group', 'discord', 'other')
  ),
  detected_name TEXT,
  detected_expires_at TEXT,
  expiry_source TEXT NOT NULL CHECK (
    expiry_source IN ('explicit', 'relative', 'platform_default', 'unknown')
  ),
  field_confidences_json TEXT NOT NULL,
  suggested_channel_id TEXT,
  match_confidence REAL NOT NULL CHECK (
    match_confidence >= 0 AND match_confidence <= 1
  ),
  status TEXT NOT NULL CHECK (
    status IN ('needs_review', 'committed', 'ignored', 'undone')
  ),
  action TEXT NOT NULL CHECK (
    action IN (
      'auto_create', 'auto_update', 'duplicate', 'needs_review', 'accepted_create',
      'accepted_update', 'ignore', 'undo'
    )
  ),
  decision_confidence REAL NOT NULL CHECK (
    decision_confidence >= 0 AND decision_confidence <= 1
  ),
  decision_reason TEXT NOT NULL,
  channel_id TEXT,
  qr_version_id TEXT,
  pending_object_key TEXT,
  pending_content_type TEXT,
  pending_byte_size INTEGER,
  previous_channel_name TEXT,
  previous_channel_platform TEXT,
  previous_channel_expires_at TEXT,
  previous_active_qr_version_id TEXT,
  previous_disabled_at TEXT,
  created_channel INTEGER NOT NULL DEFAULT 0 CHECK (created_channel IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  undone_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (suggested_channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (qr_version_id) REFERENCES qr_versions(id) ON DELETE SET NULL,
  UNIQUE (account_id, client_detection_id)
);

CREATE INDEX detections_account_inbox_idx
  ON detections (account_id, status, created_at DESC);
CREATE INDEX detections_account_channel_idx
  ON detections (account_id, channel_id, created_at DESC);

CREATE TABLE reminder_deliveries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  apns_id TEXT,
  status_code INTEGER,
  response_reason TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE (account_id, channel_id, device_id, reminder_key)
);

CREATE INDEX reminder_deliveries_account_channel_idx
  ON reminder_deliveries (account_id, channel_id, created_at DESC);
