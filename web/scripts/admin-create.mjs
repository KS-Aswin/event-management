// Creates an admin account, or promotes an existing account to admin.
// Idempotent: running it again for the same email changes nothing.
//
//   npm run admin:create -- --email owner@example.com [--name "Owner Name"]
//   npm run admin:create -- owner@example.com
//
// A NEW account needs a password: it is read from the ADMIN_PASSWORD
// environment variable, or asked for on the terminal (input hidden). It is
// never printed or logged. An existing account keeps its password.
//
// Safety: refuses a DATABASE_URL that is not localhost unless --allow-remote
// is passed (so it is never run against a live database by accident). It
// will not promote an account that owns a vendor listing (one role per
// account) or a suspended/deleted account.

import readline from "node:readline";
import { Writable } from "node:stream";
import bcrypt from "bcryptjs";
import pg from "pg";

const SALT_ROUNDS = 10; // same as lib/password.ts
const MIN_PASSWORD = 12;

function usage(msg) {
  if (msg) console.error(`✗ ${msg}\n`);
  console.error(
    'Usage: npm run admin:create -- --email you@example.com [--name "Your Name"] [--allow-remote]\n' +
      "       (a bare email also works). New accounts take the password from ADMIN_PASSWORD or a hidden prompt."
  );
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const out = { email: null, name: null, allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage();
    else if (a === "--allow-remote") out.allowRemote = true;
    else if (a === "--email") out.email = argv[++i] ?? null;
    else if (a.startsWith("--email=")) out.email = a.slice(8);
    else if (a === "--name") out.name = argv[++i] ?? null;
    else if (a.startsWith("--name=")) out.name = a.slice(7);
    else if (!a.startsWith("--") && !out.email) out.email = a;
    else usage(`Unknown argument: ${a}`);
  }
  return out;
}

function isLocalDb(url) {
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("No terminal to ask for a password. Set ADMIN_PASSWORD for this command instead."));
      return;
    }
    let muted = false;
    const out = new Writable({
      write(chunk, enc, cb) {
        if (!muted) process.stdout.write(chunk, enc);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readNewPassword() {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (fromEnv.length < MIN_PASSWORD) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.`);
    return fromEnv;
  }
  const first = await promptHidden(`Password for the new admin (min ${MIN_PASSWORD} characters): `);
  if (first.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  const again = await promptHidden("Repeat the password: ");
  if (again !== first) throw new Error("The passwords did not match.");
  return first;
}

const args = parseArgs(process.argv.slice(2));
const email = (args.email ?? "").trim().toLowerCase();
if (!email) usage("An email is required.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) usage(`Not a valid email: ${email}`);
const name = (args.name ?? "").trim();
if (name.length > 100) usage("The name is too long (max 100 characters).");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL not found in the environment or .env.local.");
  process.exit(1);
}
if (!isLocalDb(connectionString) && !args.allowRemote) {
  console.error("✗ DATABASE_URL is not a localhost database. Re-run with --allow-remote if you really mean it.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
let exitCode = 0;
try {
  await client.connect();
  const existing = (
    await client.query("SELECT id, name, role, status FROM users WHERE lower(email) = $1 LIMIT 1", [email])
  ).rows[0];

  if (existing) {
    if (existing.role === "admin") {
      console.log(`✓ ${email} is already an admin (user #${existing.id}). Nothing changed.`);
    } else if (existing.status && existing.status !== "active") {
      throw new Error(`${email} is ${existing.status}. Reactivate the account before promoting it.`);
    } else {
      const owned = (await client.query("SELECT id FROM vendors WHERE owner_id = $1 LIMIT 1", [existing.id])).rows[0];
      if (owned) {
        throw new Error(`${email} owns vendor listing #${owned.id}. Use a separate email for the admin account.`);
      }
      await client.query("BEGIN");
      // The role change applies at once (sessions reload the role from the
      // DB); bumping session_version also signs out the old-role sessions.
      await client.query(
        "UPDATE users SET role = 'admin', session_version = session_version + 1 WHERE id = $1",
        [existing.id]
      );
      await client.query(
        `INSERT INTO admin_audit_log (actor_id, action, entity_type, entity_id, before, after, reason)
         VALUES (NULL, 'user.promote_admin', 'user', $1, $2::jsonb, '{"role":"admin"}'::jsonb, 'npm run admin:create')`,
        [String(existing.id), JSON.stringify({ role: existing.role })]
      );
      await client.query("COMMIT");
      console.log(`✓ Promoted ${email} (user #${existing.id}) from ${existing.role} to admin.`);
    }
  } else {
    const password = await readNewPassword();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const displayName = name || email.split("@")[0];
    await client.query("BEGIN");
    const created = (
      await client.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
        [displayName, email, hash]
      )
    ).rows[0];
    await client.query(
      `INSERT INTO admin_audit_log (actor_id, action, entity_type, entity_id, before, after, reason)
       VALUES (NULL, 'user.create_admin', 'user', $1, NULL, $2::jsonb, 'npm run admin:create')`,
      [String(created.id), JSON.stringify({ role: "admin", email })]
    );
    await client.query("COMMIT");
    console.log(`✓ Created admin ${email} (user #${created.id}). Sign in at /login.`);
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`✗ ${err.message}`);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
