// qa2 fix round, security group: QA-005 (client IP on self-hosted builds and
// the shared "unknown" bucket), QA-054 (security headers / CSP) and QA-056
// (suspension reason for a vendor whose session is already open). QA-021 and
// QA-055 are live latency and can only be re-timed on live.
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3151 node --env-file-if-exists=.env.local --test tests/qa2-sec.test.mjs
//
// Test users are qa2fix-sec-<digits>@example.com; they and their listings are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { request, db, closeDb, createListing, RUN_ID, TEST_PASSWORD, BASE_URL } from "./admin-helpers.mjs";
import { clientIp, requestIp, PEER_HEADER_KEY } from "../lib/client-ip.ts";
import { installPeerIp } from "../lib/peer-ip.ts";

const PATTERN = "^qa2fix-sec-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa2fix-sec-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

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

/** Runs fn with these env vars set (undefined = unset), then restores them. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const H = (o) => new Headers(o);

// ---------------------------------------------------------------------------
// QA-005
// ---------------------------------------------------------------------------

test("QA-005: self-hosted production without TRUST_PROXY ignores every X-Forwarded-For hop", async () => {
  await withEnv({ NODE_ENV: "production", TRUST_PROXY: undefined, VERCEL: undefined }, () => {
    const g = globalThis;
    const savedName = g[PEER_HEADER_KEY];
    g[PEER_HEADER_KEY] = "x-test-peer-secret";
    try {
      // Rotating X-Forwarded-For (any hop) or X-Real-IP never changes the key.
      for (const xff of ["1.1.1.1", "2.2.2.2, 3.3.3.3", "4.4.4.4, 5.5.5.5, 6.6.6.6"]) {
        assert.equal(clientIp(H({ "x-forwarded-for": xff, "x-test-peer-secret": "203.0.113.7" })), "203.0.113.7");
      }
      assert.equal(clientIp(H({ "x-real-ip": "8.8.8.8", "x-test-peer-secret": "203.0.113.7" })), "203.0.113.7");
      assert.equal(clientIp(H({ "x-test-peer-secret": "::ffff:198.51.100.4" })), "198.51.100.4", "IPv4-mapped peer");
      assert.equal(requestIp(H({ "x-test-peer-secret": "203.0.113.7" })), "203.0.113.7");
    } finally {
      if (savedName === undefined) delete g[PEER_HEADER_KEY];
      else g[PEER_HEADER_KEY] = savedName;
    }
  });
});

test("QA-005: TRUST_PROXY=<n> takes the hop the n-th proxy appended, not the client-typed ones", async () => {
  await withEnv({ NODE_ENV: "production", VERCEL: undefined, TRUST_PROXY: "1" }, () => {
    assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "9.9.9.9");
    assert.equal(clientIp(H({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9", "a proxy that overwrites");
  });
  await withEnv({ NODE_ENV: "production", VERCEL: undefined, TRUST_PROXY: "2" }, () => {
    assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 9.9.9.9, 10.0.0.2" })), "9.9.9.9");
  });
  await withEnv({ NODE_ENV: "production", VERCEL: "1", TRUST_PROXY: undefined }, () => {
    assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" })), "7.7.7.7");
  });
});

test("QA-005: requests with no known IP do not share one bucket", async () => {
  await withEnv({ NODE_ENV: "production", TRUST_PROXY: undefined, VERCEL: undefined }, () => {
    const g = globalThis;
    const savedName = g[PEER_HEADER_KEY];
    delete g[PEER_HEADER_KEY];
    try {
      const a = clientIp(H({ "user-agent": "Mozilla/5.0 Firefox/140", "accept-language": "en-IN" }));
      const b = clientIp(H({ "user-agent": "Mozilla/5.0 Chrome/141", "accept-language": "ta-IN" }));
      assert.notEqual(a, "unknown");
      assert.match(a, /^anon:[0-9a-f]{8}$/);
      assert.notEqual(a, b, "different browsers get different buckets");
      assert.equal(a, clientIp(H({ "user-agent": "Mozilla/5.0 Firefox/140", "accept-language": "en-IN" })), "stable per client");
      assert.equal(requestIp(H({ "x-forwarded-for": "1.1.1.1" })), null, "records get null, not a forged IP");
    } finally {
      if (savedName !== undefined) g[PEER_HEADER_KEY] = savedName;
    }
  });
});

test("QA-005: the socket peer is stamped by the server and can't be forged by the client", async () => {
  installPeerIp();
  const name = globalThis[PEER_HEADER_KEY];
  assert.match(name, /^x-vela-peer-[0-9a-f]{16}$/);
  const server = http.createServer((req, res) => {
    const seen = withEnv({ NODE_ENV: "production", TRUST_PROXY: undefined, VERCEL: undefined }, () =>
      clientIp(new Headers(req.headers))
    );
    seen.then((ip) => res.end(ip));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "7.7.7.7", [name]: "8.8.8.8" },
    });
    assert.equal(await res.text(), "127.0.0.1");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("QA-005: sign-up with no X-Forwarded-For is not blocked by another client's attempts", async () => {
  // Locally the server trusts the per-run X-Forwarded-For (dev). Requests
  // without it used to share the key 'unknown'; with a real peer address or
  // a per-client fallback a plain request still goes through.
  const r = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": `qa2fix-sec-${RUN_ID}` },
    body: JSON.stringify({ name: "Qa2fix Sec", email: email(), password: TEST_PASSWORD, role: "customer" }),
  });
  assert.equal(r.status, 201, await r.text());
});

// ---------------------------------------------------------------------------
// QA-054
// ---------------------------------------------------------------------------

test("QA-054: no X-Powered-By, and a real Content-Security-Policy", async () => {
  for (const path of ["/", "/login", "/api/vendors"]) {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
    assert.equal(res.headers.get("x-powered-by"), null, `${path} X-Powered-By`);
    const csp = res.headers.get("content-security-policy") ?? "";
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      assert.ok(csp.includes(d), `${path} CSP has ${d}: ${csp}`);
    }
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /img-src 'self'[^;]*https:\/\/i\.ytimg\.com/);
    assert.match(csp, /frame-src [^;]*youtube-nocookie/);
  }
});

// ---------------------------------------------------------------------------
// QA-056
// ---------------------------------------------------------------------------

const REASON = `Qa2fix stock photos ${RUN_ID}`;

async function suspendedVendor() {
  const addr = email();
  const r = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Qa2fix Vendor", email: addr, password: TEST_PASSWORD, role: "vendor" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const userId = r.data.user.id;
  await createListing(userId, { name: `Qa2fix Sec ${RUN_ID}`, status: "approved" });
  // What lib/admin/vendors.ts does when an admin suspends the listing.
  await db().query(
    `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = $2,
            session_version = session_version + 1 WHERE id = $1`,
    [userId, `Listing suspended: ${REASON}`]
  );
  return { userId, session: r.cookie };
}

/** GET with a raw Cookie header; returns { text, setCookies }. */
async function page(path, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  return { status: res.status, text: await res.text(), setCookies: res.headers.getSetCookie() };
}

const notice = (setCookies) => setCookies.find((c) => c.startsWith("vela_suspended="));

test("QA-056: the reason survives the first /login?suspended=1 request clearing the session", async () => {
  const v = await suspendedVendor();

  // First request still carries the (now invalid) session: reason shown,
  // session cleared, and the signed note set.
  const first = await page("/login?suspended=1", v.session);
  assert.ok(first.text.includes(REASON), "reason on the first request");
  assert.ok(first.setCookies.some((c) => /^vela_session=;/.test(c)), "session cleared");
  const n = notice(first.setCookies);
  assert.ok(n, "note cookie set");
  assert.match(n, /HttpOnly/i);
  assert.match(n, /Path=\/(;|$)/i); // qa3: path "/" so guarded pages can redirect to the notice
  const noteCookie = n.split(";")[0];

  // The browser's next request (prefetch, meta refresh, reload) has no
  // session any more, only the note: the reason is looked up again.
  const again = await page("/login?suspended=1", noteCookie);
  assert.ok(again.text.includes("Your listing and account are suspended"), "listing wording");
  assert.ok(again.text.includes(REASON), "reason on the follow-up request");

  // Only on the suspended notice, never on a plain /login.
  const plain = await page("/login", noteCookie);
  assert.ok(!plain.text.includes(REASON));

  // Reinstated: generic again and the note is dropped.
  await db().query("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = $1", [v.userId]);
  const back = await page("/login?suspended=1", noteCookie);
  assert.ok(!back.text.includes(REASON));
  assert.ok(back.setCookies.some((c) => /^vela_suspended=;/.test(c)), "note dropped");
});

test("QA-056: the reason can't be injected or read without the signed note", async () => {
  await suspendedVendor();
  const forged = await page(`/login?suspended=1&reason=${encodeURIComponent("Injected text")}`, "vela_suspended=not-a-token");
  assert.ok(!forged.text.includes(REASON));
  assert.ok(!forged.text.includes("Injected text"));
  assert.ok(forged.text.includes("This account is suspended"), "generic notice");
  assert.ok(forged.setCookies.some((c) => /^vela_suspended=;/.test(c)), "bad note dropped");
  // A client-sent copy of the internal header is ignored.
  const res = await fetch(`${BASE_URL}/login?suspended=1`, { headers: { "x-vela-suspension": "Injected%20text" } });
  assert.ok(!(await res.text()).includes("Injected text"));
});
