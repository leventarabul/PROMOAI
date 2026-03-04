import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import OpenAI from "openai";
import express from "express";

// ── Config ──────────────────────────────────────────────────
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
} = process.env;

const WORKER_PORT = process.env.SYNC_WORKER_PORT || 3003;

if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required. Set it in .env");
    process.exit(1);
}

// ── Clients ─────────────────────────────────────────────────
const pool = new pg.Pool({
    user: POSTGRES_USER || "promoai",
    password: POSTGRES_PASSWORD || "promoai",
    database: POSTGRES_DB || "campaign",
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432),
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Helpers ─────────────────────────────────────────────────

/** Build a descriptive text string from campaign fields for embedding */
function buildCampaignText(campaign) {
    const parts = [
        `Campaign: ${campaign.name}`,
        campaign.category ? `Category: ${campaign.category}` : null,
        campaign.reward_type ? `Reward Type: ${campaign.reward_type}` : null,
        campaign.reward_value != null ? `Reward Value: ${campaign.reward_value}` : null,
        campaign.rule_json ? `Rules: ${JSON.stringify(campaign.rule_json)}` : null,
    ];
    return parts.filter(Boolean).join(". ");
}

/** Log OpenAI request to database */
async function logOpenAIRequest(requestId, model, endpoint, requestInput, responseOutput, statusCode, errorMessage, durationMs) {
    try {
        await pool.query(
            `INSERT INTO openai_request_logs (request_id, model, endpoint, request_input, response_output, status_code, error_message, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (request_id) DO UPDATE
               SET response_output = EXCLUDED.response_output,
                   status_code = EXCLUDED.status_code,
                   error_message = EXCLUDED.error_message,
                   duration_ms = EXCLUDED.duration_ms,
                   updated_at = NOW()`, [requestId, model, endpoint, requestInput, responseOutput, statusCode, errorMessage, durationMs]
        );
    } catch (err) {
        console.error("Failed to log OpenAI request:", err.message);
    }
}

/** Generate embedding via OpenAI with exponential backoff retry */
async function generateEmbedding(text, campaignId, retries = 3) {
    const requestId = `emb-${campaignId}-${Date.now()}`;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: text,
            });

            const durationMs = Date.now() - startTime;
            const embedding = response.data[0].embedding;

            // Log successful request
            await logOpenAIRequest(
                requestId,
                EMBEDDING_MODEL,
                "/v1/embeddings",
                text.substring(0, 1000), // Log first 1000 chars
                JSON.stringify({ embedding_size: embedding.length }),
                200,
                null,
                durationMs
            );

            return embedding;
        } catch (err) {
            if (attempt === retries) {
                const durationMs = Date.now() - startTime;
                // Log failed request after all retries exhausted
                await logOpenAIRequest(
                    requestId,
                    EMBEDDING_MODEL,
                    "/v1/embeddings",
                    text.substring(0, 1000),
                    null,
                    err.status || 500,
                    err.message,
                    durationMs
                );
                throw err;
            }
            const delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
            console.warn(`Embedding attempt ${attempt} failed, retrying in ${delay}ms...`, err.message);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

/** Fetch a single campaign from DB */
async function fetchCampaign(campaignId) {
    const result = await pool.query(
        "SELECT campaign_id, name, category, reward_type, reward_value, rule_json FROM campaigns WHERE campaign_id = $1", [campaignId]
    );
    return result.rows[0] || null;
}

/** Upsert embedding into campaign_embeddings */
async function upsertEmbedding(campaignId, embedding, content) {
    const vectorStr = `[${embedding.join(",")}]`;
    await pool.query(
        `INSERT INTO campaign_embeddings (campaign_id, embedding, content, updated_at)
     VALUES ($1, $2::vector, $3, NOW())
     ON CONFLICT (campaign_id) DO UPDATE
       SET embedding = EXCLUDED.embedding,
           content = EXCLUDED.content,
           updated_at = NOW()`, [campaignId, vectorStr, content]
    );
}

/** Delete embedding for a removed campaign */
async function deleteEmbedding(campaignId) {
    await pool.query("DELETE FROM campaign_embeddings WHERE campaign_id = $1", [campaignId]);
}

// ── Core: process a single campaign change ──────────────────
async function handleCampaignChange(op, campaignId) {
    console.log(`Processing ${op} for campaign ${campaignId}`);

    if (op === "DELETE") {
        await deleteEmbedding(campaignId);
        console.log(`Deleted embedding for campaign ${campaignId}`);
        return;
    }

    // INSERT or UPDATE → generate embedding
    const campaign = await fetchCampaign(campaignId);
    if (!campaign) {
        console.warn(`Campaign ${campaignId} not found in DB, skipping`);
        return;
    }

    const text = buildCampaignText(campaign);
    console.log(`Generating embedding for: "${text}"`);

    const embedding = await generateEmbedding(text, campaignId);
    await upsertEmbedding(campaignId, embedding, text);

    console.log(`Embedding upserted for campaign ${campaignId} (${embedding.length} dims)`);
}

// ── LISTEN loop ─────────────────────────────────────────────
async function startListener() {
    // Use a dedicated client (not pool) for LISTEN — it must stay open
    const client = new pg.Client({
        user: POSTGRES_USER || "promoai",
        password: POSTGRES_PASSWORD || "promoai",
        database: POSTGRES_DB || "campaign",
        host: POSTGRES_HOST || "localhost",
        port: Number(POSTGRES_PORT || 5432),
    });

    await client.connect();
    await client.query("LISTEN campaign_changes");
    console.log("Listening on channel: campaign_changes");

    client.on("notification", async(msg) => {
        try {
            const payload = JSON.parse(msg.payload);
            const { op, campaign_id } = payload;
            await handleCampaignChange(op, campaign_id);
        } catch (err) {
            console.error("Error processing notification:", err);
        }
    });

    client.on("error", (err) => {
        console.error("LISTEN client error:", err);
        process.exit(1); // Supervisor should restart
    });
}

// ── Health endpoint ─────────────────────────────────────────
const app = express();

app.get("/health", async(_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", service: "campaign-sync-worker" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

// ── Bootstrap ───────────────────────────────────────────────
async function main() {
    console.log("Campaign Sync Worker starting...");

    // Verify DB connectivity
    try {
        await pool.query("SELECT 1");
        console.log("Database connected");
    } catch (err) {
        console.error("Cannot connect to database:", err.message);
        process.exit(1);
    }

    // Verify pgvector extension
    try {
        const ext = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
        if (ext.rowCount === 0) {
            console.error("pgvector extension not installed. Run migration 003 first.");
            process.exit(1);
        }
        console.log("pgvector extension verified");
    } catch (err) {
        console.error("pgvector check failed:", err.message);
        process.exit(1);
    }

    // Start LISTEN
    await startListener();

    // Start health server
    app.listen(WORKER_PORT, () => {
        console.log(`Health endpoint on port ${WORKER_PORT}`);
    });

    console.log("Campaign Sync Worker ready. Waiting for campaign changes...");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});