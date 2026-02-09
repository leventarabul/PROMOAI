import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createClient } from "redis";
import client from "prom-client";
import dotenv from "dotenv";
import pg from "pg";
import crypto from "crypto";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, "../../../contracts/event.schema.json");
const eventSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateEvent = ajv.compile(eventSchema);

const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = process.env.REDIS_PORT || "6379";
const streamName = process.env.REDIS_STREAM || "events";

const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT
} = process.env;

const pool = new pg.Pool({
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432)
});

const serviceName = process.env.SERVICE_NAME || "event-api";

const redis = createClient({ url: `redis://${redisHost}:${redisPort}` });
redis.on("error", (err) => {
    console.error("Redis error:", err);
});

await redis.connect();

client.collectDefaultMetrics();
const eventsAccepted = new client.Counter({
    name: "event_api_events_accepted_total",
    help: "Total number of accepted events"
});
const eventsRejected = new client.Counter({
    name: "event_api_events_rejected_total",
    help: "Total number of rejected events"
});
const publishErrors = new client.Counter({
    name: "event_api_publish_errors_total",
    help: "Total number of publish errors"
});
const dbWriteErrors = new client.Counter({
    name: "event_api_db_write_errors_total",
    help: "Total number of DB write errors"
});
const dbDuplicates = new client.Counter({
    name: "event_api_db_duplicates_total",
    help: "Total number of duplicate events (idempotent)"
});
const authRejected = new client.Counter({
    name: "event_api_auth_rejected_total",
    help: "Total number of rejected auth attempts"
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get("/metrics", async(req, res) => {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
});

async function authenticate(req, res, next) {
    const apiKey = req.header("X-API-Key");
    if (!apiKey) {
        authRejected.inc();
        return res.status(401).json({ status: "unauthorized" });
    }

    const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

    try {
        const secretResult = await pool.query(
            "SELECT c.client_id, c.is_active FROM api_secrets s JOIN api_clients c ON c.client_id = s.client_id WHERE s.secret_hash = $1 AND s.revoked_at IS NULL", [hash]
        );

        if (secretResult.rowCount === 0) {
            authRejected.inc();
            return res.status(401).json({ status: "unauthorized" });
        }

        const clientRow = secretResult.rows[0];
        if (!clientRow.is_active) {
            authRejected.inc();
            return res.status(403).json({ status: "forbidden" });
        }

        const permResult = await pool.query(
            "SELECT allowed FROM api_permissions WHERE client_id = $1 AND service = $2", [clientRow.client_id, serviceName]
        );

        if (permResult.rowCount === 0 || !permResult.rows[0].allowed) {
            authRejected.inc();
            return res.status(403).json({ status: "forbidden" });
        }

        req.clientId = clientRow.client_id;
        return next();
    } catch (err) {
        console.error("Auth error:", err);
        return res.status(500).json({ status: "error" });
    }
}

app.post("/events", authenticate, async(req, res) => {
    const valid = validateEvent(req.body);
    if (!valid) {
        eventsRejected.inc();
        console.warn("Invalid event payload", {
            errors: validateEvent.errors || []
        });
        return res.status(400).json({
            status: "invalid",
            errors: validateEvent.errors || []
        });
    }
    const payload = req.body;
    const eventId =
        payload.event_id !== undefined && payload.event_id !== null ?
        payload.event_id :
        `${payload.type}:${payload.transaction_id}`;

    try {
        const result = await pool.query(
            "INSERT INTO events (user_id, type, transaction_id, amount, category, timestamp, context) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (type, transaction_id) DO NOTHING RETURNING event_id", [
                payload.user_id,
                payload.type,
                payload.transaction_id,
                payload.amount !== undefined && payload.amount !== null ?
                payload.amount :
                null,
                payload.category !== undefined && payload.category !== null ?
                payload.category :
                null,
                payload.timestamp,
                payload.context !== undefined && payload.context !== null ?
                payload.context :
                null
            ]
        );

        if (result.rowCount === 0) {
            dbDuplicates.inc();
            return res.status(202).json({ status: "duplicate" });
        }
    } catch (err) {
        dbWriteErrors.inc();
        console.error("Failed to write event to DB:", err);
        return res.status(500).json({ status: "error" });
    }

    try {
        await redis.xAdd(
            streamName,
            "*", {
                event_id: String(eventId),
                transaction_id: String(payload.transaction_id),
                type: String(payload.type),
                user_id: String(payload.user_id),
                payload: JSON.stringify(payload)
            }
        );

        eventsAccepted.inc();
        console.info("Event accepted", {
            event_id: eventId,
            transaction_id: payload.transaction_id,
            type: payload.type
        });
        return res.status(202).json({ status: "accepted" });
    } catch (err) {
        publishErrors.inc();
        console.error("Failed to publish event:", err);
        return res.status(500).json({ status: "error" });
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Event API listening on ${port}`);
});