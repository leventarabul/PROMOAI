# Rule Engine

Skeleton service. Responsibilities:
- Consume events from Redis Streams
- Evaluate eligibility rules
- Write assignments/rewards/events to DB

## Step 4 (DB Connection)

Endpoints:
- `GET /health`
- `GET /db-health`

Run:
- `npm install`
- `npm run dev`
