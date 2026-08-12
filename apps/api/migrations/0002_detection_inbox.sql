PRAGMA foreign_keys = ON;

CREATE TABLE channel_aliases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, channel_id, normalized_name)
);

CREATE INDEX channel_aliases_tenant_name_idx
  ON channel_aliases (tenant_id, normalized_name);

CREATE TABLE detections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
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
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (suggested_channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  FOREIGN KEY (qr_version_id) REFERENCES qr_versions(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, client_detection_id)
);

CREATE INDEX detections_tenant_inbox_idx
  ON detections (tenant_id, status, created_at DESC);

CREATE INDEX detections_tenant_channel_idx
  ON detections (tenant_id, channel_id, created_at DESC);
