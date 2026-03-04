/**
 * Context Service
 * 
 * Microservice for managing seasonal/temporal contexts
 * - Scheduled jobs to sync active contexts daily
 * - API endpoints for context management
 * - Embedding generation for context matching
 */

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cron = require("node-cron");

const {
    generateAllContextEmbeddings,
    syncActiveContexts,
    getActiveContexts,
    createSeasonalContext,
} = require("./contextManager");

const app = express();
app.use(express.json());

// Database connection
const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    user: process.env.POSTGRES_USER || "promoai",
    password: process.env.POSTGRES_PASSWORD || "promoai",
    database: process.env.POSTGRES_DB || "campaign",
});

// ============================================================================
// Scheduled Jobs
// ============================================================================

// Daily context sync at 1:00 AM (before assignment job at 2:00 AM)
cron.schedule(process.env.CONTEXT_SYNC_CRON || "0 1 * * *", async() => {
    console.log(`\n[CRON] Context sync started at ${new Date().toISOString()}`);

    try {
        await syncActiveContexts(pool);
        console.log("[CRON] Context sync completed successfully");
    } catch (err) {
        console.error("[CRON] Context sync failed:", err.message);
    }
});

// Weekly embedding generation for new contexts (Sundays at 3:00 AM)
cron.schedule("0 3 * * 0", async() => {
    console.log(`\n[CRON] Embedding generation started at ${new Date().toISOString()}`);

    try {
        await generateAllContextEmbeddings(pool);
        console.log("[CRON] Embedding generation completed successfully");
    } catch (err) {
        console.error("[CRON] Embedding generation failed:", err.message);
    }
});

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * Health check
 */
app.get("/health", async(req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({
            status: "ok",
            service: "context-service",
            database: "connected",
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({
            status: "error",
            service: "context-service",
            database: "disconnected",
            error: err.message
        });
    }
});

/**
 * Get currently active contexts
 * Used by assignment-service to fetch contexts for GPT prompts
 */
app.get("/contexts/active", async(req, res) => {
    try {
        const contexts = await getActiveContexts(pool);

        res.json({
            status: "ok",
            count: contexts.length,
            contexts: contexts.map(c => ({
                context_id: c.context_id,
                name: c.name,
                description: c.description,
                priority: c.priority,
                tags: c.tags,
                metadata: c.metadata,
                context_content: c.context_content,
            })),
        });
    } catch (err) {
        console.error("Failed to fetch active contexts:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to fetch active contexts",
            error: err.message
        });
    }
});

/**
 * Get all seasonal contexts
 */
app.get("/contexts", async(req, res) => {
    try {
        const result = await pool.query(`
      SELECT 
        sc.context_id,
        sc.name,
        sc.description,
        sc.start_date,
        sc.end_date,
        sc.priority,
        sc.tags,
        sc.metadata,
        ac.status as active_status,
        CASE WHEN ce.context_id IS NOT NULL THEN true ELSE false END as has_embedding
      FROM seasonal_contexts sc
      LEFT JOIN active_contexts ac ON sc.context_id = ac.context_id
      LEFT JOIN context_embeddings ce ON sc.context_id = ce.context_id
      ORDER BY sc.start_date DESC
    `);

        res.json({
            status: "ok",
            count: result.rows.length,
            contexts: result.rows,
        });
    } catch (err) {
        console.error("Failed to fetch contexts:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to fetch contexts",
            error: err.message
        });
    }
});

/**
 * Create a new seasonal context
 */
app.post("/contexts", async(req, res) => {
    try {
        const { name, description, start_date, end_date, priority, tags, metadata } = req.body;

        if (!name || !description || !start_date || !end_date) {
            return res.status(400).json({
                status: "error",
                message: "Missing required fields: name, description, start_date, end_date",
            });
        }

        const contextId = await createSeasonalContext({
            pool,
            name,
            description,
            startDate: start_date,
            endDate: end_date,
            priority: priority || 5,
            tags: tags || [],
            metadata: metadata || {},
        });

        res.status(201).json({
            status: "ok",
            message: "Context created successfully",
            context_id: contextId,
        });
    } catch (err) {
        console.error("Failed to create context:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to create context",
            error: err.message
        });
    }
});

/**
 * Manually trigger context sync
 */
app.post("/contexts/sync", async(req, res) => {
    try {
        console.log("Manual context sync triggered");

        const activeContexts = await syncActiveContexts(pool);

        res.json({
            status: "ok",
            message: "Context sync completed",
            active_contexts: activeContexts.map(c => ({
                context_id: c.ret_context_id,
                name: c.ret_name,
                action: c.ret_action,
            })),
        });
    } catch (err) {
        console.error("Context sync failed:", err.message);
        res.status(500).json({
            status: "error",
            message: "Context sync failed",
            error: err.message
        });
    }
});

/**
 * Manually trigger embedding generation
 */
app.post("/contexts/generate-embeddings", async(req, res) => {
    try {
        console.log("Manual embedding generation triggered");

        await generateAllContextEmbeddings(pool);

        res.json({
            status: "ok",
            message: "Embedding generation completed",
        });
    } catch (err) {
        console.error("Embedding generation failed:", err.message);
        res.status(500).json({
            status: "error",
            message: "Embedding generation failed",
            error: err.message
        });
    }
});

// ============================================================================
// Admin API Endpoints for Context Management
// ============================================================================

/**
 * Get context details by ID
 */
app.get("/admin/contexts/:contextId", async(req, res) => {
    try {
        const { contextId } = req.params;

        const result = await pool.query(`
      SELECT 
        sc.context_id,
        sc.name,
        sc.description,
        sc.start_date,
        sc.end_date,
        sc.priority,
        sc.tags,
        sc.metadata,
        ac.status as active_status,
        ac.activated_at,
        ac.deactivated_at,
        CASE WHEN ce.context_id IS NOT NULL THEN true ELSE false END as has_embedding
      FROM seasonal_contexts sc
      LEFT JOIN active_contexts ac ON sc.context_id = ac.context_id
      LEFT JOIN context_embeddings ce ON sc.context_id = ce.context_id
      WHERE sc.context_id = $1
    `, [contextId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Context not found",
            });
        }

        res.json({
            status: "ok",
            context: result.rows[0],
        });
    } catch (err) {
        console.error("Failed to fetch context:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to fetch context",
            error: err.message
        });
    }
});

/**
 * Update a seasonal context
 */
app.put("/admin/contexts/:contextId", async(req, res) => {
    try {
        const { contextId } = req.params;
        const { name, description, start_date, end_date, priority, tags, metadata } = req.body;

        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;

        if (name !== undefined) {
            updateFields.push(`name = $${paramCount++}`);
            updateValues.push(name);
        }
        if (description !== undefined) {
            updateFields.push(`description = $${paramCount++}`);
            updateValues.push(description);
        }
        if (start_date !== undefined) {
            updateFields.push(`start_date = $${paramCount++}`);
            updateValues.push(start_date);
        }
        if (end_date !== undefined) {
            updateFields.push(`end_date = $${paramCount++}`);
            updateValues.push(end_date);
        }
        if (priority !== undefined) {
            updateFields.push(`priority = $${paramCount++}`);
            updateValues.push(priority);
        }
        if (tags !== undefined) {
            updateFields.push(`tags = $${paramCount++}`);
            updateValues.push(tags);
        }
        if (metadata !== undefined) {
            updateFields.push(`metadata = $${paramCount++}`);
            updateValues.push(JSON.stringify(metadata));
        }

        updateFields.push(`updated_at = NOW()`);
        updateValues.push(contextId);

        const result = await pool.query(
            `UPDATE seasonal_contexts 
       SET ${updateFields.join(", ")}
       WHERE context_id = $${paramCount}
       RETURNING *`,
            updateValues
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Context not found",
            });
        }

        res.json({
            status: "ok",
            message: "Context updated successfully",
            context: result.rows[0],
        });
    } catch (err) {
        console.error("Failed to update context:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to update context",
            error: err.message
        });
    }
});

/**
 * Delete a seasonal context
 */
app.delete("/admin/contexts/:contextId", async(req, res) => {
    try {
        const { contextId } = req.params;

        const result = await pool.query(
            `DELETE FROM seasonal_contexts WHERE context_id = $1 RETURNING context_id`,
            [contextId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Context not found",
            });
        }

        res.json({
            status: "ok",
            message: "Context deleted successfully",
            deleted_context_id: contextId,
        });
    } catch (err) {
        console.error("Failed to delete context:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to delete context",
            error: err.message
        });
    }
});

/**
 * Get context statistics
 */
app.get("/admin/stats", async(req, res) => {
    try {
        const contextCount = await pool.query(`SELECT COUNT(*) as count FROM seasonal_contexts`);
        const activeCount = await pool.query(`SELECT COUNT(*) as count FROM active_contexts WHERE status = 'active'`);
        const embeddingCount = await pool.query(`SELECT COUNT(*) as count FROM context_embeddings`);
        const upcomingCount = await pool.query(`
      SELECT COUNT(*) as count FROM seasonal_contexts 
      WHERE start_date > CURRENT_DATE AND end_date > CURRENT_DATE
    `);

        res.json({
            status: "ok",
            stats: {
                total_contexts: contextCount.rows[0].count,
                active_contexts: activeCount.rows[0].count,
                contexts_with_embeddings: embeddingCount.rows[0].count,
                upcoming_contexts: upcomingCount.rows[0].count,
            },
        });
    } catch (err) {
        console.error("Failed to fetch stats:", err.message);
        res.status(500).json({
            status: "error",
            message: "Failed to fetch statistics",
            error: err.message
        });
    }
});

// ============================================================================
// Startup
// ============================================================================

const PORT = process.env.CONTEXT_SERVICE_PORT || 3005;

app.listen(PORT, async() => {
    console.log(`\n🌍 Context Service started on port ${PORT}`);
    console.log(`📅 Context sync cron: ${process.env.CONTEXT_SYNC_CRON || "0 1 * * *"} (daily at 1:00 AM)`);
    console.log(`🔄 Embedding generation cron: 0 3 * * 0 (Sundays at 3:00 AM)`);

    // Initial sync on startup
    try {
        console.log("\n=== Initial Context Sync ===");
        await syncActiveContexts(pool);

        console.log("\n=== Checking Context Embeddings ===");
        await generateAllContextEmbeddings(pool);

        console.log("\n✅ Context service ready\n");
    } catch (err) {
        console.error("❌ Startup initialization failed:", err.message);
    }
});

// Graceful shutdown
process.on("SIGTERM", async() => {
    console.log("SIGTERM received, closing database pool...");
    await pool.end();
    process.exit(0);
});

process.on("SIGINT", async() => {
    console.log("\nSIGINT received, closing database pool...");
    await pool.end();
    process.exit(0);
});