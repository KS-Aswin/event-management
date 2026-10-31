// Runs before and after the suite: removes users (and what they own) created
// by e2e runs, so the API suite's counts on the seeded vendors keep passing.
// Only ever talks to a localhost DATABASE_URL.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export const E2E_EMAIL_REGEX = "^e2e-(customer|vendor|admin)-[0-9a-z-]+@example[.]com$";

function isLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  // Workers inherit this, so every test in a run derives the same test users.
  process.env.E2E_RUN_ID ??= Date.now().toString(36);
  // Fresh per-screen log for this run (read by the HTML report script).
  fs.rmSync(path.resolve(__dirname, "..", "playwright-report", "screens.jsonl"), { force: true });
  await cleanup();
}

export async function cleanup() {
  const url = process.env.DATABASE_URL;
  if (!isLocal(url)) {
    console.log("(e2e cleanup skipped: DATABASE_URL missing or not localhost)");
    return;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("BEGIN");
    const users = await client.query("SELECT id FROM users WHERE email ~ $1", [E2E_EMAIL_REGEX]);
    const ids = users.rows.map((r) => r.id);
    if (ids.length) {
      const gone = await client.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[]) RETURNING id", [ids]);
      // Uploaded files (local storage driver) live under uploads/vendors/<id>.
      const uploads = path.resolve(process.env.UPLOADS_DIR || path.resolve(__dirname, "..", "uploads"));
      for (const row of gone.rows) fs.rmSync(path.join(uploads, "vendors", String(row.id)), { recursive: true, force: true });
      await client.query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
      await client.query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[])", [ids]);
      await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    }
    await client.query("DELETE FROM quote_requests WHERE message LIKE 'E2E run %'");
    await client.query("COMMIT");
    if (ids.length) console.log(`(e2e cleanup: removed ${ids.length} test users and their data)`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log(`(e2e cleanup failed: ${(err as Error).message})`);
  } finally {
    await client.end().catch(() => {});
  }
}
