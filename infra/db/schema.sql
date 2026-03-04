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

-- OpenAI API Request Logging Table
CREATE TABLE openai_request_logs (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(255) UNIQUE NOT NULL,
  model VARCHAR(100) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  request_input TEXT NOT NULL,
  request_tokens INT,
  response_output TEXT,
  response_tokens INT,
  status_code INT,
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_openai_logs_created_at ON openai_request_logs(created_at DESC);
CREATE INDEX idx_openai_logs_model ON openai_request_logs(model);
CREATE INDEX idx_openai_logs_endpoint ON openai_request_logs(endpoint);

-- Customer profiles used by AI assignment pipeline
CREATE TABLE customer_profiles (
  customer_id TEXT PRIMARY KEY,
  segment TEXT,
  age_range TEXT,
  location TEXT,
  preferences JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customer_profiles_segment ON customer_profiles(segment);
CREATE INDEX idx_customer_profiles_location ON customer_profiles(location);

-- Aggregated customer behavior summary (precomputed for faster assignment jobs)
CREATE TABLE customer_behavior_summary (
  customer_id TEXT PRIMARY KEY REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
  total_events INT DEFAULT 0,
  total_spend NUMERIC DEFAULT 0,
  avg_order_value NUMERIC DEFAULT 0,
  favorite_categories TEXT[] DEFAULT '{}',
  last_purchase_date TIMESTAMP,
  purchase_frequency TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customer_behavior_last_purchase ON customer_behavior_summary(last_purchase_date DESC);
CREATE INDEX idx_customer_behavior_total_spend ON customer_behavior_summary(total_spend DESC);

-- Embeddings for customer profile text
CREATE TABLE customer_embeddings (
  customer_id TEXT PRIMARY KEY REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
  profile_embedding vector(1536),
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_embeddings_vector
  ON customer_embeddings USING ivfflat (profile_embedding vector_cosine_ops)
  WITH (lists = 10);

-- Notify worker(s) when customer profile changes
CREATE OR REPLACE FUNCTION notify_customer_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  target_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.customer_id;
  ELSE
    target_id := NEW.customer_id;
  END IF;

  payload := json_build_object(
    'op', TG_OP,
    'customer_id', target_id,
    'timestamp', NOW()
  );

  PERFORM pg_notify('customer_changes', payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_change ON customer_profiles;
CREATE TRIGGER trg_customer_change
  AFTER INSERT OR UPDATE OR DELETE ON customer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION notify_customer_change();
