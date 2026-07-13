CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (
    media_kind IN ('primary_image', 'image_asset', 'video', 'document', 'combo_image', 'combo_video')
  ),
  original_name TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  declared_size BIGINT NOT NULL CHECK (declared_size > 0),
  pending_object_key TEXT NOT NULL UNIQUE,
  final_object_key TEXT UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('authorized', 'uploaded', 'finalized', 'claimed', 'failed', 'expired')
  ),
  expires_at BIGINT NOT NULL,
  claimed_at BIGINT,
  failure_code TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_sessions_user_active_idx
  ON upload_sessions(user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS upload_sessions_cleanup_idx
  ON upload_sessions(status, updated_at);

CREATE TABLE IF NOT EXISTS document_assets (
  id VARCHAR(80) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id VARCHAR(50) REFERENCES cards(id) ON DELETE CASCADE,
  storage_provider VARCHAR(20) NOT NULL DEFAULT 'oss',
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, storage_provider, storage_key)
);

CREATE INDEX IF NOT EXISTS document_assets_user_card_idx
  ON document_assets(user_id, card_id, created_at DESC);
