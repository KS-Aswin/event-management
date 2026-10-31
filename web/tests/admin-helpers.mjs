// Shared helpers for the admin API tests (tests/admin-*.test.mjs, run with
// `npm run test:admin` against a running dev server: BASE_URL, default
// http://localhost:3000). LOCAL ONLY: refuses a non-localhost BASE_URL or
// DATABASE_URL.
//
// Users created here are always admtest-<prefix>-<digits>@example.com, and
// cleanup(prefix) deletes only those users and what they own. Audit rows are
// append-only (DB trigger), so they are never deleted: when a test admin is
// deleted, admin_audit_log.actor_id becomes NULL (ON DELETE SET NULL, the one
// update the trigger allows) and the other actor columns are SET NULL too
// (migration 005). Tests therefore count audit rows by entity / action and
// an id watermark (auditWatermark()), never by deleting them.
//
//   import { createAdmin, makeVendor, request, countAudit, cleanup } from "./admin-helpers.mjs";
//   const admin = await createAdmin("vendq");          // { cookie, userId, email, password }
//   const mark = await auditWatermark();
//   const r = await request("/api/admin/today", { cookie: admin.cookie });
//   await countAudit({ action: "vendor.approve", entityId: 12, afterId: mark }); // -> 1
//   after(() => cleanup("vendq"));

import pg from "pg";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const RUN_ID = Date.now();
export const TEST_PASSWORD = "admtest-password-123";
const DATABASE_URL = process.env.DATABASE_URL;
// Per-run client IP so the server's per-IP rate limits (register, login)
// start fresh each run. Only works because the local server trusts it.
export const TEST_IP = `10.${Math.floor(RUN_ID / 65536) % 256}.${Math.floor(RUN_ID / 256) % 256}.${RUN_ID % 256}`;

export function isLocalUrl(url) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
if (!isLocalUrl(BASE_URL)) throw new Error(`Refusing to run against non-local BASE_URL ${BASE_URL}`);
if (!DATABASE_URL || !isLocalUrl(DATABASE_URL)) {
  throw new Error("DATABASE_URL must be set and point at localhost (npm run test:admin loads .env.local)");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * request(path, { method, body, cookie, headers }) -> { status, data, text, cookie, headers }
 * JSON body in, parsed JSON out (data is null for non-JSON). Never follows
 * redirects (status 307/308 + headers.location). `cookie` is the
 * "vela_session=..." string returned by the login helpers.
 */
export async function request(urlPath, { method = "GET", body, cookie, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-Forwarded-For": TEST_IP,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // HTML or empty body
  }
  const raw = res.headers.get("set-cookie");
  return {
    status: res.status,
    data,
    text,
    cookie: raw ? raw.split(";")[0] : null,
    headers: { location: res.headers.get("location"), cacheControl: res.headers.get("cache-control") },
  };
}

// ---------------------------------------------------------------------------
// DB (local only)
// ---------------------------------------------------------------------------

let _pool = null;
/** Shared pg Pool for the LOCAL test DB: `await db().query(sql, params)`. */
export function db() {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, idleTimeoutMillis: 1000, allowExitOnIdle: true });
  }
  return _pool;
}

/** Closes the shared pool (call in after() if a test file keeps running). */
export async function closeDb() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end().catch(() => {});
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkPrefix(prefix) {
  if (!/^[a-z0-9]+$/.test(prefix)) throw new Error(`prefix must be [a-z0-9]+ (got ${prefix})`);
}

/** Regex (Postgres ~) for the test users of a prefix. */
export function emailPattern(prefix) {
  checkPrefix(prefix);
  return `^admtest-${escapeRegex(prefix)}-[0-9]+@example\\.com$`;
}

let seq = 0;
/** A fresh admtest-<prefix>-<digits>@example.com address. */
export function testEmail(prefix) {
  checkPrefix(prefix);
  seq += 1;
  return `admtest-${prefix}-${RUN_ID}${String(seq).padStart(3, "0")}@example.com`;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** POST /api/auth/register; returns { status, cookie, userId, email, password, data }. */
export async function signup({ prefix, role = "customer", name, email, password = TEST_PASSWORD }) {
  const addr = email ?? testEmail(prefix);
  const r = await request("/api/auth/register", {
    method: "POST",
    body: { name: name ?? `Admtest ${role}`, email: addr, password, role },
  });
  return { status: r.status, cookie: r.cookie, userId: r.data?.user?.id ?? null, email: addr, password, data: r.data };
}

/** POST /api/auth/login; returns { status, cookie, data }. */
export async function login(email, password = TEST_PASSWORD) {
  const r = await request("/api/auth/login", { method: "POST", body: { email, password } });
  return { status: r.status, cookie: r.cookie, data: r.data };
}

function mustCookie(what, r) {
  if (!r.cookie) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.cookie;
}

/** A signed-in customer: { cookie, userId, email, password }. */
export async function makeCustomer(prefix, opts = {}) {
  const s = await signup({ prefix, role: "customer", name: opts.name ?? "Admtest Customer" });
  return { cookie: mustCookie("customer signup", s), userId: s.userId, email: s.email, password: s.password };
}

/** A signed-in vendor user with no listing yet: { cookie, userId, email, password }. */
export async function makeVendor(prefix, opts = {}) {
  const s = await signup({ prefix, role: "vendor", name: opts.name ?? "Admtest Vendor" });
  return { cookie: mustCookie("vendor signup", s), userId: s.userId, email: s.email, password: s.password };
}

/**
 * TEST-ONLY: signs up a user, promotes it to admin directly in the LOCAL DB,
 * then logs in again (the cookie carries the role) and returns
 * { cookie, userId, email, password }.
 */
export async function createAdmin(prefix, opts = {}) {
  const s = await signup({ prefix, role: "customer", name: opts.name ?? "Admtest Admin" });
  if (!s.userId) throw new Error(`admin signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [s.userId]);
  const l = await login(s.email, s.password);
  return { cookie: mustCookie("admin login", l), userId: s.userId, email: s.email, password: s.password };
}

/**
 * TEST-ONLY: inserts a vendor listing owned by ownerId straight into the DB
 * (no onboarding), returning its row { id, name, status, ... }.
 * opts: { name, status ('pending' default), district ('Ernakulam'),
 *         category ('Photography'), phone, submittedAt }
 */
export async function createListing(ownerId, opts = {}) {
  const category = opts.category ?? "Photography";
  const district = opts.district ?? "Ernakulam";
  const status = opts.status ?? "pending";
  const { rows } = await db().query(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                          district_id, primary_category_id, phone, whatsapp, onboarding_step,
                          onboarding_completed_at, submitted_at)
     VALUES ($1, $2, $3, $4, 0, 'Price on request', '3 yrs', 'Admin test listing.', $5,
             (SELECT id FROM districts WHERE name = $4 AND state = 'Kerala' LIMIT 1),
             (SELECT id FROM categories WHERE name = $3 LIMIT 1), $6, $6, 6,
             CASE WHEN $5 = 'draft' THEN NULL ELSE now() END,
             CASE WHEN $5 = 'draft' THEN NULL ELSE COALESCE($7::timestamptz, now()) END)
     RETURNING *`,
    [ownerId, opts.name ?? `Admtest Listing ${RUN_ID}`, category, district, status, opts.phone ?? null, opts.submittedAt ?? null]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Highest admin_audit_log id right now (0 if empty): count rows after it. */
export async function auditWatermark() {
  const { rows } = await db().query("SELECT COALESCE(max(id), 0)::bigint AS id FROM admin_audit_log");
  return Number(rows[0].id);
}

/**
 * Number of audit rows matching every given field:
 * { action, entityType, entityId, actorId, afterId }.
 */
export async function countAudit(filter = {}) {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.action !== undefined) add("action = ?", filter.action);
  if (filter.entityType !== undefined) add("entity_type = ?", filter.entityType);
  if (filter.entityId !== undefined) add("entity_id = ?", String(filter.entityId));
  if (filter.actorId !== undefined) add("actor_id = ?", filter.actorId);
  if (filter.afterId !== undefined) add("id > ?", filter.afterId);
  const { rows } = await db().query(
    `SELECT count(*)::int AS n FROM admin_audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""}`,
    params
  );
  return rows[0].n;
}

/** Latest audit rows matching the same filter as countAudit (newest first). */
export async function findAudit(filter = {}, limit = 10) {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.action !== undefined) add("action = ?", filter.action);
  if (filter.entityType !== undefined) add("entity_type = ?", filter.entityType);
  if (filter.entityId !== undefined) add("entity_id = ?", String(filter.entityId));
  if (filter.actorId !== undefined) add("actor_id = ?", filter.actorId);
  if (filter.afterId !== undefined) add("id > ?", filter.afterId);
  params.push(limit);
  const { rows } = await db().query(
    `SELECT * FROM admin_audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Deletes the admtest-<prefix>-<digits>@example.com users and what they own:
 * their listings (services, media rows, quotes, reviews, documents cascade;
 * uploaded files under uploads/vendors/<id> are removed), their quotes and
 * reviews as a customer. Notifications cascade; audit rows stay (actor set
 * to NULL). Returns { users, vendors }.
 */
export async function cleanup(prefix) {
  const pattern = emailPattern(prefix);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const ids = (await client.query("SELECT id FROM users WHERE email ~ $1", [pattern])).rows.map((r) => r.id);
    if (!ids.length) {
      await client.query("COMMIT");
      return { users: 0, vendors: 0 };
    }
    const v = await client.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[]) RETURNING id", [ids]);
    await client.query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
    await client.query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[])", [ids]);
    const u = await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    await client.query("COMMIT");
    const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(WEB_DIR, "uploads"));
    for (const row of v.rows) rmSync(path.join(uploadsRoot, "vendors", String(row.id)), { recursive: true, force: true });
    return { users: u.rowCount, vendors: v.rowCount };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
