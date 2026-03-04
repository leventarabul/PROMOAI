INSERT INTO api_clients (client_id, name) VALUES ('client_dummy', 'Dummy Test Client');
INSERT INTO api_secrets (secret_id, client_id, secret_hash)
VALUES ('sec_dummy', 'client_dummy', encode(sha256('promoai_dummy_key_1'::bytea), 'hex'));
INSERT INTO api_permissions (client_id, service, allowed) VALUES ('client_dummy', 'event-api', true);

INSERT INTO campaigns (campaign_id, name, category, reward_type, reward_value, rule_json) VALUES
  ('camp_grocery_10', 'Grocery Cashback 10%', 'grocery', 'cashback', 10, '{"event_type": "purchase", "min_amount": 100, "cashback_percent": 10}'),
  ('camp_fuel_points', 'Fuel Points Bonus', 'fuel', 'points', 500, '{"event_type": "purchase", "min_amount": 50}'),
  ('camp_electronics_discount', 'Electronics Summer Sale', 'electronics', 'discount', 15, '{"event_type": "purchase", "min_amount": 200}'),
  ('camp_travel_cashback', 'Travel Cashback 5%', 'travel', 'cashback', 5, '{"event_type": "purchase", "min_amount": 500, "cashback_percent": 5}'),
  ('camp_dining_points', 'Dining Loyalty Points', 'dining', 'points', 200, '{"event_type": "purchase", "min_amount": 30}');
