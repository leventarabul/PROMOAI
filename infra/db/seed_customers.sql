-- Seed: sample customers for AI assignment pipeline tests

INSERT INTO customer_profiles (customer_id, segment, age_range, location, preferences, is_active)
VALUES
  ('u_001', 'gold', '30-39', 'istanbul', '{"channels": ["mobile"], "interests": ["grocery", "dining", "travel"]}'::jsonb, TRUE),
  ('u_002', 'silver', '25-34', 'ankara', '{"channels": ["web"], "interests": ["fuel", "grocery"]}'::jsonb, TRUE),
  ('u_003', 'bronze', '18-24', 'izmir', '{"channels": ["mobile"], "interests": ["electronics", "gaming"]}'::jsonb, TRUE),
  ('u_004', 'gold', '40-49', 'bursa', '{"channels": ["mobile", "web"], "interests": ["travel", "dining"]}'::jsonb, TRUE),
  ('u_005', 'silver', '35-44', 'antalya', '{"channels": ["web"], "interests": ["grocery", "electronics"]}'::jsonb, TRUE)
ON CONFLICT (customer_id) DO UPDATE
SET segment = EXCLUDED.segment,
    age_range = EXCLUDED.age_range,
    location = EXCLUDED.location,
    preferences = EXCLUDED.preferences,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO customer_behavior_summary (
  customer_id,
  total_events,
  total_spend,
  avg_order_value,
  favorite_categories,
  last_purchase_date,
  purchase_frequency
)
VALUES
  ('u_001', 48, 9200, 191.67, ARRAY['grocery', 'dining', 'travel'], NOW() - INTERVAL '1 day', 'weekly'),
  ('u_002', 33, 4100, 124.24, ARRAY['fuel', 'grocery'], NOW() - INTERVAL '2 days', 'weekly'),
  ('u_003', 18, 2800, 155.56, ARRAY['electronics', 'gaming'], NOW() - INTERVAL '7 days', 'monthly'),
  ('u_004', 64, 14500, 226.56, ARRAY['travel', 'dining'], NOW() - INTERVAL '12 hours', 'weekly'),
  ('u_005', 27, 3600, 133.33, ARRAY['grocery', 'electronics'], NOW() - INTERVAL '3 days', 'biweekly')
ON CONFLICT (customer_id) DO UPDATE
SET total_events = EXCLUDED.total_events,
    total_spend = EXCLUDED.total_spend,
    avg_order_value = EXCLUDED.avg_order_value,
    favorite_categories = EXCLUDED.favorite_categories,
    last_purchase_date = EXCLUDED.last_purchase_date,
    purchase_frequency = EXCLUDED.purchase_frequency,
    updated_at = NOW();
