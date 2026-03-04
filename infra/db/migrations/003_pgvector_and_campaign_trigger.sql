-- Migration 003: pgvector extension, campaign_embeddings table, and pg_notify trigger
-- Date: 2026-03-04

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Campaign embeddings table
CREATE TABLE IF NOT EXISTS campaign_embeddings (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  embedding vector(1536),
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast similarity search (IVFFlat — good for <1M rows)
CREATE INDEX IF NOT EXISTS idx_campaign_embeddings_vector
  ON campaign_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- 3. Trigger function: notify on campaign changes
CREATE OR REPLACE FUNCTION notify_campaign_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  target_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.campaign_id;
  ELSE
    target_id := NEW.campaign_id;
  END IF;

  payload := json_build_object(
    'op', TG_OP,
    'campaign_id', target_id,
    'timestamp', NOW()
  );

  PERFORM pg_notify('campaign_changes', payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger to campaigns table
DROP TRIGGER IF EXISTS trg_campaign_change ON campaigns;
CREATE TRIGGER trg_campaign_change
  AFTER INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION notify_campaign_change();
