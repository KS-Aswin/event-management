// Applies db/schema.sql to the database at process.env.DATABASE_URL.
// Run with: node db/migrate.mjs
// (We're not using Prisma Migrate here because Prisma's engine binaries
// aren't reachable from this project's dev sandbox network. Plain SQL
// files + this runner is a deliberate, simpler substitute — see
// PROJECT_LOG.md for the full reasoning.)

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query(sql);
  console.log("✓ Schema applied successfully.");
} catch (err) {
  console.error("✗ Failed to apply schema:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
