/**
 * Context Manager
 * 
 * Core logic for managing seasonal contexts:
 * - Generate embeddings for contexts
 * - Activate/deactivate contexts based on date ranges
 * - Retrieve active contexts for assignment service
 */

const { OpenAI } = require("openai");
const { Pool } = require("pg");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate embedding for a seasonal context
 */
async function generateContextEmbedding({ pool, contextId, retries = 3 }) {
    console.log(`[${contextId}] Generating context embedding...`);

    // Fetch context details
    const contextResult = await pool.query(
        `SELECT context_id, name, description, tags, metadata 
     FROM seasonal_contexts 
     WHERE context_id = $1`, [contextId]
    );

    if (contextResult.rows.length === 0) {
        throw new Error(`Context ${contextId} not found`);
    }

    const context = contextResult.rows[0];

    // Build rich text representation
    const contentParts = [
        `Context: ${context.name}`,
        `Description: ${context.description}`,
        `Tags: ${context.tags.join(", ")}`,
    ];
    
    if (context.metadata?.boost_categories) {
        contentParts.push(`Relevant categories: ${context.metadata.boost_categories.join(", ")}`);
    }

    if (context.metadata?.behavior_patterns) {
        contentParts.push(`Behavior patterns: ${context.metadata.behavior_patterns.join(", ")}`);
    }

    if (context.metadata?.campaign_themes) {
        contentParts.push(`Campaign themes: ${context.metadata.campaign_themes.join(", ")}`);
    }

    const content = contentParts.join("\n");

    // Generate embedding with retry logic
    let embedding;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const startTime = Date.now();

            const response = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: content,
            });

            const duration = Date.now() - startTime;
            embedding = response.data[0].embedding;

            console.log(`[${contextId}] Embedding generated (${duration}ms, ${embedding.length}d)`);

            // Log to database
            await pool.query(
                `INSERT INTO openai_request_logs (request_id, model, endpoint, request_input, duration_ms, status_code, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [
                    `context_emb_${contextId}_${Date.now()}`,
                    "text-embedding-3-small",
                    "/v1/embeddings",
                    content.substring(0, 500),
                    duration,
                    200,
                ]
            );

            break; // Success
        } catch (err) {
            console.error(`[${contextId}] Embedding attempt ${attempt}/${retries} failed:`, err.message);

            if (attempt === retries) throw err;

            // Exponential backoff
            const delay = Math.pow(2, attempt) * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Store embedding
    await pool.query(
        `INSERT INTO context_embeddings (context_id, embedding, content, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (context_id) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       content = EXCLUDED.content,
       updated_at = NOW()`, [contextId, JSON.stringify(embedding), content]
    );

    console.log(`[${contextId}] Embedding stored in context_embeddings table`);

    return embedding;
}

/**
 * Generate embeddings for all seasonal contexts
 */
async function generateAllContextEmbeddings(pool) {
    console.log("=== Generating Embeddings for All Contexts ===");

    const result = await pool.query(
        `SELECT context_id FROM seasonal_contexts 
     WHERE context_id NOT IN (SELECT context_id FROM context_embeddings)`
    );

    if (result.rows.length === 0) {
        console.log("All contexts already have embeddings");
        return;
    }

    console.log(`Found ${result.rows.length} contexts without embeddings`);

    for (const row of result.rows) {
        try {
            await generateContextEmbedding({ pool, contextId: row.context_id });
        } catch (err) {
            console.error(`Failed to generate embedding for ${row.context_id}:`, err.message);
        }
    }

    console.log("=== Context Embeddings Generation Complete ===");
}

/**
 * Activate/deactivate contexts based on current date
 */
async function syncActiveContexts(pool) {
    console.log("=== Syncing Active Contexts ===");

    try {
        const result = await pool.query("SELECT * FROM activate_current_contexts()");

        if (result.rows.length === 0) {
            console.log("No active contexts for current date");
        } else {
            console.log(`Active contexts (${result.rows.length}):`);
            result.rows.forEach(row => {
                console.log(`  - ${row.ret_name} (${row.ret_context_id}): ${row.ret_action}`);
            });
        }

        return result.rows;
    } catch (err) {
        console.error("Failed to sync active contexts:", err.message);
        throw err;
    }
}

/**
 * Get currently active contexts with embeddings
 */
async function getActiveContexts(pool) {
    const result = await pool.query(`
    SELECT 
      sc.context_id,
      sc.name,
      sc.description,
      sc.priority,
      sc.tags,
      sc.metadata,
      ce.content as context_content,
      ce.embedding
    FROM active_contexts ac
    JOIN seasonal_contexts sc ON ac.context_id = sc.context_id
    LEFT JOIN context_embeddings ce ON sc.context_id = ce.context_id
    WHERE ac.status = 'active'
      AND CURRENT_DATE BETWEEN sc.start_date AND sc.end_date
    ORDER BY sc.priority DESC
  `);

    return result.rows;
}

/**
 * Create a new seasonal context
 */
async function createSeasonalContext({ pool, name, description, startDate, endDate, priority = 5, tags = [], metadata = {} }) {
    console.log(`Creating seasonal context: ${name}`);

    const result = await pool.query(
        `INSERT INTO seasonal_contexts (name, description, start_date, end_date, priority, tags, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING context_id`, [name, description, startDate, endDate, priority, tags, JSON.stringify(metadata)]
    );

    const contextId = result.rows[0].context_id;
    console.log(`Context created with ID: ${contextId}`);

    // Generate embedding for new context
    await generateContextEmbedding({ pool, contextId });

    // Check if context should be active now
    await syncActiveContexts(pool);

    return contextId;
}

module.exports = {
    generateContextEmbedding,
    generateAllContextEmbeddings,
    syncActiveContexts,
    getActiveContexts,
    createSeasonalContext,
};