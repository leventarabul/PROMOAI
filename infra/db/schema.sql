-- Initial schema draft (subject to change)

CREATE TABLE campaigns (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  reward_type TEXT,
  reward_value NUMERIC,
  rule_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE assignments (
  assignment_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  reason TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rewards (
  reward_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  value NUMERIC,
  type TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE events (
  event_id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount NUMERIC,
  category TEXT,
  timestamp TIMESTAMP NOT NULL,
  context JSONB,
  UNIQUE (type, transaction_id)
);

CREATE TABLE api_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE api_secrets (
  secret_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES api_clients(client_id),
  secret_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE TABLE api_permissions (
  client_id TEXT NOT NULL REFERENCES api_clients(client_id),
  service TEXT NOT NULL,
  allowed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (client_id, service)
);

-- pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Campaign embeddings for vector similarity search
CREATE TABLE campaign_embeddings (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  embedding vector(1536),
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaign_embeddings_vector
  ON campaign_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Notify on campaign changes (INSERT/UPDATE/DELETE)
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

DROP TRIGGER IF EXISTS trg_campaign_change ON campaigns;
CREATE TRIGGER trg_campaign_change
  AFTER INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION notify_campaign_change();
