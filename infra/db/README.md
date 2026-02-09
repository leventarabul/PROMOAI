# Database Setup (MVP)

This folder contains the initial schema and future migrations.

## Files

- `schema.sql` — initial schema applied by docker-compose
- `migrations/` — future incremental migrations

## Migrations

- `migrations/001_events_event_id_bigserial.sql` — make `events.event_id` server-generated
- `migrations/002_api_auth_tables.sql` — add API auth tables
