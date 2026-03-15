# PromoAI Behavior Aggregator

Aggregates customer behavior metrics from raw events and writes the results to `customer_behavior_summary`.

## Purpose

- Reads `events` and `customer_profiles`
- Computes customer-level metrics such as spend, event counts, favorite categories, and purchase frequency
- Upserts the results into `customer_behavior_summary`
- Serves the dashboard's `Müşteri Profil` tab through a lightweight HTTP API

## Endpoints

- `GET /health` — database connectivity and service health
- `GET /aggregate/stats` — high-level stats for current behavior data
- `POST /aggregate/run` — manual aggregation trigger

## Local Run

- `npm install`
- `npm start`

Default port: `3008`

## Environment

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `BEHAVIOR_AGGREGATOR_PORT`
- `BEHAVIOR_AGGREGATOR_CRON`

## Data Notes

- Spend is calculated as `SUM(purchase) - SUM(return)`
- Frequency buckets are `weekly`, `biweekly`, `monthly`, `rare`
- Favorite categories are the top 3 categories by event frequency
- Demo seed data is in `infra/db/seed_events.sql`

## Current Status

- Verified locally with 180 seeded events across 5 customers
- Connected to dashboard BFF via `/api/behavior/stats` and `/api/behavior/aggregate`
- Runs on a daily cron by default and also supports manual execution for demos