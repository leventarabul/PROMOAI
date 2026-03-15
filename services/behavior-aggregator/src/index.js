import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import cron from "node-cron";
import { runAggregation, getStats } from "./aggregator.js";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT,
    BEHAVIOR_AGGREGATOR_PORT,
    BEHAVIOR_AGGREGATOR_CRON,
} = process.env;

const pool = new pg.Pool({
    user: POSTGRES_USER || "promoai",
    password: POSTGRES_PASSWORD || "promoai",
    database: POSTGRES_DB || "campaign",
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432),
});

const PORT = Number(BEHAVIOR_AGGREGATOR_PORT || 3008);
const CRON_EXPR = BEHAVIOR_AGGREGATOR_CRON || "0 1 * * *";

const app = express();
app.use(express.json());

// ─────────── Health ───────────

app.get("/health", async(_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", service: "behavior-aggregator" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// ─────────── Manual Trigger ───────────

app.post("/aggregate/run", async(_req, res) => {
    try {
        console.log("[behavior-aggregator] Manual aggregation triggered");
        const result = await runAggregation(pool);
        console.log(`[behavior-aggregator] Done: ${result.customersProcessed} customers, ${result.duration}ms`);
        res.json(result);
    } catch (err) {
        console.error("[behavior-aggregator] Aggregation failed:", err.message);
        res.status(500).json({ status: "error", message: err.message });
    }
});

// ─────────── Stats ───────────

app.get("/aggregate/stats", async(_req, res) => {
    try {
        const stats = await getStats(pool);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// ─────────── Bootstrap ───────────

async function bootstrap() {
    await pool.query("SELECT 1");

    server = app.listen(PORT, () => {
        console.log(`\n👤 Behavior Aggregator listening on port ${PORT}`);
        console.log(`📅 Cron schedule: ${CRON_EXPR}`);
    });

    // Scheduled aggregation
    cron.schedule(CRON_EXPR, async() => {
        console.log(`\n[behavior-aggregator] Scheduled run started (${CRON_EXPR})`);
        try {
            const result = await runAggregation(pool);
            console.log(`[behavior-aggregator] Scheduled run done: ${result.customersProcessed} customers, ${result.duration}ms`);
        } catch (err) {
            console.error(`[behavior-aggregator] Scheduled run failed: ${err.message}`);
        }
    });

    console.log(`[behavior-aggregator] Cron scheduled: ${CRON_EXPR}\n`);

    // Run-once mode
    if (process.argv.includes("--run-once")) {
        const result = await runAggregation(pool);
        console.log("[behavior-aggregator] Run-once result:", result);
        process.exit(0);
    }
}

// ─────────── Graceful Shutdown ───────────

let server;

process.on("SIGTERM", async() => {
    console.log("[behavior-aggregator] SIGTERM received, shutting down...");
    if (server) server.close();
    await pool.end();
    process.exit(0);
});

process.on("SIGINT", async() => {
    console.log("[behavior-aggregator] SIGINT received, shutting down...");
    if (server) server.close();
    await pool.end();
    process.exit(0);
});

bootstrap().catch((err) => {
    console.error("behavior-aggregator fatal error:", err);
    process.exit(1);
});