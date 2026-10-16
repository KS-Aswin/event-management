// Promotes an existing account to admin.
// Run with: npm run db:make-admin -- someone@example.com
// (Admins can never be created through the public signup form.)

import pg from "pg";

const email = process.argv[2]?.toLowerCase().trim();
const connectionString = process.env.DATABASE_URL;

if (!email) {
  console.error("Usage: npm run db:make-admin -- someone@example.com");
  process.exit(1);
}
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const res = await client.query("UPDATE users SET role = 'admin' WHERE email = $1 RETURNING id, name", [email]);
  if (res.rowCount === 0) {
    console.error(`No account found for ${email}. Sign up first, then run this again.`);
    process.exit(1);
  }
  console.log(`✓ ${res.rows[0].name} (${email}) is now an admin. They need to sign in again.`);
} catch (err) {
  console.error("✗ Failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
