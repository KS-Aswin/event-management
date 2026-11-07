// P1-1 admin bootstrap and guard (PRODUCT_PLAN section 8).
// Run: npm run test:admin  (dev server on BASE_URL, local DB in .env.local)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  WEB_DIR,
  RUN_ID,
  request,
  signup,
  login,
  makeCustomer,
  makeVendor,
  createAdmin,
  testEmail,
  db,
  countAudit,
  cleanup,
  closeDb,
} from "./admin-helpers.mjs";

const P = "guard";
const CLI = "cli";

after(async () => {
  await cleanup(P);
  await cleanup(CLI);
  await closeDb();
});

let customer, vendor, admin;

test("setup: customer, vendor and admin accounts", async () => {
  customer = await makeCustomer(P);
  vendor = await makeVendor(P);
  admin = await createAdmin(P);
  assert.ok(customer.cookie && vendor.cookie && admin.cookie);
});

test("GET /api/admin/today: anonymous 401, customer 403, vendor 403, admin 200", async () => {
  assert.equal((await request("/api/admin/today")).status, 401);
  assert.equal((await request("/api/admin/today", { cookie: customer.cookie })).status, 403);
  assert.equal((await request("/api/admin/today", { cookie: vendor.cookie })).status, 403);
  const ok = await request("/api/admin/today", { cookie: admin.cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data?.ok, true);
  assert.match(ok.headers.cacheControl ?? "", /no-store/);
});

test("admin API: a garbage cookie is 401, not 404", async () => {
  const r = await request("/api/admin/today", { cookie: "vela_session=not-a-jwt" });
  assert.equal(r.status, 401);
});

test("admin API: an admin cookie for a demoted user is 403 (handler re-checks the DB)", async () => {
  const demoted = await createAdmin(P);
  await db().query("UPDATE users SET role = 'customer' WHERE id = $1", [demoted.userId]);
  assert.equal((await request("/api/admin/today", { cookie: demoted.cookie })).status, 403);
  assert.equal((await request("/admin", { cookie: demoted.cookie })).status, 404);
});

test("admin API: a suspended admin's cookie is rejected (403)", async () => {
  const s = await createAdmin(P);
  await db().query("UPDATE users SET status = 'suspended', suspended_at = now() WHERE id = $1", [s.userId]);
  assert.equal((await request("/api/admin/today", { cookie: s.cookie })).status, 403);
  assert.equal((await request("/admin", { cookie: s.cookie })).status, 404);
});

test("admin API: force logout (session_version bump) invalidates the cookie (401)", async () => {
  const s = await createAdmin(P);
  await db().query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [s.userId]);
  assert.equal((await request("/api/admin/today", { cookie: s.cookie })).status, 401);
  assert.equal((await request("/admin/users", { cookie: s.cookie })).status, 404);
});

test("/admin pages: 404 for anonymous, customer and vendor; 200 for admin", async () => {
  for (const p of ["/admin", "/admin/vendors", "/admin/audit"]) {
    assert.equal((await request(p)).status, 404, `anonymous ${p}`);
    assert.equal((await request(p, { cookie: customer.cookie })).status, 404, `customer ${p}`);
    assert.equal((await request(p, { cookie: vendor.cookie })).status, 404, `vendor ${p}`);
  }
  const pages = ["/admin", "/admin/vendors", "/admin/media", "/admin/reviews", "/admin/taxonomy",
    "/admin/taxonomy/custom", "/admin/users", "/admin/enquiries", "/admin/analytics", "/admin/audit"];
  for (const p of pages) {
    const r = await request(p, { cookie: admin.cookie });
    assert.equal(r.status, 200, `admin ${p}`);
  }
});

test("/admin shell: admin nav present, no customer/vendor chrome, noindex", async () => {
  const r = await request("/admin", { cookie: admin.cookie });
  const html = r.text;
  for (const label of ["Vendors", "Media", "Reviews", "Taxonomy", "Custom offerings", "Users", "Enquiries", "Audit log", "View site", "Sign out"]) {
    assert.ok(html.includes(`>${label}<`), `nav label ${label}`);
  }
  assert.ok(html.includes('data-admin-shell'), "admin shell rendered");
  assert.ok(!html.includes('href="/for-vendors"'), "no For vendors link");
  assert.ok(!html.includes('aria-label="Footer"'), "no public footer");
  assert.ok(!html.includes('aria-label="Workspace"'), "no vendor workspace nav");
  assert.match(html, /<meta name="robots" content="noindex, ?nofollow"/);
});

test("register can never create an admin", async () => {
  const r = await signup({ prefix: P, role: "admin" });
  assert.equal(r.status, 400);
  const { rows } = await db().query("SELECT count(*)::int AS n FROM users WHERE email = $1", [r.email]);
  assert.equal(rows[0].n, 0);
});

// --- npm run admin:create -------------------------------------------------

const SCRIPT = path.join(WEB_DIR, "scripts", "admin-create.mjs");
const CLI_PASSWORD = `cli-pass-${RUN_ID}-x`;

function runCli(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: WEB_DIR,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("admin:create creates an admin once and is idempotent", async () => {
  const email = testEmail(CLI);
  const first = runCli(["--email", email, "--name", "Cli Admin"], { ADMIN_PASSWORD: CLI_PASSWORD });
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Created admin/);
  assert.ok(!first.out.includes(CLI_PASSWORD), "password is never printed");

  const second = runCli(["--email", email], { ADMIN_PASSWORD: CLI_PASSWORD });
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /already an admin/);

  const { rows } = await db().query("SELECT id, role, name FROM users WHERE email = $1", [email]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "admin");
  assert.equal(rows[0].name, "Cli Admin");
  assert.equal(await countAudit({ action: "user.create_admin", entityId: rows[0].id }), 1);

  const l = await login(email, CLI_PASSWORD);
  assert.equal(l.status, 200);
  assert.equal((await request("/api/admin/today", { cookie: l.cookie })).status, 200);
});

test("admin:create promotes an existing customer (bare email) and logs out old sessions", async () => {
  const c = await signup({ prefix: CLI, role: "customer" });
  assert.ok(c.cookie);
  const r = runCli([c.email]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Promoted/);
  const { rows } = await db().query("SELECT role FROM users WHERE id = $1", [c.userId]);
  assert.equal(rows[0].role, "admin");
  assert.equal(await countAudit({ action: "user.promote_admin", entityId: c.userId }), 1);
  // The pre-promotion cookie is dead; a fresh login works as admin.
  assert.equal((await request("/api/admin/today", { cookie: c.cookie })).status, 403);
  assert.equal((await request("/api/account", { method: "PATCH", cookie: c.cookie, body: {} })).status, 401);
  const l = await login(c.email, c.password);
  assert.equal((await request("/api/admin/today", { cookie: l.cookie })).status, 200);
  // Running again changes nothing.
  assert.match(runCli([c.email]).out, /already an admin/);
  assert.equal(await countAudit({ action: "user.promote_admin", entityId: c.userId }), 1);
});

test("admin:create refuses: vendor with a listing, no password without a TTY, remote DB, bad email", async () => {
  const v = await makeVendor(CLI);
  await db().query(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status)
     VALUES ($1, 'Admtest CLI Listing', 'Photography', 'Kochi', 0, 'Price on request', '1 yr', 'x', 'draft')`,
    [v.userId]
  );
  const owned = runCli([v.email]);
  assert.equal(owned.code, 1);
  assert.match(owned.out, /owns vendor listing/);

  const noPw = runCli([testEmail(CLI)], { ADMIN_PASSWORD: "" });
  assert.equal(noPw.code, 1);
  assert.match(noPw.out, /ADMIN_PASSWORD/);

  const short = runCli([testEmail(CLI)], { ADMIN_PASSWORD: "short" });
  assert.equal(short.code, 1);

  const remote = runCli([testEmail(CLI)], {
    ADMIN_PASSWORD: CLI_PASSWORD,
    DATABASE_URL: "postgres://someone:secret@db.example.com:5432/vela",
  });
  assert.equal(remote.code, 1);
  assert.match(remote.out, /not a localhost database/);

  assert.equal(runCli(["not-an-email"], { ADMIN_PASSWORD: CLI_PASSWORD }).code, 1);
  assert.equal(runCli([]).code, 1);
});
