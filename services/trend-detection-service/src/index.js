/**
 * Trend Detection Service - Express Server
 * Port: 3006
 * Cron Jobs:
 * - 00:00, 06:00, 12:00, 18:00 UTC: 6-hourly trend detection
 * - 01:00 UTC daily: Cleanup expired auto-contexts
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const { OpenAI } = require('openai');

const TrendDetector = require('./trendDetector');

// Configuration
const PORT = process.env.TREND_DETECTION_PORT || 3006;
const DB_HOST = process.env.POSTGRES_HOST || 'localhost';
const DB_PORT = process.env.POSTGRES_PORT || 5432;
const DB_USER = process.env.POSTGRES_USER || 'promoai';
const DB_PASSWORD = process.env.POSTGRES_PASSWORD || 'promoai';
const DB_NAME = process.env.POSTGRES_DB || 'campaign';

// Initialize Express
const app = express();
app.use(express.json());

// Initialize PostgreSQL pool
const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err);
});

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize TrendDetector
let trendDetector;
const initializeTrendDetector = () => {
    trendDetector = new TrendDetector(pool, openai, {
        apiChoice: process.env.TREND_API_CHOICE || 'pytrends',
        semrushKey: process.env.SEMRUSH_API_KEY,
        country: process.env.TREND_DETECTION_COUNTRY || 'TR',
        contextServiceUrl: process.env.CONTEXT_SERVICE_URL || 'http://localhost:3005'
    });
};

// ============================================================================
// Health & Status Endpoints
// ============================================================================

app.get('/health', async(req, res) => {
    try {
        // Check database connection
        const dbCheck = await pool.query('SELECT NOW()');

        // Get last run from logs
        const lastRun = await pool.query(`
      SELECT * FROM trend_detection_logs
      ORDER BY run_timestamp DESC
      LIMIT 1
    `);

        res.json({
            status: 'ok',
            service: 'trend-detection-service',
            version: '1.0.0',
            database: 'connected',
            lastRun: lastRun.rows[0] ? {
                timestamp: lastRun.rows[0].run_timestamp,
                status: lastRun.rows[0].status,
                contextsCreated: lastRun.rows[0].auto_contexts_created
            } : null,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            service: 'trend-detection-service',
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ============================================================================
// Admin Endpoints
// ============================================================================

/**
 * GET /admin/stats
 * Get trend detection statistics
 */
app.get('/admin/stats', async(req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const stats = await trendDetector.getStats(hours);
        const lastRun = await trendDetector.getLastRun();

        res.json({
            status: 'ok',
            stats: {
                ...stats,
                period_hours: hours
            },
            lastRun,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(400).json({
            status: 'error',
            error: err.message
        });
    }
});

/**
 * POST /admin/detect-now
 * Manually trigger trend detection (useful for testing)
 */
app.post('/admin/detect-now', async(req, res) => {
    try {
        console.log('[API] Manual trend detection triggered');
        const result = await trendDetector.runDetection();

        res.json({
            status: result.status,
            ...result,
            message: `Trend detection completed`
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            error: err.message
        });
    }
});

/**
 * GET /admin/logs
 * Get recent detection logs
 */
app.get('/admin/logs', async(req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;

        const result = await pool.query(`
      SELECT * FROM trend_detection_logs
      ORDER BY run_timestamp DESC
      LIMIT $1
    `, [limit]);

        res.json({
            status: 'ok',
            logs: result.rows,
            count: result.rows.length
        });
    } catch (err) {
        res.status(400).json({
            status: 'error',
            error: err.message
        });
    }
});

/**
 * POST /admin/cleanup-now
 * Manually trigger cleanup of expired contexts
 */
app.post('/admin/cleanup-now', async(req, res) => {
    try {
        console.log('[API] Manual cleanup triggered');

        const result = await pool.query('SELECT deleted_count FROM cleanup_expired_auto_contexts()');
        const deletedCount = result.rows[0]?.deleted_count || 0;

        res.json({
            status: 'ok',
            message: `Cleaned up ${deletedCount} expired contexts`,
            deleted_count: deletedCount,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            error: err.message
        });
    }
});

// ============================================================================
// Cron Jobs
// ============================================================================

// 6-hourly trend detection: 00:00, 06:00, 12:00, 18:00 UTC
cron.schedule('0 0,6,12,18 * * *', async() => {
    console.log('\n[CRON] 6-hourly trend detection triggered');
    try {
        await trendDetector.runDetection();
    } catch (err) {
        console.error(`[CRON] Trend detection failed: ${err.message}`);
    }
});

// Daily cleanup: 01:00 UTC (after 00:00 trend detection completes)
cron.schedule('0 1 * * *', async() => {
    console.log('\n[CRON] Daily cleanup triggered');
    try {
        const result = await pool.query('SELECT deleted_count FROM cleanup_expired_auto_contexts()');
        const deletedCount = result.rows[0]?.deleted_count || 0;
        console.log(`[CRON] Cleanup: Deleted ${deletedCount} expired contexts`);
    } catch (err) {
        console.error(`[CRON] Cleanup failed: ${err.message}`);
    }
});

// ============================================================================
// Server Startup
// ============================================================================

const server = app.listen(PORT, () => {
    console.log(`\n[${'═'.repeat(60)}]`);
    console.log(`[TREND DETECTION SERVICE]`);
    console.log(`[${'═'.repeat(60)}]`);
    console.log(`✓ Server listening on port ${PORT}`);
    console.log(`✓ Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
    console.log(`✓ Cron: 6-hourly detection (00:00, 06:00, 12:00, 18:00 UTC)`);
    console.log(`✓ Cron: Daily cleanup at 01:00 UTC`);
    console.log(`[${'═'.repeat(60)}]\n`);

    // Initialize trend detector
    initializeTrendDetector();
    console.log(`✓ TrendDetector initialized\n`);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

const gracefulShutdown = async(signal) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);

    // Stop accepting new requests
    server.close(() => {
        console.log('[Server] HTTP server closed');
    });

    // Close database connections
    try {
        await pool.end();
        console.log('[DB] Connection pool closed');
    } catch (err) {
        console.error(`[DB] Error closing pool: ${err.message}`);
    }

    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// Error Handling
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
    process.exit(1);
});

module.exports = app;