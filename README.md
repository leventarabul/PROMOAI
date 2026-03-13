# PromoAI

See [CONTEXT.md](CONTEXT.md) for product and architecture context.

## Current Status

- Trend detection, context service, assignment flow, and Postgres/pgvector-backed retrieval are working locally.
- A new executive demo UI is available under `services/dashboard-service/`.
- The dashboard exposes 4 tabs: trend detection, embedding visualization, assignment pipeline, and assignment results.
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
2. Start the demo dashboard:
	- `bash services/dashboard-service/start.sh`
3. Open the dashboard:
	- `http://localhost:3007`

## Quick Validation

- Run dashboard smoke tests with `bash services/dashboard-service/test.sh`
- Recommended demo order:
  1. `Trend Algılama`
  2. `Vektör DB`
  3. `Kampanya Atama`
  4. `Atama Sonuçları`

## Near-Term Next Steps

- Add a dockerized startup path for `assignment-service` and `dashboard-service`
- Add basic UI regression coverage for the 4-tab dashboard flow
- Add production-grade health/logging endpoints for dashboard and assignment flows
