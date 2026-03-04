/**
 * Seed script: bulk-embed all existing campaigns into campaign_embeddings.
 * Usage: npm run seed  (or: node src/seed.js)
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import OpenAI from "openai";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT,
    OPENAI_API_KEY,
} = process.env;

if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required. Set it in .env");
    process.exit(1);
}

const pool = new pg.Pool({
    user: POSTGRES_USER || "promoai",
    password: POSTGRES_PASSWORD || "promoai",
    database: POSTGRES_DB || "campaign",
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432),
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-ada-002";

function buildCampaignText(c) {
    const parts = [
        `Campaign: ${c.name}`,
        c.category ? `Category: ${c.category}` : null,
        c.reward_type ? `Reward Type: ${c.reward_type}` : null,
        c.reward_value != null ? `Reward Value: ${c.reward_value}` : null,
        c.rule_json ? `Rules: ${JSON.stringify(c.rule_json)}` : null,
    ];
    return parts.filter(Boolean).join(". ");
}

async function generateEmbedding(text, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: text,
            });
            return response.data[0].embedding;
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.pow(2, attempt) * 500;
            console.warn(`Retry ${attempt}/${retries} in ${delay}ms...`, err.message);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

async function main() {
    console.log("Seeding campaign embeddings...");

    const { rows: campaigns } = await pool.query(
        "SELECT campaign_id, name, category, reward_type, reward_value, rule_json FROM campaigns"
    );

    console.log(`Found ${campaigns.length} campaigns`);

    let success = 0;
    let failed = 0;

    for (const campaign of campaigns) {
        try {
            const text = buildCampaignText(campaign);
            console.log(`  [${campaign.campaign_id}] "${text}"`);

            const embedding = await generateEmbedding(text);
            const vectorStr = `[${embedding.join(",")}]`;

            await pool.query(
                `INSERT INTO campaign_embeddings (campaign_id, embedding, content, updated_at)
         VALUES ($1, $2::vector, $3, NOW())
         ON CONFLICT (campaign_id) DO UPDATE
           SET embedding = EXCLUDED.embedding,
               content = EXCLUDED.content,
               updated_at = NOW()`, [campaign.campaign_id, vectorStr, text]
            );

            success++;
        } catch (err) {
            console.error(`  [${campaign.campaign_id}] FAILED:`, err.message);
            failed++;
        }
    }

    console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
    await pool.end();
}

main().catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
});