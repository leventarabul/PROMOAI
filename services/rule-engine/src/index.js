import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PORT
} = process.env;

const pool = new pg.Pool({
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    host: POSTGRES_HOST || "localhost",
    port: Number(POSTGRES_PORT || 5432)
});

const app = express();

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get("/db-health", async(req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
    console.log(`Rule Engine listening on ${port}`);
});