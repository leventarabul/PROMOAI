# PromoAI Documentation Hub

This folder is the single source of truth for project documentation.

## Structure

- `docs/README.md` — This index
- `docs/tech-stack.md` — Technology decisions
- `docs/db-setup.md` — Database setup steps
- `docs/auth.md` — API key authentication
- `docs/diagrams/` — Architecture and flow diagrams
- `docs/links.md` — Helpful references

## How to use

- Add new docs here and link them from this index.
- Keep sections short and task‑oriented.

## Clean Repo Policy (Critical)

- Secrets and credentials must **never** be committed.
- Use `.env` locally; it is ignored by git.
- Keep the repository clean and reproducible; document setup steps in docs.
