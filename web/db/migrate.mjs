// Applies the numbered SQL files in db/migrations/ to DATABASE_URL, in order.
// Each file runs once and is recorded in the schema_migrations table, so it is
// safe to re-run. Run with: npm run db:migrate  (loads DATABASE_URL from .env.local)
//
// (We're not using Prisma Migrate: its engine binaries aren't reachable from
// the dev sandbox network. Plain SQL files + this runner is the simpler
// substitute. See PROJECT_LOG.md.)

import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not found in the environment or .env.local. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const done = new Set(
    (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name)
  );

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✓ Applied ${file}`);
      applied++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`${file}: ${err.message}`);
    }
  }
  console.log(applied === 0 ? "✓ Database already up to date." : `✓ ${applied} migration(s) applied.`);
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
