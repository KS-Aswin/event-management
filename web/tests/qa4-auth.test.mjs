// qa4 fix round, auth-customer-sec group: QA-086 (main landmark on
// /forgot-password and /reset-password), QA-087 (unknown /admin/* is a real
// 404), QA-091 (an ended session renders signed out and the dead cookie is
// cleared on /login) and QA-092 (an email change asks for the password
// before saying an email is taken, and is rate-limited).
// QA-093 (customer enquiry "No offer yet" wording) and the client-side
// header on the admin 404 (QA-087) are covered by e2e/qa4-customer.spec.ts
// and e2e/qa4-ui.spec.ts.
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3174 node --env-file-if-exists=.env.local --test tests/qa4-auth.test.mjs
//
// Test users are qa4fix-auth-<digits>@example.com; they are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, closeDb, RUN_ID, TEST_IP, BASE_URL } from "./admin-helpers.mjs";

const PATTERN = "^qa4fix-auth-[0-9]+@example\\.com$";
const PASSWORD = "qa4fix-auth-password-1";
let seq = 0;
const email = () => `qa4fix-auth-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
// Per-test client IPs (the local server trusts X-Forwarded-For).
let ipSeq = 0;
const freshIp = () => `10.232.${Math.floor(RUN_ID / 250) % 250}.${(++ipSeq % 250) + 1}`;

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

/** Raw request: { status, data, text, setCookies, session, cleared, location }. */
async function call(path, { method = "GET", body, cookie, headers = {}, ip = TEST_IP } = {}) {
  const isObj = body !== undefined && typeof body !== "string";
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
    session: s && !/^vela_session=;/.test(s) && !/Max-Age=0/i.test(s) ? s.split(";")[0] : null,
    cleared: !!s && (/^vela_session=;/.test(s) || /Max-Age=0/i.test(s) || /Expires=Thu, 01 Jan 1970/i.test(s)),
    location: res.headers.get("location"),
  };
}

async function signup(role = "customer", name = "Qa4fix Auth") {
  const addr = email();
  const r = await call("/api/auth/register", {
    method: "POST",
    body: { name, email: addr, password: PASSWORD, role },
    ip: freshIp(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { email: addr, userId: r.data.user.id, cookie: r.session };
}

async function login(addr, password = PASSWORD) {
  const r = await call("/api/auth/login", { method: "POST", body: { email: addr, password }, ip: freshIp() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.session;
}

/** The server-rendered header: signed in (account menu) or signed out (Sign up link). */
function headerState(html) {
  const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  return {
    signedIn: /aria-controls="account-menu"/.test(header) || /Hi,/.test(header),
    signedOut: /href="\/signup"/.test(header),
    workspaceNav: /aria-label="Workspace"/.test(header),
  };
}

// ---------------------------------------------------------------------------
// QA-091: a session that ended elsewhere renders signed out
// ---------------------------------------------------------------------------

test("QA-091: after a password change on another device, pages render this device signed out", async () => {
  const c = await signup("customer", "Qa4fix Stale");
  // Signed in here: the home page shows the account menu.
  const before = headerState((await call("/", { cookie: c.cookie })).text);
  assert.ok(before.signedIn && !before.signedOut, "live session shows the signed-in header");

  const other = await login(c.email);
  const changed = await call("/api/account/password", {
    method: "POST",
    cookie: other,
    body: { currentPassword: PASSWORD, newPassword: "qa4fix-auth-password-2" },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await call("/api/notifications?limit=1", { cookie: c.cookie })).status, 401);

  for (const path of ["/", "/search", "/forgot-password"]) {
    const h = headerState((await call(path, { cookie: c.cookie })).text);
    assert.ok(h.signedOut && !h.signedIn, `${path}: ended session renders signed out`);
  }
  // /login clears the dead cookie (proxy.ts).
  const loginPage = await call("/login", { cookie: c.cookie });
  assert.ok(loginPage.cleared, "the dead cookie is cleared on /login");
});

test("QA-091: a logged-out (revoked) vendor token renders signed out and is cleared on /login", async () => {
  const v = await signup("vendor", "Qa4fix Vendor");
  const token = await login(v.email);
  const out = await call("/api/auth/logout", { method: "POST", cookie: token });
  assert.equal(out.status, 200, JSON.stringify(out.data));

  const home = headerState((await call("/", { cookie: token })).text);
  assert.ok(home.signedOut && !home.signedIn, "home renders signed out");

  // /vendor's layout guard sends this token to /login (a streamed redirect
  // after the root loading.tsx, so not checked here); /login must then look
  // signed out and drop the cookie.

  const loginPage = await call("/login?next=%2Fvendor", { cookie: token });
  assert.equal(loginPage.status, 200);
  const h = headerState(loginPage.text);
  assert.ok(!h.workspaceNav && !h.signedIn, "/login shows no workspace nav or account menu");
  assert.ok(loginPage.cleared, "the revoked cookie is cleared on /login");

  // A live session is unaffected.
  const live = await signup("customer", "Qa4fix Live");
  const liveHome = headerState((await call("/", { cookie: live.cookie })).text);
  assert.ok(liveHome.signedIn, "a live session keeps the signed-in header");
  const liveLogin = await call("/login", { cookie: live.cookie });
  assert.ok(!liveLogin.cleared, "a live cookie is not cleared on /login");
});

// ---------------------------------------------------------------------------
// QA-092: email change is not a registered-email oracle
// ---------------------------------------------------------------------------

test("QA-092: without the password, a taken and a free email get the same answer", async () => {
  const victim = await signup("customer", "Qa4fix Victim");
  const c = await signup("customer", "Qa4fix Enum");
  const taken = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: victim.email } });
  const free = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: `qa4fix-free-${RUN_ID}@example.org` } });
  assert.equal(taken.status, 400, JSON.stringify(taken.data));
  assert.equal(free.status, 400, JSON.stringify(free.data));
  assert.equal(taken.data.field, "currentPassword");
  assert.deepEqual(taken.data, free.data);

  // A wrong password: same answer for both too.
  const takenWrong = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: victim.email, currentPassword: "nope-nope-1" } });
  const freeWrong = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: `qa4fix-free2-${RUN_ID}@example.org`, currentPassword: "nope-nope-1" } });
  assert.equal(takenWrong.status, 400);
  assert.deepEqual(takenWrong.data, freeWrong.data);

  // With the right password the owner is told the email is taken.
  const ok = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: victim.email, currentPassword: PASSWORD } });
  assert.equal(ok.status, 409, JSON.stringify(ok.data));
  assert.equal(ok.data.field, "email");

  // A name-only change still needs no password.
  const rename = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { name: "Qa4fix Renamed" } });
  assert.equal(rename.status, 200, JSON.stringify(rename.data));
});

test("QA-092: email-change attempts are rate-limited per account", async () => {
  const c = await signup("customer", "Qa4fix Limit");
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { email: `qa4fix-probe-${RUN_ID}-${i}@example.org` } });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400), statuses.join(","));
  assert.ok(statuses.slice(10).every((s) => s === 429), statuses.join(","));
  // Unrelated settings still save while limited.
  const prefs = await call("/api/account", { method: "PATCH", cookie: c.cookie, body: { emailNotifications: false } });
  assert.equal(prefs.status, 200, JSON.stringify(prefs.data));
});

// ---------------------------------------------------------------------------
// QA-086, QA-087
// ---------------------------------------------------------------------------

test("QA-086: /forgot-password and /reset-password have one <main> landmark", async () => {
  for (const path of ["/forgot-password", "/reset-password", "/reset-password?token=bogus"]) {
    const r = await call(path);
    assert.equal(r.status, 200, path);
    assert.equal((r.text.match(/<main[\s>]/g) ?? []).length, 1, path);
  }
});

test("QA-087: an unknown /admin page is a real 404 for a live admin", async () => {
  const a = await signup("customer", "Qa4fix Admin");
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.userId]);
  const cookie = await login(a.email);
  const r = await call("/admin/qa4-no-such-admin-page", { cookie });
  assert.equal(r.status, 404);
});
