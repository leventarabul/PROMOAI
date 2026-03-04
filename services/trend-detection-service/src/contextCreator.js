/**
 * Context Creator for Automatic Seasonal Context Creation
 * Creates seasonal_contexts entries from qualified trends
 */

class ContextCreator {
    constructor(pool, openai) {
        this.pool = pool;
        this.openai = openai;
    }

    /**
     * Create auto-context from a qualified trend
     */
    async createAutoContext(trend) {
        console.log(`[Context] Creating auto-context for: "${trend.query}"`);

        try {
            // Build context metadata
            const context = this.buildContextMetadata(trend);

            // Insert into database
            const result = await this.pool.query(`
        INSERT INTO seasonal_contexts (
          name, 
          description, 
          start_date, 
          end_date, 
          priority, 
          tags, 
          metadata, 
          is_auto_generated,
          trend_source,
          ttl_hours,
          expires_at,
          trend_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING context_id
      `, [
                context.name,
                context.description,
                context.start_date,
                context.end_date,
                context.priority,
                context.tags,
                JSON.stringify(context.metadata),
                true, // is_auto_generated
                'google_trends',
                context.ttl_hours,
                context.expires_at,
                JSON.stringify(context.trend_metadata)
            ]);

            const contextId = result.rows[0].context_id;
            console.log(`  ✓ Context created: ${contextId}`);

            return {
                context_id: contextId,
                ...context
            };
        } catch (err) {
            console.error(`[Context] Creation failed: ${err.message}`);
            throw err;
        }
    }

    /**
     * Build metadata for a trend context
     */
    buildContextMetadata(trend) {
        const now = new Date();
        const ttlMs = trend.ttl_hours * 3600000;
        const expiresAt = new Date(now.getTime() + ttlMs);

        // Friendly name from trend
        const friendlyName = trend.query
            .toLowerCase()
            .replace(/\s+/g, '_')
            .substring(0, 50);

        const contextName = `flash_trend_${friendlyName}_${Date.now() % 10000}`;

        // Build tags
        const tags = [
            'trending',
            'flash',
            'auto-generated',
            ...this.inferTags(trend.query),
            ...(trend.related_queries || []).slice(0, 2)
        ];

        // Build metadata object
        const metadata = {
            boost_categories: this.inferCategories(trend.query),
            behavior_patterns: ['surge_interest', 'trending_topic', 'viral'],
            campaign_themes: this.inferCampaignThemes(trend),
            context_type: trend.is_sustained ? 'sustained' : 'spike'
        };

        // Build trend metadata for tracking
        const trend_metadata = {
            trend_query: trend.query,
            trend_growth_percent: trend.trend_growth_percent,
            estimated_volume: trend.estimated_volume,
            hours_trending: trend.hours_trending,
            hours_since_peak: trend.hours_since_peak,
            related_queries: (trend.related_queries || []).slice(0, 5),
            confidence_score: trend.confidence_score,
            relevance_score: trend.relevance_score,
            matched_campaigns_count: (trend.matched_campaigns || []).length,
            associated_campaigns: (trend.matched_campaigns || []).slice(0, 5).map(c => ({
                campaign_id: c.campaign_id,
                similarity: c.similarity
            })),
            detection_timestamp: new Date().toISOString(),
            expires_at: expiresAt.toISOString()
        };

        return {
            name: contextName,
            description: `Trending: ${trend.query} (${trend.estimated_volume.toLocaleString()} searches)`,
            start_date: now.toISOString().split('T')[0], // Today
            end_date: expiresAt.toISOString().split('T')[0], // TTL days
            priority: 15, // Higher than seasonal contexts (1-10)
            tags,
            metadata,
            trend_metadata,
            ttl_hours: trend.ttl_hours,
            expires_at: expiresAt
        };
    }

    /**
     * Infer relevant tags from trend query
     */
    inferTags(query) {
        const lowerQuery = query.toLowerCase();
        const tags = [];

        // Common keywords to tags
        const keywordMap = {
            'summer': 'season_summer',
            'winter': 'season_winter',
            'spring': 'season_spring',
            'fall': 'season_fall',
            'sale': 'discount',
            'deals': 'discount',
            'discount': 'discount',
            'free': 'free_offer',
            'limited': 'limited_time',
            'new': 'new_product',
            'launch': 'new_product',
            'flash': 'flash_sale',
            'travel': 'category_travel',
            'shopping': 'category_shopping',
            'electronics': 'category_electronics',
            'fashion': 'category_fashion',
            'food': 'category_food',
            'dining': 'category_food'
        };

        for (const [keyword, tag] of Object.entries(keywordMap)) {
            if (lowerQuery.includes(keyword)) {
                tags.push(tag);
            }
        }

        return [...new Set(tags)]; // Deduplicate
    }

    /**
     * Infer relevant campaign categories
     */
    inferCategories(query) {
        const lowerQuery = query.toLowerCase();
        const categories = [];

        const categoryMap = {
            'travel': ['travel', 'flights', 'hotels', 'vacation'],
            'electronics': ['electronics', 'gadgets', 'laptop', 'phone', 'tech'],
            'fashion': ['fashion', 'clothing', 'apparel', 'shoes', 'dress'],
            'grocery': ['grocery', 'food', 'shopping', 'supermarket'],
            'dining': ['restaurant', 'food', 'dining', 'cafe'],
            'retail': ['shopping', 'retail', 'store', 'mall']
        };

        for (const [category, keywords] of Object.entries(categoryMap)) {
            if (keywords.some(kw => lowerQuery.includes(kw))) {
                categories.push(category);
            }
        }

        return [...new Set(categories)];
    }

    /**
     * Generate campaign themes matching the trend
     */
    inferCampaignThemes(trend) {
        const themes = [];
        const query = trend.query.toLowerCase();

        // Theme inference
        if (query.includes('travel') || query.includes('flight') || query.includes('hotel')) {
            themes.push('summer_travel', 'flight_deals', 'vacation_packages');
        }
        if (query.includes('electronic') || query.includes('tech') || query.includes('gadget')) {
            themes.push('tech_sale', 'electronic_deals', 'gadget_offers');
        }
        if (query.includes('school') || query.includes('back')) {
            themes.push('back_to_school', 'school_supplies');
        }
        if (query.includes('sale') || query.includes('deal') || query.includes('discount')) {
            themes.push('seasonal_sale', 'flash_sale');
        }
        if (query.includes('summer')) {
            themes.push('summer_promo', 'season_summer');
        }

        return [...new Set(themes)];
    }

    /**
     * Generate embeddings for created contexts
     * Calls context-service API
     */
    async generateEmbedding(contextId, contextServiceUrl = 'http://localhost:3005') {
        try {
            console.log(`[Context] Generating embedding for: ${contextId}`);

            const response = await require('axios').post(
                `${contextServiceUrl}/contexts/generate-embeddings`, { context_ids: [contextId] }, { timeout: 10000 }
            );

            console.log(`  ✓ Embedding generated`);
            return response.data;
        } catch (err) {
            console.error(`[Context] Embedding generation failed: ${err.message}`);
            // Non-fatal - context is created even if embedding fails
            return null;
        }
    }

    /**
     * Batch create contexts and embeddings from qualified trends
     */
    async createMultipleContexts(qualifiedTrends, generateEmbeddings = true) {
        const created = [];

        for (const trend of qualifiedTrends) {
            try {
                const context = await this.createAutoContext(trend);
                created.push(context);

                if (generateEmbeddings) {
                    await this.generateEmbedding(context.context_id);
                }
            } catch (err) {
                console.error(`[Context] Batch creation error for "${trend.query}": ${err.message}`);
                // Continue with next trend
            }
        }

        console.log(`[Context] Batch complete: ${created.length}/${qualifiedTrends.length} contexts created`);
        return created;
    }
}

module.exports = ContextCreator;