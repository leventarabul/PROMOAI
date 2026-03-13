# PromoAI Documentation Hub

This folder is the single source of truth for project documentation.

## Structure

- `docs/README.md` — This index
- `docs/ASSIGNMENT_SYSTEM.md` — Assignment engine product + technical deep dive
- `docs/tech-stack.md` — Technology decisions
- `docs/db-setup.md` — Database setup steps
- `docs/auth.md` — API key authentication
- `docs/diagrams/` — Architecture and flow diagrams
- `docs/links.md` — Helpful references
- `services/dashboard-service/README.md` — Demo dashboard runbook and smoke-test guide

## How to use

- Add new docs here and link them from this index.
- Keep sections short and task‑oriented.

## Recommended Reading Order

1. [CONTEXT.md](../CONTEXT.md)
2. [docs/ASSIGNMENT_SYSTEM.md](ASSIGNMENT_SYSTEM.md)
3. [docs/db-setup.md](db-setup.md)
4. [services/dashboard-service/README.md](../services/dashboard-service/README.md)

## Clean Repo Policy (Critical)

- Secrets and credentials must **never** be committed.
- Use `.env` locally; it is ignored by git.
- Keep the repository clean and reproducible; document setup steps in docs.
