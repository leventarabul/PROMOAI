/**
 * Trend Detector - Core Service Logic
 * Orchestrates: fetch → filter → create contexts → generate embeddings
 */

const FilteringEngine = require('./filteringEngine');
const ContextCreator = require('./contextCreator');
const TrendAPIClient = require('./apiClient');

class TrendDetector {
    constructor(pool, openai, options = {}) {
        this.pool = pool;
        this.openai = openai;

        this.apiClient = new TrendAPIClient({
            apiChoice: options.apiChoice || 'newsapi',
            semrushKey: options.semrushKey,
            newsApiKey: options.newsApiKey,
            country: options.country || 'TR'
        });

        this.filteringEngine = new FilteringEngine(pool, openai);
        this.contextServiceUrl = options.contextServiceUrl || 'http://localhost:3005';
        this.contextCreator = new ContextCreator(pool, openai, { contextServiceUrl: this.contextServiceUrl });
    }

    /**
     * Run complete trend detection cycle
     * Returns: { status, trendsFound, trendsFiltered, contextsCreated, duration, error }
     */
    async runDetection() {
        const startTime = Date.now();
        console.log(`\n[${'═'.repeat(60)}]`);
        console.log(`[TREND DETECTION] Started at ${new Date().toISOString()}`);
        console.log(`[${'═'.repeat(60)}]`);

        const result = {
            status: 'running',
            trendsFound: 0,
            trendsFiltered: 0,
            contextsCreated: 0,
            duration: 0,
            error: null,
            details: {}
        };

        try {
            // Step 1: Fetch raw trends
            console.log(`\n[STEP 1/4] Fetching trend data...`);
            const rawTrends = await this.fetchTrendsWithFallback();
            result.trendsFound = rawTrends.length;
            console.log(`✓ Found ${rawTrends.length} raw trends`);

            // Step 2: Apply smart filters
            console.log(`\n[STEP 2/4] Applying smart filters (4 layers)...`);
            const qualifiedTrends = await this.filterTrendsParallel(rawTrends);
            result.trendsFiltered = qualifiedTrends.length;
            console.log(`✓ Qualified ${qualifiedTrends.length} trends`);

            // Step 3: Create auto-contexts
            if (qualifiedTrends.length > 0) {
                console.log(`\n[STEP 3/4] Creating auto-contexts...`);
                const createdContexts = await this.contextCreator.createMultipleContexts(
                    qualifiedTrends,
                    true // Generate embeddings
                );
                result.contextsCreated = createdContexts.length;
                result.details.contexts = createdContexts;
            }

            result.status = 'success';
            result.duration = Date.now() - startTime;

            // Step 4: Log results
            console.log(`\n[STEP 4/4] Logging results...`);
            await this.logDetectionRun(result);

            console.log(`\n✅ DETECTION COMPLETE`);
        } catch (err) {
            console.error(`\n❌ DETECTION FAILED: ${err.message}`);
            result.status = 'error';
            result.error = err.message;
            result.duration = Date.now() - startTime;

            // Log error
            await this.logDetectionRun(result);
        }

        // Print summary
        this.printSummary(result);

        return result;
    }

    /**
     * Fetch trends with fallback strategy
     */
    async fetchTrendsWithFallback() {
        try {
            const trends = await this.apiClient.fetchTrends();
            if (trends && trends.length > 0) {
                return trends;
            }
        } catch (err) {
            console.warn(`[Fetch] Primary API failed: ${err.message}`);
        }

        // Fallback: return empty array
        console.warn(`[Fetch] No trends retrieved, skipping this cycle`);
        return [];
    }

    /**
     * Apply filters in parallel (faster)
     */
    async filterTrendsParallel(trends) {
        const qualified = [];

        // Process in batches of 5
        const batchSize = 5;
        for (let i = 0; i < trends.length; i += batchSize) {
            const batch = trends.slice(i, i + batchSize);

            const results = await Promise.allSettled(
                batch.map(trend => this.filteringEngine.qualifyTrend(trend))
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    qualified.push(result.value);
                }
            }
        }

        return qualified;
    }

    /**
     * Log detection run to database
     */
    async logDetectionRun(result) {
        try {
            await this.pool.query(`
        INSERT INTO trend_detection_logs (
          run_timestamp,
          trends_found,
          trends_filtered,
          auto_contexts_created,
          status,
          error_message,
          duration_ms,
          details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
                new Date(),
                result.trendsFound,
                result.trendsFiltered,
                result.contextsCreated,
                result.status,
                result.error || null,
                result.duration,
                JSON.stringify(result.details)
            ]);
        } catch (err) {
            console.error(`[Log] Failed to insert detection log: ${err.message}`);
        }
    }

    /**
     * Print summary to console
     */
    printSummary(result) {
        console.log(`\n[${'═'.repeat(60)}]`);
        console.log(`[SUMMARY]`);
        console.log(`[${'═'.repeat(60)}]`);
        console.log(`Status:       ${result.status.toUpperCase()}`);
        console.log(`Duration:     ${result.duration}ms`);
        console.log(`Trends Found: ${result.trendsFound}`);
        console.log(`Qualified:    ${result.trendsFiltered}`);
        console.log(`Contexts:     ${result.contextsCreated}`);

        if (result.error) {
            console.log(`Error:        ${result.error}`);
        }

        console.log(`[${'═'.repeat(60)}]\n`);
    }

    /**
     * Check last detection run from database
     */
    async getLastRun() {
        try {
            const result = await this.pool.query(`
        SELECT * FROM trend_detection_logs
        ORDER BY run_timestamp DESC
        LIMIT 1
      `);

            return result.rows[0] || null;
        } catch (err) {
            console.error(`[LastRun] Query failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Get stats from trend_detection_logs
     */
    async getStats(hours = 24) {
        try {
            const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_runs,
          SUM(trends_found) as total_trends_found,
          SUM(trends_filtered) as total_trends_filtered,
          SUM(auto_contexts_created) as total_contexts_created,
          AVG(duration_ms) as avg_duration_ms,
          MAX(duration_ms) as max_duration_ms
        FROM trend_detection_logs
        WHERE run_timestamp > NOW() - INTERVAL '1 hour' * $1
      `, [hours]);

            return result.rows[0];
        } catch (err) {
            console.error(`[Stats] Query failed: ${err.message}`);
            return null;
        }
    }
}

module.exports = TrendDetector;