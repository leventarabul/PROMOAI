# Database Setup — Step by Step

We will do DB setup in small, controlled steps.

## Step 1 — Confirm schema
- File: `infra/db/schema.sql`
- Tables: campaigns, assignments, rewards, events
- Auth tables: api_clients, api_secrets, api_permissions
- Idempotency: unique `(type, transaction_id)` in `events`

### Step 1 Review Checklist
- `campaigns`: base campaign metadata + `rule_json` + `reward_*`
- `assignments`: stores user + campaign + `reason` + `status`
- `rewards`: stores issued rewards per user/campaign
- `events`: append‑only; includes `transaction_id` and uniqueness on `(type, transaction_id)`
	- `event_id` is auto‑increment (BIGSERIAL)
- `api_clients`: service consumers (is_active flag)
- `api_secrets`: hashed secrets per client (revocable)
- `api_permissions`: per‑service allow list

## Step 2 — Start local DB
- Use `docker-compose.yml` (Postgres 15)
- Environment: `.env` (POSTGRES_DB=campaign)

## Step 3 — Validate schema loading
- Docker will apply `infra/db/schema.sql` on first startup
- If schema changes later, create a migration in `infra/db/migrations/`
	- Example: `migrations/001_events_event_id_bigserial.sql`
	- Example: `migrations/002_api_auth_tables.sql`

## Step 4 — Connect services
- Services use `POSTGRES_*` env vars from `.env`
- First integration: Rule Engine writes `events` and `assignments`
	- Rule Engine provides `GET /db-health` for connection check
