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
