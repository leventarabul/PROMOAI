# PromoAI

See [CONTEXT.md](CONTEXT.md) for product and architecture context.

## Current Status

- Trend detection, context service, assignment flow, and Postgres/pgvector-backed retrieval are working locally.
- A new executive demo UI is available under `services/dashboard-service/`.
- The dashboard exposes 5 tabs: trend detection, embedding visualization, assignment pipeline, assignment results, and customer behavior profiling.
- A new `behavior-aggregator` service computes `customer_behavior_summary` from `events` + `customer_profiles` and serves the new dashboard tab on port `3008`.
- Mock event seed data is available in `infra/db/seed_events.sql` for 5 demo customers over the last 90 days.
- The latest assignment system product write-up is in [docs/ASSIGNMENT_SYSTEM.md](docs/ASSIGNMENT_SYSTEM.md).

## Repository Structure (Initial)

- `services/` — deployable services (Event API, Rule Engine, Assignment, etc.)
- `libs/` — shared libraries (types, logging, utilities)
- `contracts/` — API and event schemas
- `infra/` — infrastructure definitions (DB, queues, deployments)
- `docs/` — diagrams and design notes

## Documentation

Start here: [docs/README.md](docs/README.md)

DB setup guide: [docs/db-setup.md](docs/db-setup.md)

Assignment system deep dive: [docs/ASSIGNMENT_SYSTEM.md](docs/ASSIGNMENT_SYSTEM.md)

Dashboard runbook: [services/dashboard-service/README.md](services/dashboard-service/README.md)

## Local Infrastructure (MVP)

- Postgres 15
- Redis 7 (Streams)

Use docker-compose to start local infra.

## Local Demo Run

1. Start infra and backend services:
	- `docker compose up -d --build`
	- `npm --prefix services/assignment-service install`
	- `npm --prefix services/assignment-service start`
	- `npm --prefix services/behavior-aggregator install`
	- `npm --prefix services/behavior-aggregator start`
2. Start the demo dashboard:
	- `bash services/dashboard-service/start.sh`
3. Open the dashboard:
	- `http://localhost:3007`

Optional demo data load:
	- `docker exec -i promoai-postgres psql -U promoai -d campaign < infra/db/seed_events.sql`

## Quick Validation

- Run dashboard smoke tests with `bash services/dashboard-service/test.sh`
- Recommended demo order:
  1. `Trend Algılama`
  2. `Vektör DB`
  3. `Kampanya Atama`
  4. `Atama Sonuçları`
	5. `Müşteri Profil`

## Current Handoff

- Completed: 5th dashboard tab (`Müşteri Profil`) with 3-step animation (`Veri Toplama → Hesaplama → Kaydetme`).
- Completed: `services/behavior-aggregator/` service, dashboard BFF routes, and Docker Compose wiring for port `3008`.
- Completed: mock event seed file `infra/db/seed_events.sql` and end-to-end verification of behavior aggregation for 5 users.
- Guardrail added: frontend dashboard JS avoids optional chaining because an auto-formatter had been corrupting `?.` into `? .`.
- Last verified locally: behavior aggregation works directly and through dashboard proxy; trend detection works; dashboard serves successfully on `3007`.

## Near-Term Next Steps

- Add a dockerized startup path for `assignment-service` and `dashboard-service`
- Add basic UI regression coverage for the 5-tab dashboard flow
- Add production-grade health/logging endpoints for dashboard and assignment flows
