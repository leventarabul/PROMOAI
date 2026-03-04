# Assignment Service

AI-powered assignment worker with scheduling.

## Responsibilities
- Build candidate campaign set using vector similarity.
- Generate customer profile embeddings.
- Select campaigns via GPT (fallback to similarity ranking).
- Store assignment + reason in `assignments` table.

## Endpoints
- `GET /health`
- `POST /assign/run` body: `{ "customer_ids": ["u_001", "u_002"] }` (optional)

## Run
- `npm start`
- `npm run run-once`
