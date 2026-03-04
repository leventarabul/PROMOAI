import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import { createClient } from "redis";
import OpenAI from "openai";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT,
    REDIS_HOST,
    REDIS_PORT,
    OPENAI_API_KEY
} = process.env;

const pool = new pg.Pool({
    user: POSTGRES_USER || "promoai",
    password: POSTGRES_PASSWORD || "promoai",
    database: POSTGRES_DB || "campaign",
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432)
});

const redis = createClient({ url: `redis://${REDIS_HOST || "localhost"}:${REDIS_PORT || 6379}` });
redis.on("error", (err) => {
    console.error("Redis error:", err);
});

await redis.connect();

// OpenAI client for embedding queries (optional — search endpoint disabled if no key)
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const EMBEDDING_MODEL = "text-embedding-ada-002";

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

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get("/db-health", async(req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

// POST /events - Receive events from Event API (or consume from Redis)
// For MVP, this is a simple eligibility check endpoint
app.post("/events", async(req, res) => {
    const { event_id, user_id, type, transaction_id, payload } = req.body;

    if (!event_id || !user_id || !type) {
        return res.status(400).json({ status: "invalid", message: "Missing required fields" });
    }

    try {
        // Get all campaigns from DB
        const campaignsResult = await pool.query("SELECT campaign_id, rule_json, reward_type, reward_value FROM campaigns WHERE rule_json IS NOT NULL");
        const campaigns = campaignsResult.rows;

        // Parse event payload
        let eventData;
        try {
            eventData = typeof payload === "string" ? JSON.parse(payload) : payload;
        } catch {
            eventData = {};
        }

        // Evaluate rules - simple match engine
        const eligible = [];
        const rewards = []; // Track rewards to write to DB

        for (const campaign of campaigns) {
            const rules = campaign.rule_json || {};

            // Simple rule matching: check if event type matches campaign rule
            if (rules.event_type && rules.event_type === type) {
                // Check min_amount if specified
                if (rules.min_amount && eventData.amount && eventData.amount < rules.min_amount) {
                    continue; // Skip if amount doesn't meet minimum
                }

                // CHECK: User must have this campaign in assignments table
                const assignmentCheck = await pool.query(
                    "SELECT assignment_id FROM assignments WHERE user_id = $1 AND campaign_id = $2 LIMIT 1", [user_id, campaign.campaign_id]
                );

                if (assignmentCheck.rowCount === 0) {
                    console.log("No assignment found", { user_id, campaign_id: campaign.campaign_id });
                    continue; // Skip if user doesn't have assignment for this campaign
                }

                // Calculate reward
                let rewardAmount = 0;
                if (campaign.reward_type === "cashback" && rules.cashback_percent) {
                    rewardAmount = (eventData.amount || 0) * (rules.cashback_percent / 100);
                } else if (campaign.reward_type === "points") {
                    rewardAmount = campaign.reward_value;
                } else if (campaign.reward_type === "discount") {
                    rewardAmount = campaign.reward_value;
                }

                const calculatedReward = parseFloat(rewardAmount.toFixed(2));

                eligible.push({
                    campaign_id: campaign.campaign_id,
                    matched_rule: rules.event_type,
                    reward_type: campaign.reward_type,
                    reward_value: campaign.reward_value,
                    calculated_reward: calculatedReward
                });

                // Prepare reward for DB insertion
                rewards.push({
                    reward_id: `rw_${event_id}_${campaign.campaign_id}`,
                    user_id,
                    campaign_id: campaign.campaign_id,
                    value: calculatedReward,
                    type: campaign.reward_type
                });
            }
        }

        // Write rewards to DB
        for (const reward of rewards) {
            try {
                await pool.query(
                    "INSERT INTO rewards (reward_id, user_id, campaign_id, value, type) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (reward_id) DO NOTHING", [reward.reward_id, reward.user_id, reward.campaign_id, reward.value, reward.type]
                );
                console.log("Reward saved", { reward_id: reward.reward_id, value: reward.value });
            } catch (err) {
                console.error("Failed to save reward:", err);
            }
        }

        // Log the evaluation
        console.log("Event evaluation", {
            event_id,
            user_id,
            type,
            eligible_count: eligible.length
        });

        return res.status(200).json({
            status: "evaluated",
            event_id,
            user_id,
            eligible_campaigns: eligible
        });
    } catch (err) {
        console.error("Rule evaluation error:", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

// GET /evaluate/:user_id - Check eligibility for a user
app.get("/evaluate/:user_id", async(req, res) => {
    const { user_id } = req.params;

    try {
        const result = await pool.query("SELECT user_id FROM events WHERE user_id = $1 LIMIT 1", [user_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ status: "not_found" });
        }

        return res.json({ status: "ok", user_id });
    } catch (err) {
        return res.status(500).json({ status: "error" });
    }
});

// ── POST /campaigns/search — Vector similarity search ───────
app.post("/campaigns/search", async(req, res) => {
    if (!openai) {
        return res.status(503).json({ status: "error", message: "OPENAI_API_KEY not configured" });
    }

    const { query, embedding: providedEmbedding, limit } = req.body;
    const topK = Math.min(limit || 5, 20);
    const requestId = `search-${Date.now()}`;
    const startTime = Date.now();

    if (!query && !providedEmbedding) {
        return res.status(400).json({ status: "invalid", message: "Provide 'query' (text) or 'embedding' (vector)" });
    }

    try {
        let embeddingVector;

        if (providedEmbedding && Array.isArray(providedEmbedding)) {
            embeddingVector = providedEmbedding;
        } else {
            // Generate embedding from query text
            const embResponse = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: query,
            });
            embeddingVector = embResponse.data[0].embedding;

            const durationMs = Date.now() - startTime;
            await logOpenAIRequest(
                requestId,
                EMBEDDING_MODEL,
                "/v1/embeddings",
                query.substring(0, 1000),
                JSON.stringify({ embedding_size: embeddingVector.length }),
                200,
                null,
                durationMs
            );
        }

        const vectorStr = `[${embeddingVector.join(",")}]`;

        const result = await pool.query(
            `SELECT
                ce.campaign_id,
                ce.content,
                1 - (ce.embedding <=> $1::vector) AS similarity,
                c.name,
                c.category,
                c.reward_type,
                c.reward_value
             FROM campaign_embeddings ce
             JOIN campaigns c ON c.campaign_id = ce.campaign_id
             ORDER BY ce.embedding <=> $1::vector
             LIMIT $2`, [vectorStr, topK]
        );

        return res.json({
            status: "ok",
            query: query || "(provided embedding)",
            results: result.rows.map((r) => ({
                campaign_id: r.campaign_id,
                name: r.name,
                category: r.category,
                reward_type: r.reward_type,
                reward_value: r.reward_value,
                similarity: parseFloat(parseFloat(r.similarity).toFixed(4)),
                content: r.content,
            })),
        });
    } catch (err) {
        const durationMs = Date.now() - startTime;

        // Log error
        await logOpenAIRequest(
            requestId,
            EMBEDDING_MODEL,
            "/v1/embeddings",
            query ? .substring(0, 1000) || "(provided embedding)",
            null,
            err.status || 500,
            err.message,
            durationMs
        );

        console.error("Campaign search error:", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

const port = process.env.RULE_ENGINE_PORT || process.env.PORT || 8000;
app.listen(port, () => {
    console.log(`Rule Engine listening on ${port}`);
});