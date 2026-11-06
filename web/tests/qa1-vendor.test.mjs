// QA round 1 fixes, vendor group (event-management-qa-tracker.md):
//   QA-002 .vercelignore must not drop route folders (uploads 405 on live)
//   QA-004 legacy POST /api/vendors creates a DRAFT, never a public listing
//   QA-013 blocking dates with a booked event warns (409 BOOKED_DATES)
//   QA-014 a duplicate photo upload says where the photo already is
//   QA-030 the offer notification uses a friendly date ("20 Nov 2026")
//   QA-032 profile edit enforces the 30-character About minimum
//   QA-033 a lead with an open offer reads "Quoted" in the inbox and header
//   QA-034 masking a phone/link keeps the following whitespace
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3152 node --env-file-if-exists=.env.local --test tests/qa1-vendor.test.mjs
//
// Test users are qa1fix-vendor-<digits>@example.com; they and what they own
// are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { request, signup, db, closeDb, RUN_ID, TEST_IP, BASE_URL, WEB_DIR } from "./admin-helpers.mjs";
import { maskContactDetails } from "../lib/offering-validation.ts";
import { maskMessageContacts } from "../lib/enquiry-status.ts";
import { formatOfferDate } from "../lib/offer-math.ts";

const PATTERN = "^qa1fix-vendor-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa1fix-vendor-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

const S = {};
const istDay = (plusDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + plusDays * 86_400_000));

async function account(role, name) {
  const s = await signup({ role, name, email: email() });
  assert.ok(s.cookie, `${role} signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId, email: s.email };
}

async function enquiry(vendorId, customerId, { days = 60, status = "pending", name = "Qa1fix Customer" } = {}) {
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, status)
     VALUES ($1, $2, $3, '+919999922222', (now() AT TIME ZONE 'Asia/Kolkata')::date + $4::int, 'qa1fix vendor', 200, $5)
     RETURNING id, event_date::text AS date`,
    [vendorId, customerId, name, days, status]
  );
  return rows[0];
}

async function rawPut(url, buf, cookie, contentType) {
  const res = await fetch(new URL(url, BASE_URL), {
    method: "PUT",
    headers: { "Content-Type": contentType, "X-Forwarded-For": TEST_IP, Cookie: cookie },
    body: buf,
  });
  await res.text();
  return res.status;
}

async function uploadImage(cookie, buf, purpose) {
  const r = await request("/api/vendor/media/uploads", {
    method: "POST",
    cookie,
    body: { kind: "image", purpose, contentType: "image/jpeg", bytes: buf.byteLength },
  });
  assert.equal(r.status, 201, `reserve ${purpose}: ${JSON.stringify(r.data)}`);
  assert.equal(await rawPut(r.data.uploadUrl, buf, cookie, "image/jpeg"), 200);
  return request(`/api/vendor/media/uploads/${r.data.assetId}/complete`, { method: "POST", cookie, body: {} });
}

const LISTING = () => ({
  name: `Qa1fix Studio ${RUN_ID}`,
  category: "Photography",
  location: "Kochi",
  price: 30000,
  experience: "3 yrs",
  about: "A test photography business created by the qa1 vendor fix suite.",
});

before(async () => {
  await cleanup();
  S.vendor = await account("vendor", "Qa1fix Vendor");
  S.customer = await account("customer", "Qa1fix Customer");
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-002: .vercelignore
// ---------------------------------------------------------------------------

/** gitignore-style match of one relative path (forward slashes) against the pattern list. */
function ignoredBy(patterns, rel) {
  const toRe = (glob) =>
    new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
  const segs = rel.split("/");
  let ignored = null;
  for (const raw of patterns) {
    const neg = raw.startsWith("!");
    let p = neg ? raw.slice(1) : raw;
    p = p.replace(/\/$/, "");
    const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
    p = p.replace(/^\//, "");
    const re = toRe(p);
    let hit = false;
    if (anchored) {
      const n = p.split("/").length;
      hit = segs.length >= n && re.test(segs.slice(0, n).join("/"));
    } else {
      hit = segs.some((s) => re.test(s));
    }
    if (hit) ignored = neg ? null : raw;
  }
  return ignored;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(path.relative(WEB_DIR, full).split(path.sep).join("/"));
  }
  return out;
}

test("QA-002: .vercelignore drops no source file (route folders named uploads/tests/e2e are deployed)", () => {
  const patterns = readFileSync(path.join(WEB_DIR, ".vercelignore"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const sources = [];
  for (const d of ["app", "lib", "public", "db", "scripts"]) if (existsSync(path.join(WEB_DIR, d))) walk(path.join(WEB_DIR, d), sources);
  for (const f of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "proxy.ts", "instrumentation.ts", "postcss.config.mjs"]) {
    if (existsSync(path.join(WEB_DIR, f))) sources.push(f);
  }
  assert.ok(sources.includes("app/api/vendor/media/uploads/route.ts"), "the upload route exists");
  const dropped = sources.map((f) => [f, ignoredBy(patterns, f)]).filter(([, p]) => p);
  assert.deepEqual(dropped, [], `files excluded from the deploy: ${dropped.map(([f, p]) => `${f} (by ${p})`).join(", ")}`);
  // ...while the local-only folders are still excluded.
  for (const f of ["uploads/vendors/1/a.jpg", "tests/api.test.mjs", "e2e/flows.spec.ts", ".next/x", ".env.local", "node_modules/x/index.js"]) {
    assert.ok(ignoredBy(patterns, f), `${f} should stay out of the deploy`);
  }
  assert.equal(ignoredBy(patterns, ".env.example"), null);
});

// ---------------------------------------------------------------------------
// QA-004: legacy create is a draft
// ---------------------------------------------------------------------------

test("QA-004: POST /api/vendors creates a draft that is not public until reviewed", async () => {
  const r = await request("/api/vendors", { method: "POST", cookie: S.vendor.cookie, body: LISTING() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  S.vendorId = r.data.vendor.id;
  assert.equal(r.data.vendor.status, "draft");
  assert.equal(r.data.next, "/vendor/onboarding");
  const row = (await db().query("SELECT status, onboarding_completed_at FROM vendors WHERE id = $1", [S.vendorId])).rows[0];
  assert.equal(row.status, "draft");
  assert.equal(row.onboarding_completed_at, null);

  assert.equal((await request(`/api/vendors/${S.vendorId}`)).status, 404, "not in the public API");
  assert.equal((await request(`/vendors/${S.vendorId}`)).status, 404, "no public profile page");
  const search = await request(`/api/vendors?q=${encodeURIComponent(`Qa1fix Studio ${RUN_ID}`)}`);
  assert.equal(search.data.vendors.length, 0, "not in search");
  const q = await request(`/api/vendors/${S.vendorId}/quotes`, {
    method: "POST",
    body: { name: "Qa1fix Guest", phone: "9999933333", message: "hello" },
  });
  assert.equal(q.status, 404, "no enquiries to an unreviewed listing");

  // It still goes through the normal review path: submit says what's missing.
  const sub = await request("/api/vendor/listing/submit", { method: "POST", cookie: S.vendor.cookie });
  assert.equal(sub.status, 400);
  assert.equal(sub.data.code, "INCOMPLETE");
  assert.ok(sub.data.missing.includes("images"));
});

// ---------------------------------------------------------------------------
// QA-032: About minimum on profile edit
// ---------------------------------------------------------------------------

test("QA-032: profile edit rejects an About under 30 characters, like onboarding", async () => {
  const short = await request("/api/vendor/profile", { method: "PATCH", cookie: S.vendor.cookie, body: { about: "too short" } });
  assert.equal(short.status, 400);
  assert.equal(short.data.field, "about");
  assert.match(short.data.error, /30 characters/);
  const ok = await request("/api/vendor/profile", {
    method: "PATCH",
    cookie: S.vendor.cookie,
    body: { about: "Candid wedding photography across Ernakulam and Thrissur." },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

// ---------------------------------------------------------------------------
// QA-014: duplicate upload message
// ---------------------------------------------------------------------------

test("QA-014: re-uploading the cover photo as a portfolio photo says it is already the cover", async () => {
  const buf = readFileSync(path.join(WEB_DIR, "db", "fixtures", "media", "henna-dreams-cover.jpg"));
  const cover = await uploadImage(S.vendor.cookie, buf, "cover");
  assert.equal(cover.status, 201, JSON.stringify(cover.data));
  const again = await uploadImage(S.vendor.cookie, buf, "gallery");
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.asset.id, cover.data.asset.id);
  assert.match(again.data.message, /already in your media as your cover photo/);
});

// ---------------------------------------------------------------------------
// QA-013: blocking a range with a booked event
// ---------------------------------------------------------------------------

test("QA-013: blocking dates with a booked event warns first; To before From is a 400", async () => {
  const booked = await enquiry(S.vendorId, S.customer.userId, { days: 40, status: "booked" });
  const from = istDay(38);
  const to = istDay(42);
  const warn = await request("/api/vendor/availability", {
    method: "PUT",
    cookie: S.vendor.cookie,
    body: { action: "block", from, to, slot: "full" },
  });
  assert.equal(warn.status, 409, JSON.stringify(warn.data));
  assert.equal(warn.data.code, "BOOKED_DATES");
  assert.deepEqual(warn.data.bookings.map((b) => b.id), [booked.id]);
  const n = (await db().query("SELECT count(*)::int AS n FROM vendor_availability WHERE vendor_id = $1", [S.vendorId])).rows[0].n;
  assert.equal(n, 0, "nothing blocked before the vendor confirms");

  const forced = await request("/api/vendor/availability", {
    method: "PUT",
    cookie: S.vendor.cookie,
    body: { action: "block", from, to, slot: "full", force: true },
  });
  assert.equal(forced.status, 200);
  const month = await request(`/api/vendor/availability?month=${booked.date.slice(0, 7)}`, { cookie: S.vendor.cookie });
  assert.ok(month.data.bookings.some((b) => b.id === booked.id), "the booking stays on the calendar");

  const backwards = await request("/api/vendor/availability", {
    method: "PUT",
    cookie: S.vendor.cookie,
    body: { action: "block", from: istDay(50), to: istDay(45) },
  });
  assert.equal(backwards.status, 400);
  assert.equal(backwards.data.field, "to");
});

// ---------------------------------------------------------------------------
// QA-030 + QA-033: offer notification date, Quoted status
// ---------------------------------------------------------------------------

test("QA-030/QA-033: offer notification shows a friendly date; the lead reads Quoted", async () => {
  const lead = await enquiry(S.vendorId, S.customer.userId, { days: 70, name: `Qa1fix Quoted ${RUN_ID}` });
  const validUntil = istDay(14);
  const r = await request(`/api/vendor/leads/${lead.id}/offers`, {
    method: "POST",
    cookie: S.vendor.cookie,
    body: { lines: [{ label: "Candid photography", qty: 1, unit: "event", unitPrice: 45000 }], subtotal: 45000, validUntil, advancePct: 20 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const note = (
    await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'enquiry.offer' ORDER BY id DESC LIMIT 1", [
      S.customer.userId,
    ])
  ).rows[0];
  const text = JSON.stringify(note.payload);
  const friendly = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${validUntil}T00:00:00Z`)
  );
  assert.ok(text.includes(`valid until ${friendly}`), text);
  assert.ok(!text.includes(validUntil), "no raw ISO date");

  const tab = await request("/vendor/leads?status=quoted", { cookie: S.vendor.cookie });
  assert.equal(tab.status, 200);
  assert.ok(tab.text.includes(`Qa1fix Quoted ${RUN_ID}`), "listed under Quoted");
  assert.match(tab.text, /data-status-pill="quoted"/);
  const detail = await request(`/vendor/leads/${lead.id}`, { cookie: S.vendor.cookie });
  assert.equal(detail.status, 200);
  assert.match(detail.text, /data-status-pill="quoted"/, "the lead header says Quoted");
});

// ---------------------------------------------------------------------------
// Units: QA-030 formatter, QA-034 masking whitespace
// ---------------------------------------------------------------------------

test("QA-030: formatOfferDate", () => {
  assert.equal(formatOfferDate("2026-11-20"), "20 Nov 2026");
  assert.equal(formatOfferDate("not a date"), "not a date");
});

test("QA-034: masking keeps the whitespace after a phone number or link", () => {
  const src = "Candid coverage. Call me at 9847012345 or visit www.example.com for more.";
  assert.equal(maskContactDetails(src).text, "Candid coverage. Call me at ••• or visit ••• for more.");
  assert.equal(maskContactDetails("Ring 98470 12345\nThanks").text, "Ring •••\nThanks");
  assert.equal(maskMessageContacts("Call 9847012345  now", true).text, "Call •••  now");
});
