const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const cors = require('cors');
const pg = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const pool = new pg.Pool({
    user: process.env.POSTGRES_USER || 'promoai',
    password: process.env.POSTGRES_PASSWORD || 'promoai',
    database: process.env.POSTGRES_DB || 'campaign',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
});

const TREND_URL = process.env.TREND_SERVICE_URL || 'http://localhost:3006';
const CONTEXT_URL = process.env.CONTEXT_SERVICE_URL || 'http://localhost:3005';
const ASSIGNMENT_URL = process.env.ASSIGNMENT_SERVICE_URL || 'http://localhost:3004';
const BEHAVIOR_URL = process.env.BEHAVIOR_SERVICE_URL || 'http://localhost:3008';

// ─────────────────────── Proxy Routes ───────────────────────

app.post('/api/trends/detect', async(_req, res) => {
    try {
        const r = await fetch(`${TREND_URL}/admin/detect-now`, { method: 'POST' });
        res.json(await r.json());
    } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/trends/stats', async(_req, res) => {
    try {
        const r = await fetch(`${TREND_URL}/admin/stats?hours=48`);
        res.json(await r.json());
    } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/contexts/active', async(_req, res) => {
    try {
        const r = await fetch(`${CONTEXT_URL}/contexts/active`);
        res.json(await r.json());
    } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/assignments/run', async(req, res) => {
    try {
        const r = await fetch(`${ASSIGNMENT_URL}/assign/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body || {}),
        });
        res.json(await r.json());
    } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─────────────────────── Behavior Aggregation ───────────────────────

app.post('/api/behavior/aggregate', async(_req, res) => {
    try {
        const r = await fetch(`${BEHAVIOR_URL}/aggregate/run`, { method: 'POST' });
        res.json(await r.json());
    } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/behavior/stats', async(_req, res) => {
    try {
        const [behaviorR, eventR, customerR] = await Promise.all([
            pool.query(`
                SELECT customer_id, total_events, total_spend, avg_order_value,
                       favorite_categories, last_purchase_date, purchase_frequency, updated_at
                FROM customer_behavior_summary
                ORDER BY customer_id`),
            pool.query(`
                SELECT COUNT(*) AS total_events, COUNT(DISTINCT user_id) AS unique_users,
                       MIN(timestamp) AS earliest, MAX(timestamp) AS latest
                FROM events`),
            pool.query(`
                SELECT cp.customer_id, cp.segment, cp.age_range, cp.location
                FROM customer_profiles cp WHERE cp.is_active = TRUE
                ORDER BY cp.customer_id`),
        ]);
        res.json({
            customers: behaviorR.rows,
            events: eventR.rows[0],
            profiles: customerR.rows,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────── DB Query Routes ───────────────────────

app.get('/api/customers', async(_req, res) => {
    try {
        const r = await pool.query(`
            SELECT cp.customer_id, cp.segment, cp.age_range, cp.location, cp.preferences,
                   cbs.total_spend, cbs.avg_order_value, cbs.favorite_categories, cbs.purchase_frequency
            FROM customer_profiles cp
            LEFT JOIN customer_behavior_summary cbs ON cbs.customer_id = cp.customer_id
            WHERE cp.is_active = TRUE
            ORDER BY cp.customer_id`);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/campaigns', async(_req, res) => {
    try {
        const r = await pool.query(`SELECT campaign_id, name, category, reward_type, reward_value FROM campaigns ORDER BY campaign_id`);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/assignments/results', async(_req, res) => {
    try {
        const r = await pool.query(`
            SELECT a.assignment_id, a.user_id, a.campaign_id, a.reason, a.status, a.created_at,
                   c.name AS campaign_name, c.category, c.reward_type, c.reward_value,
                   cp.segment, cp.location, cp.age_range, cp.preferences
            FROM assignments a
            JOIN campaigns c ON c.campaign_id = a.campaign_id
            LEFT JOIN customer_profiles cp ON cp.customer_id = a.user_id
            WHERE a.status = 'active'
            ORDER BY a.user_id, a.created_at DESC`);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────── Embedding Stats ───────────────────────

app.get('/api/embeddings/stats', async(_req, res) => {
    try {
        const [ce, cu, co] = await Promise.all([
            pool.query('SELECT count(*) FROM campaign_embeddings WHERE embedding IS NOT NULL'),
            pool.query('SELECT count(*) FROM customer_embeddings WHERE profile_embedding IS NOT NULL'),
            pool.query('SELECT count(*) FROM context_embeddings'),
        ]);
        res.json({
            campaigns: Number(ce.rows[0].count),
            customers: Number(cu.rows[0].count),
            contexts: Number(co.rows[0].count),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────── 3D Scatter (PCA) ───────────────────────

app.get('/api/embeddings/scatter', async(_req, res) => {
    try {
        const [campR, custR, ctxR] = await Promise.all([
            pool.query(`SELECT ce.campaign_id AS id, ce.embedding::text AS vec, ce.content,
                               c.name AS label, c.category
                        FROM campaign_embeddings ce
                        JOIN campaigns c ON c.campaign_id = ce.campaign_id
                        WHERE ce.embedding IS NOT NULL`),
            pool.query(`SELECT ce.customer_id AS id, ce.profile_embedding::text AS vec, ce.content,
                               cp.segment, cp.age_range, cp.location
                        FROM customer_embeddings ce
                        JOIN customer_profiles cp ON cp.customer_id = ce.customer_id
                        WHERE ce.profile_embedding IS NOT NULL`),
            pool.query(`SELECT ce.context_id AS id, ce.embedding::text AS vec, ce.content,
                               sc.name AS label, sc.priority
                        FROM context_embeddings ce
                        JOIN seasonal_contexts sc ON sc.context_id = ce.context_id`),
        ]);

        const points = [];
        const vectors = [];

        for (const row of campR.rows) {
            vectors.push(JSON.parse(row.vec));
            points.push({ id: row.id, label: row.label, type: 'campaign', category: row.category });
        }
        for (const row of custR.rows) {
            vectors.push(JSON.parse(row.vec));
            points.push({ id: row.id, label: `${row.id} (${row.segment})`, type: 'customer', segment: row.segment, location: row.location });
        }
        for (const row of ctxR.rows) {
            vectors.push(JSON.parse(row.vec));
            points.push({ id: row.id, label: row.label, type: 'context', priority: row.priority });
        }

        if (vectors.length < 3) {
            return res.json({ points: [], message: 'En az 3 embedding gerekli. Önce trend ve assignment job çalıştırın.' });
        }

        const coords = pcaProject(vectors, 3);
        coords.forEach((c, i) => {
            points[i].x = c[0];
            points[i].y = c[1];
            points[i].z = c[2];
        });

        res.json({
            points,
            stats: { campaigns: campR.rows.length, customers: custR.rows.length, contexts: ctxR.rows.length, total: vectors.length },
        });
    } catch (e) {
        console.error('PCA error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────── Simple PCA via Gram matrix + power iteration ───────────

function pcaProject(data, nComp) {
    const n = data.length;
    const d = data[0].length;

    // 1. Mean
    const mean = new Float64Array(d);
    for (const row of data)
        for (let j = 0; j < d; j++) mean[j] += row[j];
    for (let j = 0; j < d; j++) mean[j] /= n;

    // 2. Center
    const centered = data.map(row => {
        const c = new Float64Array(d);
        for (let j = 0; j < d; j++) c[j] = row[j] - mean[j];
        return c;
    });

    // 3. Gram matrix (n × n) — much smaller than d × d covariance
    const G = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            let dot = 0;
            for (let k = 0; k < d; k++) dot += centered[i][k] * centered[j][k];
            G[i][j] = dot;
            G[j][i] = dot;
        }
    }

    // 4. Power iteration for top eigenvectors
    const Gw = G.map(r => Float64Array.from(r));
    const eigenvalues = [];
    const eigenvectors = [];
    const realComp = Math.min(nComp, n - 1);

    for (let comp = 0; comp < realComp; comp++) {
        let v = new Float64Array(n);
        // deterministic seed
        for (let i = 0; i < n; i++) v[i] = Math.sin(i * (comp + 1) * 0.7 + 0.3);
        let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        for (let i = 0; i < n; i++) v[i] /= norm;

        for (let iter = 0; iter < 200; iter++) {
            const w = new Float64Array(n);
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) w[i] += Gw[i][j] * v[j];
            norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
            if (norm < 1e-12) break;
            for (let i = 0; i < n; i++) v[i] = w[i] / norm;
        }

        // eigenvalue
        const Gv = new Float64Array(n);
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) Gv[i] += Gw[i][j] * v[j];
        let lambda = 0;
        for (let i = 0; i < n; i++) lambda += v[i] * Gv[i];

        eigenvalues.push(lambda);
        eigenvectors.push(Float64Array.from(v));

        // deflate
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) Gw[i][j] -= lambda * v[i] * v[j];
    }

    // 5. Project to nComp-d
    return data.map((_, i) => {
        const coords = [];
        for (let c = 0; c < realComp; c++) {
            coords.push(eigenvectors[c][i] * Math.sqrt(Math.max(eigenvalues[c], 0)));
        }
        while (coords.length < nComp) coords.push(0);
        return coords;
    });
}

// ─────────────────────── Start ───────────────────────

const PORT = Number(process.env.DASHBOARD_PORT || 3007);

pool.query('SELECT 1').then(() => {
    app.listen(PORT, () => {
        console.log(`\n🎨 PromoAI Demo Dashboard`);
        console.log(`   http://localhost:${PORT}`);
        console.log(`   Trend Service:      ${TREND_URL}`);
        console.log(`   Context Service:    ${CONTEXT_URL}`);
        console.log(`   Assignment Service: ${ASSIGNMENT_URL}`);
        console.log(`   Behavior Service:   ${BEHAVIOR_URL}\n`);
    });
}).catch(err => {
    console.error('DB connection failed:', err.message);
    process.exit(1);
});