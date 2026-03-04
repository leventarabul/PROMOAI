import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

export function buildCustomerProfileText(profile) {
    const preferences = profile.preferences || {};
    const interests = Array.isArray(preferences.interests) ? preferences.interests.join(", ") : "unknown";
    const channels = Array.isArray(preferences.channels) ? preferences.channels.join(", ") : "unknown";
    const favoriteCategories = Array.isArray(profile.favorite_categories) ? profile.favorite_categories.join(", ") : "unknown";

    return [
        `Customer segment: ${profile.segment || "unknown"}`,
        `Age range: ${profile.age_range || "unknown"}`,
        `Location: ${profile.location || "unknown"}`,
        `Preferred channels: ${channels}`,
        `Interests: ${interests}`,
        `Total spend: ${profile.total_spend ?? 0}`,
        `Average order value: ${profile.avg_order_value ?? 0}`,
        `Favorite categories: ${favoriteCategories}`,
        `Purchase frequency: ${profile.purchase_frequency || "unknown"}`,
    ].join(". ");
}

export async function logOpenAIRequest(pool, payload) {
    const {
        requestId,
        model,
        endpoint,
        requestInput,
        responseOutput,
        statusCode,
        errorMessage,
        durationMs,
    } = payload;

    try {
        await pool.query(
            `INSERT INTO openai_request_logs
                (request_id, model, endpoint, request_input, response_output, status_code, error_message, duration_ms)
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

export async function generateProfileEmbedding({ openai, pool, customerId, text, retries = 3 }) {
    const requestId = `customer-emb-${customerId}-${Date.now()}`;
    const start = Date.now();

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: text,
            });

            const embedding = response.data[0].embedding;
            await logOpenAIRequest(pool, {
                requestId,
                model: EMBEDDING_MODEL,
                endpoint: "/v1/embeddings",
                requestInput: text.substring(0, 1000),
                responseOutput: JSON.stringify({ embedding_size: embedding.length }),
                statusCode: 200,
                errorMessage: null,
                durationMs: Date.now() - start,
            });

            return embedding;
        } catch (err) {
            if (attempt === retries) {
                await logOpenAIRequest(pool, {
                    requestId,
                    model: EMBEDDING_MODEL,
                    endpoint: "/v1/embeddings",
                    requestInput: text.substring(0, 1000),
                    responseOutput: null,
                    statusCode: err.status || 500,
                    errorMessage: err.message,
                    durationMs: Date.now() - start,
                });
                throw err;
            }

            const delay = Math.pow(2, attempt) * 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    return null;
}

export async function upsertCustomerEmbedding(pool, customerId, embedding, content) {
    const vectorStr = `[${embedding.join(",")}]`;
    await pool.query(
        `INSERT INTO customer_embeddings (customer_id, profile_embedding, content, updated_at)
         VALUES ($1, $2::vector, $3, NOW())
         ON CONFLICT (customer_id) DO UPDATE
           SET profile_embedding = EXCLUDED.profile_embedding,
               content = EXCLUDED.content,
               updated_at = NOW()`, [customerId, vectorStr, content]
    );
}

export async function fetchActiveCustomers(pool, customerIds = null) {
    const values = [];
    let whereClause = "WHERE cp.is_active = TRUE";

    if (Array.isArray(customerIds) && customerIds.length > 0) {
        values.push(customerIds);
        whereClause += ` AND cp.customer_id = ANY($${values.length}::text[])`;
    }

    const query = `
      SELECT
        cp.customer_id,
        cp.segment,
        cp.age_range,
        cp.location,
        cp.preferences,
        cbs.total_events,
        cbs.total_spend,
        cbs.avg_order_value,
        cbs.favorite_categories,
        cbs.last_purchase_date,
        cbs.purchase_frequency
      FROM customer_profiles cp
      LEFT JOIN customer_behavior_summary cbs ON cbs.customer_id = cp.customer_id
      ${whereClause}
      ORDER BY cp.customer_id`;

    const result = await pool.query(query, values);
    return result.rows;
}

export async function fetchCandidateCampaigns(pool, embedding, topK = 10) {
    const vectorStr = `[${embedding.join(",")}]`;

    const result = await pool.query(
        `SELECT
            ce.campaign_id,
            c.name,
            c.category,
            c.reward_type,
            c.reward_value,
            c.rule_json,
            ce.content,
            1 - (ce.embedding <=> $1::vector) AS similarity
         FROM campaign_embeddings ce
         JOIN campaigns c ON c.campaign_id = ce.campaign_id
         ORDER BY ce.embedding <=> $1::vector
         LIMIT $2`, [vectorStr, topK]
    );

    if (result.rows.length > 0) {
        return result.rows;
    }

    // Fallback for very small datasets / low-recall ANN index warmup
    const fallback = await pool.query(
        `SELECT
            c.campaign_id,
            c.name,
            c.category,
            c.reward_type,
            c.reward_value,
            c.rule_json,
            COALESCE(ce.content, c.name) AS content,
            0.0 AS similarity
         FROM campaigns c
         LEFT JOIN campaign_embeddings ce ON ce.campaign_id = c.campaign_id
         ORDER BY c.created_at DESC
         LIMIT $1`, [topK]
    );

    return fallback.rows;
}

function buildSelectionPrompt(customer, campaigns, limit) {
    return [
        "You are a campaign assignment engine.",
        "Select the most relevant campaigns for the customer.",
        `Return strict JSON: {\"assignments\":[{\"campaign_id\":\"...\",\"reason\":\"...\"}]}`,
        `Return at most ${limit} assignments.`,
        "Reasons must be short (max 140 chars).",
        "",
        "Customer:",
        JSON.stringify(customer),
        "",
        "Candidate campaigns:",
        JSON.stringify(campaigns),
    ].join("\n");
}

export async function selectCampaignsWithGPT({ openai, pool, customer, campaigns, model, limit }) {
    const requestId = `assignment-gpt-${customer.customer_id}-${Date.now()}`;
    const start = Date.now();
    const prompt = buildSelectionPrompt(customer, campaigns, limit);

    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: "You are a precise JSON API." },
                { role: "user", content: prompt },
            ],
            temperature: 0.2,
        });

        const raw = response.choices ? .[0] ? .message ? .content || "{}";
        await logOpenAIRequest(pool, {
            requestId,
            model,
            endpoint: "/v1/chat/completions",
            requestInput: prompt.substring(0, 1000),
            responseOutput: raw.substring(0, 4000),
            statusCode: 200,
            errorMessage: null,
            durationMs: Date.now() - start,
        });

        const parsed = JSON.parse(raw);
        const selected = Array.isArray(parsed.assignments) ? parsed.assignments : [];

        const valid = selected
            .filter((a) => typeof a ? .campaign_id === "string")
            .slice(0, limit)
            .map((a) => ({
                campaign_id: a.campaign_id,
                reason: typeof a.reason === "string" ? a.reason : "AI-selected campaign",
            }));

        if (valid.length > 0) {
            return valid;
        }
    } catch (err) {
        await logOpenAIRequest(pool, {
            requestId,
            model,
            endpoint: "/v1/chat/completions",
            requestInput: prompt.substring(0, 1000),
            responseOutput: null,
            statusCode: err.status || 500,
            errorMessage: err.message,
            durationMs: Date.now() - start,
        });
    }

    // Fallback: top similarity-based selection
    return campaigns.slice(0, limit).map((c) => ({
        campaign_id: c.campaign_id,
        reason: `Similarity fallback (${Number(c.similarity || 0).toFixed(3)})`,
    }));
}

export async function saveAssignments(pool, customerId, assignments) {
    let inserted = 0;

    for (const assignment of assignments) {
        const existing = await pool.query(
            `SELECT assignment_id
             FROM assignments
             WHERE user_id = $1 AND campaign_id = $2 AND status = 'active'
             LIMIT 1`, [customerId, assignment.campaign_id]
        );

        if (existing.rowCount > 0) {
            continue;
        }

        const assignmentId = `asg_${customerId}_${assignment.campaign_id}_${Date.now()}`;

        await pool.query(
            `INSERT INTO assignments (assignment_id, user_id, campaign_id, reason, status, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`, [assignmentId, customerId, assignment.campaign_id, assignment.reason, "active"]
        );

        inserted += 1;
    }

    return inserted;
}

export function createOpenAIClient(apiKey) {
    return new OpenAI({ apiKey });
}