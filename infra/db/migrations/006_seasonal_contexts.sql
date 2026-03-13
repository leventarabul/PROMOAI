-- Migration: Seasonal Context-Aware Assignment System
-- Description: Creates tables for managing seasonal/temporal contexts (Ramazan, school opening, holidays, etc.)
-- Author: PromoAI Engineering Team
-- Date: 2026-03-04

-- ============================================================================
-- Table: seasonal_contexts
-- Purpose: Define seasonal/temporal contexts with date ranges and priorities
-- ============================================================================

CREATE TABLE IF NOT EXISTS seasonal_contexts (
  context_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  priority INTEGER DEFAULT 1,
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_date_range CHECK (end_date >= start_date),
  CONSTRAINT check_priority CHECK (priority > 0)
);

-- Indexes for seasonal_contexts
CREATE INDEX idx_seasonal_contexts_dates ON seasonal_contexts(start_date, end_date);
CREATE INDEX idx_seasonal_contexts_priority ON seasonal_contexts(priority DESC);
CREATE INDEX idx_seasonal_contexts_tags ON seasonal_contexts USING GIN(tags);

COMMENT ON TABLE seasonal_contexts IS 'Defines seasonal/temporal contexts with date ranges for context-aware campaign assignment';
COMMENT ON COLUMN seasonal_contexts.priority IS 'Higher priority contexts override lower priority when multiple contexts are active';
COMMENT ON COLUMN seasonal_contexts.tags IS 'Array of tags for filtering contexts (e.g., ["religious", "education", "holiday"])';
COMMENT ON COLUMN seasonal_contexts.metadata IS 'Additional context-specific data (e.g., campaign categories to boost)';

-- ============================================================================
-- Table: active_contexts
-- Purpose: Track currently active contexts (auto-populated by cron job)
-- ============================================================================

CREATE TABLE IF NOT EXISTS active_contexts (
  context_id TEXT PRIMARY KEY REFERENCES seasonal_contexts(context_id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  
  CONSTRAINT check_activation CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);

CREATE INDEX idx_active_contexts_status ON active_contexts(status);
CREATE INDEX idx_active_contexts_activated ON active_contexts(activated_at DESC);

COMMENT ON TABLE active_contexts IS 'Tracks currently active contexts based on date ranges';
COMMENT ON COLUMN active_contexts.deactivated_at IS 'NULL means context is currently active';

-- ============================================================================
-- Table: context_embeddings
-- Purpose: Store vector embeddings for semantic context matching
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_embeddings (
  context_id TEXT PRIMARY KEY REFERENCES seasonal_contexts(context_id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity index for context embeddings (HNSW — no probe tuning needed)
CREATE INDEX idx_context_embeddings_vector
ON context_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 8, ef_construction = 64);

COMMENT ON TABLE context_embeddings IS 'Vector embeddings of seasonal contexts for semantic matching';
COMMENT ON COLUMN context_embeddings.content IS 'Text representation of context used to generate embedding';

-- ============================================================================
-- Seed Data: Common Seasonal Contexts
-- ============================================================================

INSERT INTO seasonal_contexts (context_id, name, description, start_date, end_date, priority, tags, metadata) VALUES
  ('ctx_ramazan_2026', 
   'Ramazan 2026', 
   'Ramazan fasting period with increased evening grocery shopping and dining activity', 
   '2026-02-28', 
   '2026-03-30', 
   10,
   ARRAY['religious', 'cultural', 'food'],
   '{"boost_categories": ["grocery", "dining", "food_delivery"], "behavior_patterns": ["evening_shopping", "bulk_purchases"], "campaign_themes": ["family_meals", "iftar_specials"]}'
  ),
  
  ('ctx_school_opening_2026_fall', 
   'School Opening Fall 2026', 
   'Back-to-school period with increased stationery, clothing, and electronics purchases', 
   '2026-09-01', 
   '2026-09-30', 
   8,
   ARRAY['education', 'seasonal'],
   '{"boost_categories": ["stationery", "electronics", "clothing", "books"], "behavior_patterns": ["family_shopping", "bulk_stationery"], "campaign_themes": ["back_to_school", "student_discounts"]}'
  ),
  
  ('ctx_new_year_2027', 
   'New Year 2027', 
   'New Year celebration period with increased travel, dining, and entertainment spending', 
   '2026-12-20', 
   '2027-01-10', 
   9,
   ARRAY['holiday', 'celebration'],
   '{"boost_categories": ["travel", "dining", "entertainment", "gifts"], "behavior_patterns": ["luxury_spending", "celebration_purchases"], "campaign_themes": ["new_year_offers", "travel_deals"]}'
  ),
  
  ('ctx_summer_vacation_2026', 
   'Summer Vacation 2026', 
   'Summer holiday season with increased travel and leisure activities', 
   '2026-06-15', 
   '2026-09-15', 
   7,
   ARRAY['holiday', 'travel'],
   '{"boost_categories": ["travel", "entertainment", "dining", "leisure"], "behavior_patterns": ["vacation_spending", "travel_bookings"], "campaign_themes": ["summer_deals", "vacation_offers"]}'
  ),
  
  ('ctx_mothers_day_2026', 
   'Mothers Day 2026', 
   'Mothers Day celebration with increased gift and flower purchases', 
   '2026-05-08', 
   '2026-05-15', 
   6,
   ARRAY['celebration', 'gift'],
   '{"boost_categories": ["gifts", "flowers", "dining", "jewelry"], "behavior_patterns": ["gift_shopping", "restaurant_bookings"], "campaign_themes": ["mothers_day_specials"]}'
  );

-- ============================================================================
-- Function: Auto-activate contexts based on current date
-- ============================================================================

CREATE OR REPLACE FUNCTION activate_current_contexts()
RETURNS TABLE(ret_context_id TEXT, ret_name VARCHAR, ret_action VARCHAR) AS $$
BEGIN
  -- Deactivate expired contexts
  UPDATE active_contexts ac
  SET status = 'inactive', deactivated_at = NOW()
  WHERE ac.status = 'active'
    AND ac.context_id IN (
      SELECT sc.context_id 
      FROM seasonal_contexts sc
      WHERE CURRENT_DATE NOT BETWEEN sc.start_date AND sc.end_date
    );
  
  -- Activate contexts that should be active
  INSERT INTO active_contexts (context_id, activated_at, status)
  SELECT sc.context_id, NOW(), 'active'
  FROM seasonal_contexts sc
  WHERE CURRENT_DATE BETWEEN sc.start_date AND sc.end_date
    AND NOT EXISTS (
      SELECT 1 FROM active_contexts ac2 
      WHERE ac2.context_id = sc.context_id AND ac2.status = 'active'
    )
  ON CONFLICT (context_id) DO UPDATE
  SET status = 'active', activated_at = NOW(), deactivated_at = NULL
  WHERE active_contexts.status != 'active';
  
  -- Return summary of changes
  RETURN QUERY
  SELECT ac.context_id, sc.name, 
         CASE WHEN ac.activated_at > NOW() - INTERVAL '5 seconds' THEN 'activated' ELSE 'already_active' END::VARCHAR
  FROM active_contexts ac
  JOIN seasonal_contexts sc ON ac.context_id = sc.context_id
  WHERE ac.status = 'active';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION activate_current_contexts IS 'Activates/deactivates seasonal contexts based on current date';

-- ============================================================================
-- View: current_active_contexts
-- Purpose: Easy query for currently active contexts with full details
-- ============================================================================

CREATE OR REPLACE VIEW current_active_contexts AS
SELECT 
  sc.context_id,
  sc.name,
  sc.description,
  sc.start_date,
  sc.end_date,
  sc.priority,
  sc.tags,
  sc.metadata,
  ac.activated_at,
  ce.embedding,
  ce.content as context_content
FROM seasonal_contexts sc
JOIN active_contexts ac ON sc.context_id = ac.context_id
LEFT JOIN context_embeddings ce ON sc.context_id = ce.context_id
WHERE ac.status = 'active'
  AND CURRENT_DATE BETWEEN sc.start_date AND sc.end_date
ORDER BY sc.priority DESC, sc.start_date ASC;

COMMENT ON VIEW current_active_contexts IS 'Currently active seasonal contexts with all details';

-- ============================================================================
-- Initial activation of contexts
-- ============================================================================

SELECT * FROM activate_current_contexts();

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Show all seasonal contexts
-- SELECT * FROM seasonal_contexts ORDER BY start_date;

-- Show active contexts
-- SELECT * FROM current_active_contexts;

-- Show context embeddings
-- SELECT context_id, LEFT(content, 50) as content_preview, 
--        array_length(embedding::float[], 1) as embedding_dim 
-- FROM context_embeddings;

-- Manual activation example (for testing)
-- SELECT * FROM activate_current_contexts();
