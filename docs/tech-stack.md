# Tech Stack Decisions (DB + Queue)

## Primary Database
**PostgreSQL 15+**
- Rationale: strong relational model, JSONB support, mature tooling, easy local dev.
- Tables: campaigns, assignments, rewards, events.
- Extensions: `pgcrypto` (IDs), optional `pgvector` (if vector search in DB).

## Event Store
**PostgreSQL (append‑only table)**
- Rationale: MVP simplicity, easy replay, fewer moving parts.
- Can be replaced by Kafka + object storage in later phases.

## Queue / Streaming
**Redis Streams**
- Rationale: simple ops, fast, good for MVP; supports consumer groups.
- Alternatives: RabbitMQ (work queues) or Kafka (high‑volume streaming).

## Vector Store
**pgvector (PostgreSQL extension)**
- Rationale: avoid new infra; good for early semantic retrieval.
- Alternative: Qdrant or Pinecone for larger scale.

## Observability
- **OpenTelemetry** for tracing.
- **Prometheus + Grafana** for metrics.
- **Loki** or **ELK** for logs.

## Deployment (MVP)
- Docker Compose for local.
- Single node deployment with Postgres + Redis.