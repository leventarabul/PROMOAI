# Rule Engine

Event eligibility evaluation and campaign matching.

## Endpoints

- `GET /health` - Health check
- `GET /db-health` - Database check
- `POST /events` - Evaluate event eligibility
- `GET /evaluate/:user_id` - Check user existence

## Response Example (POST /events)

```json
{
  "status": "evaluated",
  "event_id": 1,
  "user_id": "u_001",
  "eligible_campaigns": [
    {"campaign_id": "CAMP_001", "matched_rule": "purchase"}
  ]
}
```

## Running

```bash
npm install
node src/index.js
```

Listens on port 8000.
