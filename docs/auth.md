# API Key Authentication (Shared Pattern)

This auth flow applies to **all services and modules**.

## Overview

- Clients authenticate with **API keys**.
- Keys are stored as **hashes** (never plaintext) in the DB.
- Authorization is **per service** via an allow list.

## Tables

- `api_clients` — client registry (active/inactive)
- `api_secrets` — hashed secrets, revocable
- `api_permissions` — per‑service allow list

## Request Format

- Header: `X-API-Key: <secret>`

## Validation Logic (Service Side)

1. Hash the incoming API key (SHA‑256).
2. Find active client with a non‑revoked secret matching the hash.
3. Check `api_permissions` for the target service.
4. Reject if not allowed.

## Service Naming

Each service uses a stable name (e.g. `event-api`, `rule-engine`).
This name is used in `api_permissions.service`.

## Example SQL (placeholders)

```sql
-- Create a client
INSERT INTO api_clients (client_id, name) VALUES ('client_001', 'Partner A');

-- Store hashed secret
INSERT INTO api_secrets (secret_id, client_id, secret_hash)
VALUES ('secret_001', 'client_001', '<sha256_of_secret>');

-- Allow access to event-api and rule-engine
INSERT INTO api_permissions (client_id, service, allowed)
VALUES
  ('client_001', 'event-api', TRUE),
  ('client_001', 'rule-engine', TRUE);
```

## Notes

- Keys should be rotated by inserting a new secret and revoking the old one.
- Use separate clients for different external consumers.
