# Event API

Skeleton service. Responsibilities:
- Validate incoming events against contracts
- Publish events to Redis Streams
- Basic health endpoints

## Step 2 (Skeleton)

Endpoints:
- `GET /health` → `{ status: "ok" }`
- `POST /events` → `202 Accepted`

Run:
- `npm install`
- `npm run dev`

## Step 3 (Validation)

- Validates request body using [contracts/event.schema.json](../../contracts/event.schema.json)
- Returns `400` with validation errors if payload is invalid

## Step 4 (Publish to Redis Streams)

- Publishes validated events to Redis Stream `events` by default
- Env vars: `REDIS_HOST`, `REDIS_PORT`, `REDIS_STREAM`

## DB Write (Event Store)

- Inserts into `events` table before publishing to Redis
- Idempotent on `(type, transaction_id)`; duplicates return `202` with `status: duplicate`

## Authentication

- Uses API key via `X-API-Key` header
- Validates against `api_clients`, `api_secrets`, `api_permissions`
- Service name for permissions: `SERVICE_NAME` (default: `event-api`)

## Step 5 (Logging + Metrics)

- Logs: basic `console` logs for accepted/rejected/publish errors
- Metrics: `GET /metrics` (Prometheus format)

## Step 6 (Test Payloads)

See sample payloads in [sample-payloads.md](sample-payloads.md)

## Swagger / OpenAPI

Spec file: [openapi.yaml](openapi.yaml)
