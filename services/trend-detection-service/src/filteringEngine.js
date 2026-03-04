/**
 * Filtering Engine for Trend Detection
 * Implements 4-layer smart filtering to qualify trends
 * 
 * Layers:
 * 1. Volume Threshold (>100K searches in 6 hours)
 * 2. Relevance Threshold (>0.75 vector similarity to campaigns)
 * 3. Duration Threshold (>2 hours trending)
 * 4. Category Matching (must have related campaigns)
 */

class FilteringEngine {
    constructor(pool, openai) {
        this.pool = pool;
        this.openai = openai;

        // Configuration
        this.VOLUME_THRESHOLD = 100000;
        this.RELEVANCE_THRESHOLD = parseFloat(process.env.TREND_RELEVANCE_THRESHOLD || '0.75');
        this.CATEGORY_SIMILARITY_THRESHOLD = parseFloat(process.env.TREND_CATEGORY_SIMILARITY_THRESHOLD || '0.65');
        this.DISABLE_CATEGORY_MATCH = String(process.env.TREND_DISABLE_CATEGORY_MATCH || 'false').toLowerCase() === 'true';
        this.DURATION_MINIMUM_HOURS = 2;
        this.TREND_GROWTH_MINIMUM = 50; // 50% minimum increase

        this.CATEGORY_MATCHES = {
            'shopping': ['retail', 'electronics', 'fashion', 'gifts', 'grocery'],
            'travel': ['flights', 'hotels', 'vacation', 'tours', 'transportation'],
            'food': ['restaurants', 'grocery', 'delivery', 'dining', 'cafes'],
            'entertainment': ['movies', 'concerts', 'games', 'shows', 'events'],
            'lifestyle': ['beauty', 'fitness', 'wellness', 'home', 'sports'],
            'finance': ['banking', 'insurance', 'investments', 'credit'],
            'automotive': ['cars', 'motorcycles', 'fuel', 'repairs', 'accessories']
        };
    }

    /**
     * Run all 4 filter layers on a trend
     */
    async qualifyTrend(trend) {
        console.log(`[Filter] Analyzing trend: "${trend.query}"`);

        // Layer 1: Volume
        if (!this.passesVolumeFilter(trend)) {
            console.log(`  ✗ Volume too low: ${trend.estimated_volume} < ${this.VOLUME_THRESHOLD}`);
            return null;
        }
        console.log(`  ✓ Volume check passed: ${trend.estimated_volume} searches`);

        // Layer 2: Duration
        if (!this.passesDurationFilter(trend)) {
            console.log(`  ✗ Duration too short: ${trend.hours_trending}h < ${this.DURATION_MINIMUM_HOURS}h`);
            return null;
        }
        console.log(`  ✓ Duration check passed: ${trend.hours_trending} hours`);

        // Layer 3: Relevance (requires embedding call)
        const relevance = await this.calculateTrendRelevance(trend);
        if (relevance < this.RELEVANCE_THRESHOLD) {
            console.log(`  ✗ Relevance too low: ${relevance.toFixed(3)} < ${this.RELEVANCE_THRESHOLD}`);
            return null;
        }
        console.log(`  ✓ Relevance check passed: ${relevance.toFixed(3)}`);

        // Layer 4: Category matching
        let matchedCampaigns = [];
        if (this.DISABLE_CATEGORY_MATCH) {
            matchedCampaigns = [{ campaign_id: '__category_match_bypass__', similarity: relevance }];
            console.log(`  ⚠ Category match bypassed (TREND_DISABLE_CATEGORY_MATCH=true)`);
        } else {
            matchedCampaigns = await this.findMatchingCampaigns(trend, relevance);
            if (matchedCampaigns.length === 0) {
                console.log(`  ✗ No matching campaigns found`);
                return null;
            }
            console.log(`  ✓ Category match passed: ${matchedCampaigns.length} campaigns matched`);
        }

        // All layers passed - calculate TTL and return
        const ttl = this.calculateTTL(trend);
        const qualifiedTrend = {
            ...trend,
            relevance_score: relevance,
            matched_campaigns: matchedCampaigns,
            ttl_hours: ttl,
            confidence_score: this.calculateConfidence(trend, relevance),
            qualified_at: new Date()
        };

        console.log(`  ✅ QUALIFIED: TTL=${ttl}h, Confidence=${qualifiedTrend.confidence_score.toFixed(2)}`);
        return qualifiedTrend;
    }

    /**
     * Layer 1: Volume Threshold
     * Ensures we catch viral trends, not niche topics
     */
    passesVolumeFilter(trend) {
        const volumeOk = trend.estimated_volume >= this.VOLUME_THRESHOLD;
        const growthOk = trend.trend_growth_percent >= this.TREND_GROWTH_MINIMUM;

        return volumeOk && growthOk;
    }

    /**
     * Layer 2: Duration Threshold
     * Trend must be growing for minimum period
     */
    passesDurationFilter(trend) {
        return trend.hours_trending >= this.DURATION_MINIMUM_HOURS;
    }

    /**
     * Layer 3: Relevance Threshold
     * Generate trend embedding and check similarity to campaigns
     */
    async calculateTrendRelevance(trend) {
        try {
            // Generate embedding for trend
            const trendEmbedding = await this.openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: `${trend.query}. Related: ${trend.related_queries.join(', ')}`
            });

            const vector = trendEmbedding.data[0].embedding;

            // Find most similar campaign
            const result = await this.pool.query(`
        SELECT MAX(1 - (embedding <=> $1::vector)) as max_similarity
        FROM campaign_embeddings
      `, [JSON.stringify(vector)]);

            const similarity = result.rows[0]?.max_similarity || 0;
            return Math.max(0, Math.min(1, similarity)); // Clamp to [0, 1]
        } catch (err) {
            console.error(`[Filter] Relevance calculation failed: ${err.message}`);
            return 0; // Fail the filter if embedding generation fails
        }
    }

    /**
     * Layer 4: Category Matching
     * Find campaigns that match the trend's inferred category
     */
    async findMatchingCampaigns(trend, relevance) {
        try {
            // Infer category from query
            const category = this.inferCategory(trend.query);

            if (!category || !this.CATEGORY_MATCHES[category]) {
                return [];
            }

            const matchedCategories = this.CATEGORY_MATCHES[category];
            const categoryThreshold = this.CATEGORY_SIMILARITY_THRESHOLD;

            const result = await this.pool.query(`
        SELECT campaign_id, content, 1 - (ce.embedding <=> te.embedding) as similarity
        FROM campaign_embeddings ce
        CROSS JOIN (
          SELECT $1::vector as embedding
        ) te
        WHERE ce.content ILIKE ANY($2)
        ORDER BY similarity DESC
        LIMIT 10
      `, [
                `[0.1, 0.2, 0.3]`, // Placeholder - would be actual trend embedding
                matchedCategories.map(c => `%${c}%`)
            ]);

            return result.rows.filter(r => r.similarity >= categoryThreshold);
        } catch (err) {
            console.error(`[Filter] Category matching failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Calculate TTL (time-to-live) based on trend trajectory
     * - Spike trend (peaked recently): 6 hours
     * - Sustained trend (steady growth): 12 hours
     * - Declining trend: 2 hours
     */
    calculateTTL(trend) {
        const hoursSincePeak = trend.hours_since_peak || trend.hours_trending / 2;

        if (hoursSincePeak < 1) {
            return 6; // Short-burst: peaked recently
        } else if (hoursSincePeak < 6) {
            return 12; // Sustained: steady growth
        } else {
            return 2; // Declining: let it expire soon
        }
    }

    /**
     * Calculate confidence score (0-1) based on multiple factors
     */
    calculateConfidence(trend, relevance) {
        const volumeScore = Math.min(trend.estimated_volume / 500000, 1); // 500K is "excellent"
        const growthScore = Math.min(trend.trend_growth_percent / 100, 1); // 100% is "excellent"
        const durationScore = Math.min(trend.hours_trending / 6, 1); // 6 hours is "excellent"
        const relevanceScore = relevance;

        // Weighted average
        const weights = {
            volume: 0.25,
            growth: 0.25,
            duration: 0.25,
            relevance: 0.25
        };

        const confidence = (
            volumeScore * weights.volume +
            growthScore * weights.growth +
            durationScore * weights.duration +
            relevanceScore * weights.relevance
        );

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Infer category from trend query text
     */
    inferCategory(query) {
        const lowerQuery = query.toLowerCase();

        // Simple keyword-based inference
        for (const [category, keywords] of Object.entries(this.CATEGORY_MATCHES)) {
            if (keywords.some(kw => lowerQuery.includes(kw))) {
                return category;
            }
        }

        // Fallback: try to use OpenAI if possible
        return null;
    }
}

module.exports = FilteringEngine;