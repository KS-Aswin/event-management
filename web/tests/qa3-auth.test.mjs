// qa3 fix round, auth group (a): QA-056 (suspension reason after a
// background API call), QA-057 (one support address), QA-059 (change
// password), QA-071 (main landmark on /login and /signup), QA-080 (central
// cross-site check, password for an email change), QA-081 (logout revokes
// the token, sign out of other devices), QA-082 (a griefer can't lock the
// owner out) and QA-083 (1) (underlined consent links on /signup).
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3161 node --env-file-if-exists=.env.local --test tests/qa3-auth.test.mjs
//
// Test users are qa3fix-auth-<digits>@example.com; they and their listings
// are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, closeDb, createListing, RUN_ID, TEST_IP, BASE_URL } from "./admin-helpers.mjs";

const PATTERN = "^qa3fix-auth-[0-9]+@example\\.com$";
const PASSWORD = "qa3fix-auth-password-1";
let seq = 0;
const email = () => `qa3fix-auth-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
// Per-test client IPs (the local server trusts X-Forwarded-For).
let ipSeq = 0;
const freshIp = () => `10.231.${Math.floor(RUN_ID / 250) % 250}.${(++ipSeq % 250) + 1}`;
const HOST = new URL(BASE_URL).host;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

before(cleanup);
after(async () => {
  await cleanup();
  await closeDb();
});

/**
 * Raw request: { status, data, text, setCookies, session, location }.
 * `body` is sent as given (string) or JSON-encoded (object, with a JSON
 * Content-Type unless headers override it).
 */
async function call(path, { method = "GET", body, cookie, headers = {}, ip = TEST_IP } = {}) {
  const isObj = body !== undefined && typeof body !== "string" && !(body instanceof FormData);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(isObj ? { "Content-Type": "application/json" } : {}),
      "X-Forwarded-For": ip,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: isObj ? JSON.stringify(body) : body,
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // HTML or empty
  }
  const setCookies = res.headers.getSetCookie();
  const s = setCookies.find((c) => c.startsWith("vela_session="));
  return {
    status: res.status,
    data,
    text,
    setCookies,
    session: s && !/^vela_session=;/.test(s) ? s.split(";")[0] : null,
    location: res.headers.get("location"),
  };
}

async function signup(role = "customer") {
  const addr = email();
  const r = await call("/api/auth/register", {
    method: "POST",
    body: { name: "Qa3fix Auth", email: addr, password: PASSWORD, role },
    ip: freshIp(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { email: addr, userId: r.data.user.id, cookie: r.session };
}

async function login(addr, password = PASSWORD, ip = freshIp()) {
  return call("/api/auth/login", { method: "POST", body: { email: addr, password }, ip });
}

const notifications = (cookie) => call("/api/notifications?limit=1", { cookie });

// ---------------------------------------------------------------------------
// QA-080: central cross-site check on cookie-authenticated mutating APIs
// ---------------------------------------------------------------------------

test("QA-080: a cross-site form-shaped request is refused on every mutating API", async () => {
  const c = await signup();
  // The cross-site text/plain shape from the report.
  const evil = await call("/api/my/shortlist", {
    method: "POST",
    cookie: c.cookie,
    headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
    body: JSON.stringify({ vendorId: 2 }),
  });
  assert.equal(evil.status, 403);
  // Even same-origin, a form-shaped body is refused with a session cookie.
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "text/plain;charset=UTF-8"]) {
    const r = await call("/api/account", { method: "PATCH", cookie: c.cookie, headers: { "Content-Type": type }, body: '{"name":"QA3 csrf"}' });
    assert.equal(r.status, 415, type);
  }
  // Cross-site Origin with a JSON body is refused too (vendor/admin paths alike).
  for (const path of ["/api/account", "/api/vendor/listing", "/api/admin/users/1/actions"]) {
    const r = await call(path, { method: path === "/api/account" ? "PATCH" : "POST", cookie: c.cookie, headers: { Origin: "https://evil.example" }, body: { name: "x" } });
    assert.equal(r.status, 403, path);
  }
  // A browser that omits Origin but says the request is cross-site.
  const fetchSite = await call("/api/account", { method: "PATCH", cookie: c.cookie, headers: { "Sec-Fetch-Site": "cross-site" }, body: { name: "x" } });
  assert.equal(fetchSite.status, 403);
  assert.equal((await db().query("SELECT name FROM users WHERE id = $1", [c.userId])).rows[0].name, "Qa3fix Auth");

  // Same-origin JSON keeps working, with or without an Origin header.
  const ok = await call("/api/account", { method: "PATCH", cookie: c.cookie, headers: { Origin: `http://${HOST}` }, body: { name: "Qa3fix Renamed" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  // Multipart uploads are not refused for their content type (the handler decides).
  const fd = new FormData();
  fd.set("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
  const up = await call("/api/vendor/documents", { method: "POST", cookie: c.cookie, headers: { Origin: `http://${HOST}` }, body: fd });
  assert.notEqual(up.status, 415);
  assert.notEqual(up.data?.error, "Cross-site request blocked.", "the handler answers, not the CSRF block");
  // The anonymous view counter (sendBeacon) is not body-type checked.
  const beacon = await call("/api/events", { method: "POST", cookie: c.cookie, headers: { "Content-Type": "text/plain" }, body: '{"vendorId":1,"kind":"view"}' });
  assert.notEqual(beacon.status, 415);
});

test("QA-080: changing the sign-in email needs the current password; a name change keeps the session", async () => {
  const c = await signup();
  const newEmail = email();
  const none = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: newEmail } });
  assert.equal(none.status, 400);
  assert.equal(none.data.field, "currentPassword");
  const wrong = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: newEmail, currentPassword: "not-it-123" } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.field, "currentPassword");
  assert.equal((await db().query("SELECT email FROM users WHERE id = $1", [c.userId])).rows[0].email, c.email);
  const right = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: newEmail, currentPassword: PASSWORD } });
  assert.equal(right.status, 200, JSON.stringify(right.data));
  assert.equal(right.data.user.email, newEmail);
  // Re-sending the same email (the Save button sends both fields) needs no password.
  const same = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { name: "Qa3fix Same", email: newEmail } });
  assert.equal(same.status, 200);

  // A name change re-issues the cookie with the CURRENT session_version.
  await db().query("UPDATE users SET session_version = session_version + 3 WHERE id = $1", [c.userId]);
  const relog = await login(newEmail);
  assert.equal(relog.status, 200);
  const renamed = await call("/api/account", { method: "PATCH", cookie: relog.session, body: { name: "Qa3fix Renamed Again" } });
  assert.equal(renamed.status, 200);
  assert.ok(renamed.session, "cookie re-issued for the new name");
  assert.equal((await notifications(renamed.session)).status, 200, "still signed in after the rename");
});

// ---------------------------------------------------------------------------
// QA-059: change password
// ---------------------------------------------------------------------------

test("QA-059: change password needs the current one, signs out other devices, keeps this one", async () => {
  const c = await signup("vendor");
  const other = await login(c.email);
  assert.equal(other.status, 200);

  const wrong = await call("/api/account/password", { method: "POST", cookie: c.cookie, body: { currentPassword: "nope-nope-1", newPassword: "brand-new-pass-1" } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.field, "currentPassword");
  const short = await call("/api/account/password", { method: "POST", cookie: c.cookie, body: { currentPassword: PASSWORD, newPassword: "short" } });
  assert.equal(short.status, 400);
  assert.equal(short.data.field, "newPassword");
  const same = await call("/api/account/password", { method: "POST", cookie: c.cookie, body: { currentPassword: PASSWORD, newPassword: PASSWORD } });
  assert.equal(same.status, 400);
  const anon = await call("/api/account/password", { method: "POST", body: { currentPassword: PASSWORD, newPassword: "brand-new-pass-1" } });
  assert.equal(anon.status, 401);

  const ok = await call("/api/account/password", { method: "POST", cookie: c.cookie, body: { currentPassword: PASSWORD, newPassword: "brand-new-pass-1" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.session, "this device gets a fresh cookie");
  assert.equal((await notifications(ok.session)).status, 200, "this device stays signed in");
  assert.equal((await notifications(other.session)).status, 401, "the other device is signed out");
  assert.equal((await notifications(c.cookie)).status, 401, "the pre-change cookie is dead");
  assert.equal((await login(c.email)).status, 401, "old password no longer works");
  assert.equal((await login(c.email, "brand-new-pass-1")).status, 200, "new password works");

  // Settings pages render the password section.
  const page = await call("/vendor/settings", { cookie: ok.session });
  assert.equal(page.status, 200);
  assert.match(page.text, /Change password/);
  assert.match(page.text, /Sign out of other devices/);
});

test("QA-059: wrong current passwords are rate limited per account", async () => {
  const c = await signup();
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call("/api/account/password", { method: "POST", cookie: c.cookie, body: { currentPassword: `wrong-${i}-xx`, newPassword: "brand-new-pass-1" } });
  }
  assert.equal(last.status, 429);
});

// ---------------------------------------------------------------------------
// QA-081: logout revokes the token; sign out of other devices
// ---------------------------------------------------------------------------

test("QA-081: logout revokes that session on the server, other devices stay signed in", async () => {
  const c = await signup();
  // Two sign-ins in the same second must still be two distinct sessions.
  const a = (await login(c.email)).session;
  const b = (await login(c.email)).session;
  assert.notEqual(a, b);
  assert.equal((await notifications(a)).status, 200);

  const out = await call("/api/auth/logout", { method: "POST", cookie: a });
  assert.equal(out.status, 200);
  assert.ok(out.setCookies.some((x) => /^vela_session=;/.test(x)), "cookie cleared");
  assert.equal((await notifications(a)).status, 401, "a copied cookie stops working after logout");
  const page = await call("/settings", { cookie: a });
  assert.ok(!page.text.includes("Change password"), "settings page refuses the revoked cookie");
  assert.equal((await notifications(b)).status, 200, "the other device is unaffected");
  const { rows } = await db().query("SELECT token_hash FROM revoked_sessions WHERE user_id = $1", [c.userId]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/, "stored hashed");
});

test("QA-081: sign out of other devices keeps only this one", async () => {
  const c = await signup();
  const a = (await login(c.email)).session;
  const b = (await login(c.email)).session;
  const r = await call("/api/account/sign-out-others", { method: "POST", cookie: b });
  assert.equal(r.status, 200);
  assert.ok(r.session);
  assert.equal((await notifications(r.session)).status, 200, "this device stays");
  assert.equal((await notifications(a)).status, 401, "other device out");
  assert.equal((await notifications(c.cookie)).status, 401, "sign-up session out");
  assert.equal((await call("/api/account/sign-out-others", { method: "POST" })).status, 401);
});

// ---------------------------------------------------------------------------
// QA-082: a griefer can't lock the owner out
// ---------------------------------------------------------------------------

test("QA-082: after a lockout from other IPs the owner's right password still signs in", async () => {
  const c = await signup();
  const griefer = [freshIp(), freshIp()];
  for (let i = 0; i < 10; i++) {
    const r = await login(c.email, "wrong-password-x", griefer[i % 2]);
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  // Locked for the IPs that kept guessing...
  assert.equal((await login(c.email, "wrong-password-x", griefer[0])).status, 429);
  assert.equal((await login(c.email, PASSWORD, griefer[1])).status, 429);
  // ...but the owner on their own device gets in.
  const owner = await login(c.email, PASSWORD, freshIp());
  assert.equal(owner.status, 200, JSON.stringify(owner.data));
});

test("QA-082: while locked, a fresh IP gets two guesses, and one IP can't keep guessing", async () => {
  const c = await signup();
  const ips = [freshIp(), freshIp()];
  for (let i = 0; i < 10; i++) await login(c.email, "wrong-password-x", ips[i % 2]);
  const fresh = freshIp();
  assert.equal((await login(c.email, "wrong-1-xxxxx", fresh)).status, 401);
  assert.equal((await login(c.email, "wrong-2-xxxxx", fresh)).status, 401);
  assert.equal((await login(c.email, PASSWORD, fresh)).status, 429, "third try from that IP refused");
  // Per (account, IP): 5 wrong from one IP, then refused even unlocked.
  const d = await signup();
  const ip = freshIp();
  for (let i = 0; i < 5; i++) assert.equal((await login(d.email, "wrong-password-x", ip)).status, 401);
  assert.equal((await login(d.email, PASSWORD, ip)).status, 429);
  assert.equal((await login(d.email, PASSWORD, freshIp())).status, 200);
});

// ---------------------------------------------------------------------------
// QA-056: background API call by a suspended vendor
// ---------------------------------------------------------------------------

test("QA-056: a 403 from an API call leaves the note, and the next page shows the reason", async () => {
  const v = await signup("vendor");
  const reason = `Qa3fix fake reviews ${RUN_ID}`;
  await createListing(v.userId, { name: `Qa3fix Auth ${RUN_ID}`, status: "approved" });
  await db().query(
    `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = $2,
            session_version = session_version + 1 WHERE id = $1`,
    [v.userId, `Listing suspended: ${reason}`]
  );
  const poll = await notifications(v.cookie);
  assert.equal(poll.status, 403);
  assert.equal(poll.data.code, "SUSPENDED", "the bell can tell suspension from sign-out");
  assert.ok(poll.setCookies.some((x) => /^vela_session=;/.test(x)), "session cleared");
  const note = poll.setCookies.find((x) => x.startsWith("vela_suspended=") && !x.startsWith("vela_suspended=;"));
  assert.ok(note, "signed note set");
  assert.match(note, /HttpOnly/i);
  const noteCookie = note.split(";")[0];

  // The next guarded page has no session, only the note: straight to the notice.
  const pageLoad = await call("/vendor/leads", { cookie: noteCookie });
  assert.equal(pageLoad.status, 307);
  assert.match(pageLoad.location, /\/login\?suspended=1$/);
  const notice = await call("/login?suspended=1", { cookie: noteCookie });
  assert.ok(notice.text.includes(reason), "reason shown");

  // A forged note does nothing special.
  const forged = await call("/vendor/leads", { cookie: "vela_suspended=forged" });
  assert.match(forged.location ?? "", /\/login\?next=/);
});

// ---------------------------------------------------------------------------
// QA-057, QA-071, QA-083 (1): pages
// ---------------------------------------------------------------------------

test("QA-057: every support contact uses the one configured address", async () => {
  const c = await signup();
  const pages = [
    await call("/help"),
    await call("/forgot-password"),
    await call("/terms"),
    await call("/settings", { cookie: c.cookie }),
  ];
  const found = new Set();
  for (const p of pages) {
    assert.equal(p.status, 200);
    for (const m of p.text.matchAll(/mailto:([^"?&\\<\s]+)/g)) found.add(decodeURIComponent(m[1]));
  }
  assert.equal(found.size, 1, `one address everywhere: ${[...found].join(", ")}`);
  const expected = (process.env.SUPPORT_EMAIL || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
  if (expected) assert.ok(found.has(expected), "uses SUPPORT_EMAIL");
});

test("QA-071: /login, /login?suspended=1 and /signup have one main landmark", async () => {
  for (const path of ["/login", "/login?suspended=1", "/signup"]) {
    const r = await call(path);
    assert.equal(r.status, 200, path);
    assert.equal((r.text.match(/<main[\s>]/g) ?? []).length, 1, path);
  }
});

test("QA-083 (1): the /signup consent links are underlined", async () => {
  const r = await call("/signup");
  const main = r.text.slice(r.text.indexOf("<main"), r.text.indexOf("</main>"));
  for (const href of ["/terms", "/privacy"]) {
    const tag = main.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0] ?? "";
    assert.match(tag, /class="[^"]*\bunderline\b/, href);
  }
});
