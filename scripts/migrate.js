// Applies migrations/*.sql in name order, each once, inside a transaction.
// Run with the schema owner role: DATABASE_MIGRATION_URL, falling back to DATABASE_URL
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
// Arbitrary constant so two concurrent runs don't apply the same migration
const LOCK_ID = 7_431_029;

async function migrate() {
  const connectionString = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL must be set");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.version));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file} failed: ${err.message}`);
      }
    }
    console.log("Migrations up to date");
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
