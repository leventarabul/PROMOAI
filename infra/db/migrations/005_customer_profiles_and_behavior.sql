-- Migration 005: Customer profile/behavior schema for AI assignment pipeline

CREATE TABLE IF NOT EXISTS customer_profiles (
  customer_id TEXT PRIMARY KEY,
  segment TEXT,
  age_range TEXT,
  location TEXT,
  preferences JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_segment ON customer_profiles(segment);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_location ON customer_profiles(location);

CREATE TABLE IF NOT EXISTS customer_behavior_summary (
  customer_id TEXT PRIMARY KEY REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
  total_events INT DEFAULT 0,
  total_spend NUMERIC DEFAULT 0,
  avg_order_value NUMERIC DEFAULT 0,
  favorite_categories TEXT[] DEFAULT '{}',
  last_purchase_date TIMESTAMP,
  purchase_frequency TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_behavior_last_purchase ON customer_behavior_summary(last_purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_behavior_total_spend ON customer_behavior_summary(total_spend DESC);

CREATE TABLE IF NOT EXISTS customer_embeddings (
  customer_id TEXT PRIMARY KEY REFERENCES customer_profiles(customer_id) ON DELETE CASCADE,
  profile_embedding vector(1536),
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_embeddings_vector
  ON customer_embeddings USING ivfflat (profile_embedding vector_cosine_ops)
  WITH (lists = 10);

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
