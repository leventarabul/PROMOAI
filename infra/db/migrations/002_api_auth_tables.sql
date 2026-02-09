-- Migration: add API auth tables for clients, secrets, permissions

CREATE TABLE IF NOT EXISTS api_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_secrets (
  secret_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES api_clients(client_id),
  secret_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_permissions (
  client_id TEXT NOT NULL REFERENCES api_clients(client_id),
  service TEXT NOT NULL,
  allowed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (client_id, service)
);
