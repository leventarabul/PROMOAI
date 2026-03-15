/**
 * Behavior Aggregator — Core aggregation logic
 *
 * Reads events + customer_profiles tables,
 * computes metrics, and upserts into customer_behavior_summary.
 */

/**
 * Run the full aggregation for all active customers.
 * Returns per-customer before/after comparison.
 */
export async function runAggregation(pool) {
    const startTime = Date.now();

    // 1. Fetch current (old) values
    const oldRows = await pool.query(
        `SELECT customer_id, total_events, total_spend, avg_order_value,
                favorite_categories, last_purchase_date, purchase_frequency
         FROM customer_behavior_summary`
    );
    const oldMap = {};
    for (const row of oldRows.rows) {
        oldMap[row.customer_id] = {
            total_events: Number(row.total_events),
            total_spend: Number(row.total_spend),
            avg_order_value: Number(row.avg_order_value),
            favorite_categories: row.favorite_categories || [],
            last_purchase_date: row.last_purchase_date,
            purchase_frequency: row.purchase_frequency,
        };
    }

    // 2. Compute new aggregation from events table
    const aggResult = await pool.query(`
        WITH active_customers AS (
            SELECT customer_id FROM customer_profiles WHERE is_active = TRUE
        ),
        event_stats AS (
            SELECT
                ac.customer_id,
                COUNT(e.event_id) AS total_events,
                COALESCE(
                    SUM(CASE
                        WHEN e.type = 'purchase' THEN e.amount
                        WHEN e.type = 'return' THEN -e.amount
                        ELSE 0
                    END), 0
                ) AS total_spend,
                COALESCE(
                    AVG(e.amount) FILTER (WHERE e.type = 'purchase' AND e.amount IS NOT NULL), 0
                ) AS avg_order_value,
                MAX(e.timestamp) FILTER (WHERE e.type = 'purchase') AS last_purchase_date
            FROM active_customers ac
            LEFT JOIN events e ON e.user_id = ac.customer_id
            GROUP BY ac.customer_id
        ),
        category_ranked AS (
            SELECT
                e.user_id AS customer_id,
                e.category,
                COUNT(*) AS cat_count,
                ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY COUNT(*) DESC) AS rn
            FROM events e
            JOIN customer_profiles cp ON cp.customer_id = e.user_id AND cp.is_active = TRUE
            WHERE e.category IS NOT NULL
            GROUP BY e.user_id, e.category
        ),
        top_categories AS (
            SELECT
                customer_id,
                array_agg(category ORDER BY rn) AS favorite_categories
            FROM category_ranked
            WHERE rn <= 3
            GROUP BY customer_id
        ),
        purchase_dates AS (
            SELECT
                e.user_id AS customer_id,
                e.timestamp AS purchase_ts,
                LAG(e.timestamp) OVER (PARTITION BY e.user_id ORDER BY e.timestamp) AS prev_purchase_ts
            FROM events e
            JOIN customer_profiles cp ON cp.customer_id = e.user_id AND cp.is_active = TRUE
            WHERE e.type = 'purchase'
              AND e.timestamp >= NOW() - INTERVAL '90 days'
        ),
        freq_calc AS (
            SELECT
                customer_id,
                AVG(EXTRACT(EPOCH FROM (purchase_ts - prev_purchase_ts)) / 86400.0) AS avg_days_between
            FROM purchase_dates
            WHERE prev_purchase_ts IS NOT NULL
            GROUP BY customer_id
        )
        SELECT
            es.customer_id,
            es.total_events,
            ROUND(es.total_spend::numeric, 2) AS total_spend,
            ROUND(es.avg_order_value::numeric, 2) AS avg_order_value,
            COALESCE(tc.favorite_categories, ARRAY[]::text[]) AS favorite_categories,
            es.last_purchase_date,
            CASE
                WHEN fc.avg_days_between IS NULL THEN 'rare'
                WHEN fc.avg_days_between <= 10 THEN 'weekly'
                WHEN fc.avg_days_between <= 21 THEN 'biweekly'
                WHEN fc.avg_days_between <= 45 THEN 'monthly'
                ELSE 'rare'
            END AS purchase_frequency,
            ROUND(COALESCE(fc.avg_days_between, 0)::numeric, 1) AS avg_days_between
        FROM event_stats es
        LEFT JOIN top_categories tc ON tc.customer_id = es.customer_id
        LEFT JOIN freq_calc fc ON fc.customer_id = es.customer_id
        ORDER BY es.customer_id
    `);

    // 3. Upsert each customer and build results
    const results = [];
    let updated = 0;

    for (const row of aggResult.rows) {
        await pool.query(
            `INSERT INTO customer_behavior_summary
                (customer_id, total_events, total_spend, avg_order_value,
                 favorite_categories, last_purchase_date, purchase_frequency, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (customer_id) DO UPDATE SET
                total_events = EXCLUDED.total_events,
                total_spend = EXCLUDED.total_spend,
                avg_order_value = EXCLUDED.avg_order_value,
                favorite_categories = EXCLUDED.favorite_categories,
                last_purchase_date = EXCLUDED.last_purchase_date,
                purchase_frequency = EXCLUDED.purchase_frequency,
                updated_at = NOW()`, [
                row.customer_id,
                row.total_events,
                row.total_spend,
                row.avg_order_value,
                row.favorite_categories,
                row.last_purchase_date,
                row.purchase_frequency,
            ]
        );

        const old = oldMap[row.customer_id] || {
            total_events: 0,
            total_spend: 0,
            avg_order_value: 0,
            favorite_categories: [],
            last_purchase_date: null,
            purchase_frequency: 'none',
        };

        const changed =
            old.total_events !== Number(row.total_events) ||
            old.total_spend !== Number(row.total_spend) ||
            old.purchase_frequency !== row.purchase_frequency;

        results.push({
            customer_id: row.customer_id,
            changed,
            old: {
                total_events: old.total_events,
                total_spend: old.total_spend,
                avg_order_value: old.avg_order_value,
                favorite_categories: old.favorite_categories,
                purchase_frequency: old.purchase_frequency,
            },
            new: {
                total_events: Number(row.total_events),
                total_spend: Number(row.total_spend),
                avg_order_value: Number(row.avg_order_value),
                favorite_categories: row.favorite_categories,
                last_purchase_date: row.last_purchase_date,
                purchase_frequency: row.purchase_frequency,
                avg_days_between: Number(row.avg_days_between),
            },
        });

        updated += 1;
    }

    const duration = Date.now() - startTime;

    return {
        status: 'ok',
        customersProcessed: aggResult.rows.length,
        customersUpdated: updated,
        duration,
        results,
    };
}

/**
 * Get summary stats about current behavior data.
 */
export async function getStats(pool) {
    const [behaviorR, eventR, customerR] = await Promise.all([
        pool.query(`
            SELECT
                COUNT(*) AS total_customers,
                ROUND(AVG(total_spend)::numeric, 2) AS avg_spend,
                ROUND(AVG(total_events)::numeric, 0) AS avg_events,
                MAX(updated_at) AS last_updated
            FROM customer_behavior_summary
        `),
        pool.query(`
            SELECT
                COUNT(*) AS total_events,
                COUNT(DISTINCT user_id) AS unique_users,
                MIN(timestamp) AS earliest_event,
                MAX(timestamp) AS latest_event
            FROM events
        `),
        pool.query(`SELECT COUNT(*) AS active_customers FROM customer_profiles WHERE is_active = TRUE`),
    ]);

    return {
        behavior: {
            total_customers: Number(behaviorR.rows[0].total_customers),
            avg_spend: Number(behaviorR.rows[0].avg_spend) || 0,
            avg_events: Number(behaviorR.rows[0].avg_events) || 0,
            last_updated: behaviorR.rows[0].last_updated,
        },
        events: {
            total_events: Number(eventR.rows[0].total_events),
            unique_users: Number(eventR.rows[0].unique_users),
            earliest_event: eventR.rows[0].earliest_event,
            latest_event: eventR.rows[0].latest_event,
        },
        active_customers: Number(customerR.rows[0].active_customers),
    };
}