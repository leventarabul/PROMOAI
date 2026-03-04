import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import cron from "node-cron";
import {
    buildCustomerProfileText,
    createOpenAIClient,
    fetchActiveCustomers,
    fetchActiveContexts,
    fetchCandidateCampaigns,
    generateProfileEmbedding,
    saveAssignments,
    selectCampaignsWithGPT,
    upsertCustomerEmbedding,
} from "./engine.js";

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
    OPENAI_API_KEY,
    ASSIGNMENT_WORKER_PORT,
    ASSIGNMENT_CRON,
    ASSIGNMENT_GPT_MODEL,
    ASSIGNMENT_TOP_K,
    ASSIGNMENT_LIMIT,
    CONTEXT_SERVICE_URL,
} = process.env;

if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required for assignment-service");
    process.exit(1);
}

const openai = createOpenAIClient(OPENAI_API_KEY);

const pool = new pg.Pool({
    user: POSTGRES_USER || "promoai",
    password: POSTGRES_PASSWORD || "promoai",
    database: POSTGRES_DB || "campaign",
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432),
});

const PORT = Number(ASSIGNMENT_WORKER_PORT || 3004);
const CRON_EXPR = ASSIGNMENT_CRON || "0 2 * * *";
const GPT_MODEL = ASSIGNMENT_GPT_MODEL || "gpt-3.5-turbo";
const TOP_K = Number(ASSIGNMENT_TOP_K || 10);
const MAX_ASSIGNMENTS_PER_USER = Number(ASSIGNMENT_LIMIT || 3);
const CONTEXT_SERVICE = CONTEXT_SERVICE_URL || "http://localhost:3005";

async function assignForCustomers(customerIds = null) {
    // Fetch active seasonal contexts
    const activeContexts = await fetchActiveContexts(CONTEXT_SERVICE);
    if (activeContexts.length > 0) {
        console.log(`[assignment] Loaded ${activeContexts.length} active context(s)`);
        activeContexts.forEach(ctx => {
            console.log(`  - ${ctx.name} (priority: ${ctx.priority})`);
        });
    }

    const customers = await fetchActiveCustomers(pool, customerIds);

    const summary = {
        totalCustomers: customers.length,
        processed: 0,
        assignmentsInserted: 0,
        failures: 0,
        activeContexts: activeContexts.length,
    };

    for (const customer of customers) {
        try {
            const profileText = buildCustomerProfileText(customer);
            const embedding = await generateProfileEmbedding({
                openai,
                pool,
                customerId: customer.customer_id,
                text: profileText,
            });

            await upsertCustomerEmbedding(pool, customer.customer_id, embedding, profileText);

            const candidates = await fetchCandidateCampaigns(pool, embedding, TOP_K);
            if (candidates.length === 0) {
                summary.processed += 1;
                continue;
            }

            // Pass active contexts to GPT for context-aware selection
            const selected = await selectCampaignsWithGPT({
                openai,
                pool,
                customer,
                campaigns: candidates,
                model: GPT_MODEL,
                limit: MAX_ASSIGNMENTS_PER_USER,
                activeContexts: activeContexts,
            });

            const inserted = await saveAssignments(pool, customer.customer_id, selected);
            summary.assignmentsInserted += inserted;
            summary.processed += 1;
        } catch (err) {
            summary.failures += 1;
            console.error(`Assignment failed for ${customer.customer_id}:`, err.message);
        }
    }

    return summary;
}

const app = express();
app.use(express.json());

app.get("/health", async(_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", service: "assignment-service" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post("/assign/run", async(req, res) => {
    try {
        const customerIds = Array.isArray(req.body ? .customer_ids) ? req.body.customer_ids : null;
        const summary = await assignForCustomers(customerIds);
        res.json({ status: "ok", ...summary });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

async function bootstrap() {
    await pool.query("SELECT 1");

    app.listen(PORT, () => {
        console.log(`\n🚀 Assignment Service listening on port ${PORT}`);
        console.log(`📅 Cron schedule: ${CRON_EXPR}`);
        console.log(`🤖 GPT Model: ${GPT_MODEL}`);
        console.log(`📍 Context Service: ${CONTEXT_SERVICE}`);
    });

    cron.schedule(CRON_EXPR, async() => {
        console.log(`\n[assignment-service] Scheduled run started (${CRON_EXPR})`);
        const summary = await assignForCustomers();
        console.log("[assignment-service] Scheduled run done", summary);
    });

    console.log(`[assignment-service] Cron scheduled: ${CRON_EXPR}\n`);

    if (process.argv.includes("--run-once")) {
        const summary = await assignForCustomers();
        console.log("[assignment-service] Run-once summary", summary);
        process.exit(0);
    }
}

bootstrap().catch((err) => {
    console.error("assignment-service fatal error:", err);
    process.exit(1);
});