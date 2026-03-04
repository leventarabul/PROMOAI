-- Migration 007: Auto-generated Trends Support
-- Adds columns to seasonal_contexts for trend detection service
-- Date: 2026-03-04

BEGIN;

-- Add columns for auto-generated trending contexts
ALTER TABLE seasonal_contexts
ADD COLUMN is_auto_generated BOOLEAN DEFAULT FALSE,
ADD COLUMN trend_source VARCHAR(50),
ADD COLUMN ttl_hours INT DEFAULT 12,
ADD COLUMN expires_at TIMESTAMPTZ,
ADD COLUMN trend_metadata JSONB;

-- Comments for clarity
COMMENT ON COLUMN seasonal_contexts.is_auto_generated IS 
  'TRUE for contexts auto-created by trend-detection-service, FALSE for manual contexts';

COMMENT ON COLUMN seasonal_contexts.trend_source IS 
  'Source of trend data: google_trends, semrush, news_api, reddit, etc.';

COMMENT ON COLUMN seasonal_contexts.ttl_hours IS 
  'Time-to-live in hours. Auto-generated contexts expire and are deleted after TTL.';

COMMENT ON COLUMN seasonal_contexts.expires_at IS 
  'Timestamp when this auto-generated context expires and should be deleted.';

COMMENT ON COLUMN seasonal_contexts.trend_metadata IS 
  'JSON metadata about the trend: volume, growth%, duration, related_queries, confidence_score, associated_campaigns, etc.';

-- Index for cleanup job: find expired auto-generated contexts
CREATE INDEX idx_seasonal_contexts_expires_auto
  ON seasonal_contexts(expires_at)
  WHERE is_auto_generated = TRUE;

-- Index for trend source lookups
CREATE INDEX idx_seasonal_contexts_trend_source
  ON seasonal_contexts(trend_source)
  WHERE is_auto_generated = TRUE;

-- Index for checking active auto-generated contexts
CREATE INDEX idx_seasonal_contexts_auto_active
  ON seasonal_contexts(is_auto_generated, start_date, end_date);

-- Create trend_detection_logs table for monitoring
CREATE TABLE IF NOT EXISTS trend_detection_logs (
  id SERIAL PRIMARY KEY,
  run_timestamp TIMESTAMPTZ DEFAULT NOW(),
  trends_found INT,
  trends_filtered INT,
  auto_contexts_created INT,
  status VARCHAR(50),
  error_message TEXT,
  duration_ms INT,
  details JSONB
);

-- Index for log queries
CREATE INDEX idx_trend_detection_logs_timestamp
  ON trend_detection_logs(run_timestamp DESC);

-- Create cleanup function for expired contexts
CREATE OR REPLACE FUNCTION cleanup_expired_auto_contexts()
RETURNS TABLE(deleted_count INT) AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM seasonal_contexts
  WHERE is_auto_generated = TRUE
    AND expires_at < NOW();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  INSERT INTO trend_detection_logs (status, details, duration_ms)
  VALUES ('cleanup', jsonb_build_object('deleted_contexts', v_deleted_count), 0);
  
  RETURN QUERY SELECT v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
