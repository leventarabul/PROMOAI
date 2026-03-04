-- Migration 004: OpenAI API Request Logging Table
-- Created: 2026-03-04

CREATE TABLE IF NOT EXISTS openai_request_logs (
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

-- Index for querying recent requests
CREATE INDEX IF NOT EXISTS idx_openai_logs_created_at ON openai_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openai_logs_model ON openai_request_logs(model);
CREATE INDEX IF NOT EXISTS idx_openai_logs_endpoint ON openai_request_logs(endpoint);
