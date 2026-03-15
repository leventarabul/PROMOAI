# PromoAI Demo Dashboard

Executive-facing demo application for visualizing the end-to-end PromoAI flow.

## What It Shows

The dashboard is a 5-tab single-page app:

1. **Trend Algılama** — triggers trend detection and animates RSS/news → filter → context creation.
2. **Vektör DB** — renders a 3D Plotly scatter view of campaign, customer, and context embeddings.
3. **Kampanya Atama** — animates the assignment pipeline from context load to persistence.
4. **Atama Sonuçları** — groups active assignments by customer and shows AI reasons.
5. **Müşteri Profil** — computes customer behavior summaries from event history and shows before/after profile updates.

## Service Layout

- `src/index.js` — BFF/API layer for proxying service calls and querying PostgreSQL
- `public/index.html` — tab shell and page structure
- `public/css/style.css` — dark theme and animation system
- `public/js/*.js` — tab-specific interaction logic
- `start.sh` — reliable local start command
- `test.sh` — smoke test for static page + API routes

## Local Run

Prerequisites:

- Postgres and Redis running
- `context-service` available on `3005`
- `trend-detection-service` available on `3006`
- `assignment-service` available on `3004`
- `behavior-aggregator` available on `3008`

Install dependencies:

- `npm install`

Start the dashboard:

- `bash start.sh`

Open in browser:

- `http://localhost:3007`

## Smoke Test

Run:

- `bash test.sh`

The smoke test verifies:

- static HTML delivery
- `/api/customers`
- `/api/campaigns`
- `/api/embeddings/stats`
- `/api/contexts/active`
- `/api/assignments/results`
- `/api/embeddings/scatter`
- `/api/behavior/stats`
- `/api/behavior/aggregate`

## Current Verified Demo Data

- 5 active customers
- 9 campaigns
- 36 context embeddings
- 25 active assignments
- trend detection proxy returning `30 found / 4 filtered / 4 contexts created`
- 180 demo events loaded from `infra/db/seed_events.sql`
- 5 customer behavior summaries generated via `behavior-aggregator`

## Customer Behavior Flow

- Button: `Profilleri Güncelle`
- Pipeline: `Veri Toplama` → `Hesaplama` → `Kaydetme`
- Data source: `events` + `customer_profiles`
- Output table: `customer_behavior_summary`
- Spend logic: `purchase` totals minus `return` totals
- Frequency buckets: `weekly`, `biweekly`, `monthly`, `rare`

## Known Operational Note

Start the service from this directory via `bash start.sh` (or `cd services/dashboard-service && node src/index.js`).
Running `node src/index.js` from the repository root will fail because the terminal keeps the root working directory.

The dashboard frontend files under `public/js/` intentionally avoid optional chaining because an external formatter had been rewriting `?.` into invalid syntax.

## Next Improvements

- Add Docker support for the dashboard service
- Add a single command to start dashboard + assignment service together
- Add browser-level regression checks for tab interactions
- Add lightweight health endpoint and structured request logging