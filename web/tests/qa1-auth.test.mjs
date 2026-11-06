// qa1 fix round, auth group: QA-001, QA-003, QA-005, QA-006, QA-007,
// QA-017, QA-018, QA-031. Needs a running dev server (BASE_URL) and the
// LOCAL database:
//
//   BASE_URL=http://localhost:3151 node --env-file-if-exists=.env.local --test tests/qa1-auth.test.mjs
//
// Test users are qa1fix-auth-<digits>@example.com; they and everything they
// own (listings, enquiries, reset links, audit rows stay: append-only) are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { request, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";
import { clientIp } from "../lib/client-ip.ts";

const PATTERN = "^qa1fix-auth-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa1fix-auth-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
// A fresh client IP per call, as an attacker rotating X-Forwarded-For would.
let ipSeq = 0;
const rotatingIp = () => `172.16.${Math.floor(++ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[]) OR contact_email ~ $2", [ids, PATTERN]);
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function register(body, headers) {
  return request("/api/auth/register", {
    method: "POST",
    body: { name: "Qa1fix User", email: email(), password: TEST_PASSWORD, role: "customer", ...body },
    headers,
  });
}

async function account(role = "customer", name = "Qa1fix User") {
  const addr = email();
  const r = await register({ role, name, email: addr });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.cookie, userId: r.data.user.id, email: addr };
}

async function login(addr, password = TEST_PASSWORD, extra = {}, headers) {
  return request("/api/auth/login", { method: "POST", body: { email: addr, password, ...extra }, headers });
}

/** A guest enquiry (no account) to F.vendorId with this contact email. */
async function guestEnquiry(contactEmail) {
  const token = randomUUID();
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, name, phone, message, contact_email, guest_token)
     VALUES ($1, 'Qa1fix Guest', '+919800000000', 'QA1FIX secret guest message', $2, $3::uuid) RETURNING id`,
    [F.vendorId, contactEmail, token]
  );
  return { id: rows[0].id, token };
}

const F = {};

before(async () => {
  await cleanup();
  F.owner = await account("vendor", "Qa1fix Owner");
  const v = await createListing(F.owner.userId, { name: `Qa1fix Approved ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [v.id]);
  F.vendorId = v.id;
  F.pendingOwner = await account("vendor", "Qa1fix Pending Owner");
  F.pendingId = (await createListing(F.pendingOwner.userId, { name: `Qa1fix Pending ${RUN_ID}`, status: "pending" })).id;
  F.admin = await account("customer", "Qa1fix Admin");
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [F.admin.userId]);
  F.admin.cookie = (await login(F.admin.email)).cookie;
  assert.ok(F.admin.cookie);
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-003: guest enquiries are never handed over by an unverified email
// ---------------------------------------------------------------------------

test("QA-003: registering with a guest's email does not expose their enquiry", async () => {
  const victim = email();
  const g = await guestEnquiry(victim);
  const r = await register({ email: victim, name: "Qa1fix Attacker" });
  assert.equal(r.status, 201);
  assert.equal(r.data.linkedEnquiryId, undefined);
  const { rows } = await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [g.id]);
  assert.equal(rows[0].customer_id, null);
  const detail = await request(`/api/my/enquiries/${g.id}`, { cookie: r.cookie });
  assert.equal(detail.status, 404);
  const list = await request("/api/my/enquiries", { cookie: r.cookie });
  assert.doesNotMatch(list.text, /QA1FIX secret guest message/);
  // Logging in again doesn't link it either.
  const l = await login(victim);
  assert.equal(l.status, 200);
  assert.equal((await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [g.id])).rows[0].customer_id, null);
  // The guest's own tracking link keeps working.
  const track = await request(`/api/enquiries/track/${g.token}`);
  assert.equal(track.status, 200);
  assert.equal(track.data.enquiry.linkedToAccount, false);
});

test("QA-003: the guest's private token links the enquiry on sign-up (any email) and lands on it", async () => {
  const g = await guestEnquiry(email());
  const r = await register({ email: email(), enquiryToken: g.token, next: "/my/enquiries" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.linkedEnquiryId, g.id);
  assert.equal(r.data.redirectTo, `/my/enquiries/${g.id}`);
  const detail = await request(`/api/my/enquiries/${g.id}`, { cookie: r.cookie });
  assert.equal(detail.status, 200);
  // Already linked: another account with the same token gets nothing.
  const other = await register({ email: email(), enquiryToken: g.token });
  assert.equal(other.status, 201);
  assert.equal(other.data.linkedEnquiryId, undefined);
});

test("QA-003: the token links on login too; vendors are never linked", async () => {
  const c = await account();
  const g = await guestEnquiry(email());
  const l = await login(c.email, TEST_PASSWORD, { enquiryToken: g.token });
  assert.equal(l.status, 200);
  assert.equal(l.data.redirectTo, `/my/enquiries/${g.id}`);
  assert.equal((await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [g.id])).rows[0].customer_id, c.userId);

  const g2 = await guestEnquiry(email());
  const lv = await login(F.owner.email, TEST_PASSWORD, { enquiryToken: g2.token });
  assert.equal(lv.status, 200);
  assert.equal((await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [g2.id])).rows[0].customer_id, null);
});

test("QA-003: POST /api/auth/link-enquiry for a signed-in customer", async () => {
  const c = await account();
  const g = await guestEnquiry(email());
  const anon = await request("/api/auth/link-enquiry", { method: "POST", body: { token: g.token } });
  assert.equal(anon.status, 401);
  const vendor = await request("/api/auth/link-enquiry", { method: "POST", body: { token: g.token }, cookie: F.owner.cookie });
  assert.equal(vendor.status, 403);
  const bad = await request("/api/auth/link-enquiry", { method: "POST", body: { token: "nope" }, cookie: c.cookie });
  assert.equal(bad.status, 400);
  const ok = await request("/api/auth/link-enquiry", { method: "POST", body: { token: g.token }, cookie: c.cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.enquiryId, g.id);
  const again = await request("/api/auth/link-enquiry", { method: "POST", body: { token: g.token }, cookie: c.cookie });
  assert.equal(again.status, 200, "second click is still fine");
  const d = await account();
  const taken = await request("/api/auth/link-enquiry", { method: "POST", body: { token: g.token }, cookie: d.cookie });
  assert.equal(taken.status, 404);
  // A signed-in customer opening /login?enquiry=<token> is asked first, not redirected.
  const g2 = await guestEnquiry(email());
  const page = await request(`/login?enquiry=${g2.token}`, { cookie: d.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Add this enquiry to your account/);
  assert.equal((await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [g2.id])).rows[0].customer_id, null);
});

// ---------------------------------------------------------------------------
// QA-005: rate limits can't be dodged by rotating X-Forwarded-For
// ---------------------------------------------------------------------------

test("QA-005: per-account login lockout holds across rotating client IPs, in the shared store", async () => {
  const target = email();
  let last = null;
  for (let i = 0; i < 11; i++) {
    last = await fetch(`${process.env.BASE_URL ?? "http://localhost:3000"}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": rotatingIp() },
      body: JSON.stringify({ email: target, password: "wrong-password" }),
    });
    await last.text();
    if (i < 10) assert.equal(last.status, 401, `attempt ${i + 1}`);
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
  const { rows } = await db().query("SELECT hits FROM rate_limit_counters WHERE key = $1", [sha(`login:fail:${target}`)]);
  assert.equal(rows[0]?.hits, 10, "counted in Postgres, keyed by a hash (no raw email)");
  const raw = await db().query("SELECT 1 FROM rate_limit_counters WHERE key LIKE '%@%'");
  assert.equal(raw.rowCount, 0);
});

test("QA-005: a successful login clears the failure count", async () => {
  const c = await account();
  for (let i = 0; i < 3; i++) assert.equal((await login(c.email, "wrong-password")).status, 401);
  const key = sha(`login:fail:${c.email}`);
  assert.equal((await db().query("SELECT hits FROM rate_limit_counters WHERE key = $1", [key])).rows[0].hits, 3);
  assert.equal((await login(c.email)).status, 200);
  assert.equal((await db().query("SELECT 1 FROM rate_limit_counters WHERE key = $1", [key])).rowCount, 0);
});

test("QA-005: clientIp only trusts the first X-Forwarded-For hop when allowed", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, TRUST_PROXY: process.env.TRUST_PROXY, VERCEL: process.env.VERCEL };
  const h = (o) => new Headers(o);
  try {
    delete process.env.VERCEL;
    process.env.NODE_ENV = "production";
    delete process.env.TRUST_PROXY;
    // Spoofed first hop is ignored; the hop the nearest proxy added is used.
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9");
    assert.equal(clientIp(h({ "x-real-ip": "8.8.8.8" })), "8.8.8.8");
    assert.equal(clientIp(h({})), "unknown");
    process.env.VERCEL = "1";
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "7.7.7.7" })), "7.7.7.7");
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "6.6.6.6" })), "6.6.6.6");
    delete process.env.VERCEL;
    process.env.TRUST_PROXY = "1";
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "1.1.1.1");
    delete process.env.TRUST_PROXY;
    process.env.NODE_ENV = "development";
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "1.1.1.1", "dev/test runs keep their per-run IP");
    process.env.TRUST_PROXY = "0";
    assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ---------------------------------------------------------------------------
// QA-006: name and password length on sign-up
// ---------------------------------------------------------------------------

test("QA-006: sign-up caps name at 80 and password at 72 bytes, with field errors", async () => {
  const long = await register({ name: "Verylongname".repeat(300) });
  assert.equal(long.status, 400);
  assert.equal(long.data.field, "name");
  assert.match(long.data.error, /80 characters/);
  assert.equal(long.cookie, null);
  const n81 = await register({ name: "a".repeat(81) });
  assert.equal(n81.status, 400);
  const n80 = await register({ name: `  ${"a".repeat(40)}   ${"b".repeat(39)} ` });
  assert.equal(n80.status, 201, JSON.stringify(n80.data));
  assert.equal(n80.data.user.name, `${"a".repeat(40)} ${"b".repeat(39)}`);
  const huge = await register({ password: "p".repeat(200_000) });
  assert.equal(huge.status, 400);
  assert.equal(huge.data.field, "password");
  const p73 = await register({ password: "p".repeat(73) });
  assert.equal(p73.status, 400);
  const p72 = await register({ password: "p".repeat(72) });
  assert.equal(p72.status, 201);
  const blank = await register({ password: "        x" });
  assert.equal(blank.status, 400, "8+ characters not counting spaces, same as the form");
});

// ---------------------------------------------------------------------------
// QA-007: one-time password reset links created by an admin
// ---------------------------------------------------------------------------

test("QA-007: forgot-password page and the link on /login", async () => {
  const loginPage = await request("/login");
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.text, /href="\/forgot-password"/);
  const forgot = await request("/forgot-password");
  assert.equal(forgot.status, 200);
  assert.match(forgot.text, /Forgot your password/);
});

test("QA-007: admin reset link -> new password works once, old sessions end, audit-logged", async () => {
  const c = await account();
  // Only admins can create links; never for admins or yourself.
  assert.equal((await request(`/api/admin/users/${c.userId}/password-reset`, { method: "POST", body: {}, cookie: c.cookie })).status, 403);
  const forAdmin = await request(`/api/admin/users/${F.admin.userId}/password-reset`, { method: "POST", body: {}, cookie: F.admin.cookie });
  assert.equal(forAdmin.status, 409);

  const first = await request(`/api/admin/users/${c.userId}/password-reset`, {
    method: "POST",
    body: { reason: "Called the phone on file" },
    cookie: F.admin.cookie,
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const r = await request(`/api/admin/users/${c.userId}/password-reset`, { method: "POST", body: {}, cookie: F.admin.cookie });
  assert.equal(r.status, 201);
  assert.match(r.data.url, /\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  const token = new URL(r.data.url).searchParams.get("token");
  const oldToken = new URL(first.data.url).searchParams.get("token");

  // Only a hash is stored; the audit row never has the token.
  const stored = await db().query("SELECT token_hash FROM password_reset_tokens WHERE user_id = $1", [c.userId]);
  assert.ok(stored.rows.some((x) => x.token_hash === sha(token)));
  assert.ok(stored.rows.every((x) => x.token_hash !== token));
  const audit = await db().query(
    "SELECT after::text AS after, reason FROM admin_audit_log WHERE action = 'user.password_reset_link' AND entity_id = $1 ORDER BY id",
    [String(c.userId)]
  );
  assert.equal(audit.rowCount, 2);
  assert.equal(audit.rows[0].reason, "Called the phone on file");
  assert.ok(!audit.rows[1].after.includes(token));

  // The page: valid link shows the form; a bad or superseded link doesn't.
  const page = await request(`/reset-password?token=${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Choose a new password/);
  assert.match(page.headers.cacheControl ?? "", /no-store/);
  assert.match((await request(`/reset-password?token=${oldToken}`)).text, /doesn.t work/, "a newer link cancels the older one");
  assert.match((await request("/reset-password?token=abc")).text, /doesn.t work/);

  const short = await request("/api/auth/reset-password", { method: "POST", body: { token, password: "short" } });
  assert.equal(short.status, 400);
  assert.equal(short.data.field, "password");
  const ok = await request("/api/auth/reset-password", { method: "POST", body: { token, password: "brand-new-pass-1" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.email, c.email);

  // Old cookie is signed out; old password fails; new one works.
  assert.equal((await request("/api/my/enquiries", { cookie: c.cookie })).status, 401);
  assert.equal((await login(c.email)).status, 401);
  assert.equal((await login(c.email, "brand-new-pass-1")).status, 200);

  // Works once.
  const reuse = await request("/api/auth/reset-password", { method: "POST", body: { token, password: "another-pass-22" } });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.data.code, "INVALID_LINK");
  assert.equal(
    (await db().query("SELECT 1 FROM admin_audit_log WHERE action = 'user.password_reset_used' AND entity_id = $1", [String(c.userId)])).rowCount,
    1
  );
});

test("QA-007: an expired reset link is refused", async () => {
  const c = await account();
  const r = await request(`/api/admin/users/${c.userId}/password-reset`, { method: "POST", body: {}, cookie: F.admin.cookie });
  const token = new URL(r.data.url).searchParams.get("token");
  await db().query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [sha(token)]);
  const res = await request("/api/auth/reset-password", { method: "POST", body: { token, password: "brand-new-pass-1" } });
  assert.equal(res.status, 400);
  assert.equal((await login(c.email)).status, 200, "password unchanged");
});

// ---------------------------------------------------------------------------
// QA-017: last sign-in is recorded
// ---------------------------------------------------------------------------

test("QA-017: sign-up and login write users.last_login_at", async () => {
  const c = await account();
  let { rows } = await db().query("SELECT last_login_at FROM users WHERE id = $1", [c.userId]);
  assert.ok(rows[0].last_login_at, "set at sign-up");
  await db().query("UPDATE users SET last_login_at = NULL WHERE id = $1", [c.userId]);
  assert.equal((await login(c.email, "wrong-password")).status, 401);
  ({ rows } = await db().query("SELECT last_login_at FROM users WHERE id = $1", [c.userId]));
  assert.equal(rows[0].last_login_at, null, "a failed login doesn't count");
  assert.equal((await login(c.email)).status, 200);
  ({ rows } = await db().query("SELECT last_login_at FROM users WHERE id = $1", [c.userId]));
  assert.ok(Date.now() - new Date(rows[0].last_login_at).getTime() < 60_000);
});

// ---------------------------------------------------------------------------
// QA-018 / QA-031: suspended users on /login
// ---------------------------------------------------------------------------

test("QA-018/QA-031: /login clears a suspended user's cookie and shows the reason; login 403 tells it too", async () => {
  const v = await account("vendor", "Qa1fix Suspendee");
  await db().query(
    `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = 'Listing suspended: Fake reviews QA1FIX',
            session_version = session_version + 1 WHERE id = $1`,
    [v.userId]
  );
  const page = await request("/login?suspended=1", { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Fake reviews QA1FIX/);
  assert.doesNotMatch(page.text, /Hi, Qa1fix/, "header is signed out");
  assert.match(page.text, /Sign in/);
  // The cookie is removed from the browser.
  const res = await fetch(`${process.env.BASE_URL ?? "http://localhost:3000"}/login?suspended=1`, {
    headers: { Cookie: v.cookie },
    redirect: "manual",
  });
  await res.text();
  assert.match(res.headers.get("set-cookie") ?? "", /vela_session=;|vela_session=.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);

  // Without the user's own cookie, nobody sees a reason (and a client-sent header is ignored).
  const anon = await request("/login?suspended=1", { headers: { "x-vela-suspension": "INJECTED%20QA1FIX" } });
  assert.doesNotMatch(anon.text, /Fake reviews QA1FIX|INJECTED/);
  assert.match(anon.text, /This account is suspended/);

  const wrong = await login(v.email, "wrong-password");
  assert.equal(wrong.status, 401);
  assert.doesNotMatch(JSON.stringify(wrong.data), /Fake reviews/);
  const right = await login(v.email);
  assert.equal(right.status, 403);
  assert.match(right.data.error, /Your listing and account are suspended\. Reason: Fake reviews QA1FIX\./);
  assert.equal(right.cookie, null);
});

test("QA-018: a force-logged-out (stale) cookie is cleared on /login and /signup", async () => {
  const c = await account("customer", "Qa1fix Stale");
  await db().query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [c.userId]);
  for (const p of ["/login", "/signup"]) {
    const r = await request(p, { cookie: c.cookie });
    assert.equal(r.status, 200, p);
    assert.doesNotMatch(r.text, /Hi, Qa1fix/, p);
  }
});

// ---------------------------------------------------------------------------
// QA-001: real 404 for unknown / non-public vendor pages
// ---------------------------------------------------------------------------

test("QA-001: /vendors/<id> is a real 404 unless public (owner and admin still preview)", async () => {
  for (const p of ["/vendors/999999999", "/vendors/abc", "/vendors/0", "/vendors/99999999999", `/vendors/${F.pendingId}`]) {
    assert.equal((await request(p)).status, 404, p);
  }
  assert.equal((await request(`/vendors/${F.vendorId}`)).status, 200);
  assert.equal((await request(`/vendors/${F.pendingId}`, { cookie: F.pendingOwner.cookie })).status, 200, "owner preview");
  assert.equal((await request(`/vendors/${F.pendingId}`, { cookie: F.admin.cookie })).status, 200, "admin preview");
  assert.equal((await request(`/vendors/${F.pendingId}`, { cookie: F.owner.cookie })).status, 404, "another vendor");
  await db().query("UPDATE vendors SET published = false WHERE id = $1", [F.vendorId]);
  try {
    assert.equal((await request(`/vendors/${F.vendorId}`)).status, 404, "unpublished");
  } finally {
    await db().query("UPDATE vendors SET published = true WHERE id = $1", [F.vendorId]);
  }
});
