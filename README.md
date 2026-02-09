# PromoAI

See [CONTEXT.md](CONTEXT.md) for product and architecture context.

## Repository Structure (Initial)

- `services/` — deployable services (Event API, Rule Engine, Assignment, etc.)
- `libs/` — shared libraries (types, logging, utilities)
- `contracts/` — API and event schemas
- `infra/` — infrastructure definitions (DB, queues, deployments)
- `docs/` — diagrams and design notes

## Documentation

Start here: [docs/README.md](docs/README.md)

DB setup guide: [docs/db-setup.md](docs/db-setup.md)

## Local Infrastructure (MVP)

- Postgres 15
- Redis 7 (Streams)

Use docker-compose to start local infra.
