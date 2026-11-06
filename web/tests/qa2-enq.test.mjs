// QA round 2, customer enquiries and reviews ('enq' group):
//   QA-037  the per-user / per-IP limits on single quotes and the
//           multi-vendor send are counted in Postgres (rate_limit_counters),
//           shared by every server instance, like sign-in and sign-up.
//   QA-038  a review needs a finished, real dealing: an enquiry whose event
//           date has passed and that the vendor replied to or was booked for.
//   QA-040  a signed-in customer's second open enquiry to the same vendor for
//           the same date is refused (409 with the existing enquiry id), for
//           the single sheet and the multi send; the profile says so.
//   QA-041  the single-vendor quote sheet starts from the customer's saved
//           details, like the multi-vendor sheet (QA-029).
//
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3152 node --env-file-if-exists=.env.local --test tests/qa2-enq.test.mjs
//
// Test users are qa2fix-enq-<digits>@example.com; they and what they own are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request, signup, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^qa2fix-enq-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa2fix-enq-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
// A run-unique phone, so the 15-a-day per-phone enquiry cap is never hit by
// earlier runs or other suites that share the old fixed number.
const PHONE = `98${String(RUN_ID).padStart(8, "0").slice(-8)}`;
const usedKeys = [];

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (ids.length) {
    const vendorIds = (await db().query("SELECT id FROM vendors WHERE owner_id = ANY($1::int[])", [ids])).rows.map((r) => r.id);
    await db().query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[]) OR vendor_id = ANY($2::int[])", [ids, vendorIds]);
    await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[]) OR vendor_id = ANY($2::int[])", [ids, vendorIds]);
    await db().query("DELETE FROM notifications WHERE user_id = ANY($1::int[])", [ids]);
    await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
    await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  }
  if (usedKeys.length) await db().query("DELETE FROM rate_limit_counters WHERE key = ANY($1::text[])", [usedKeys.map(dbKey)]);
}

/** Same hashing as lib/rate-limit.ts. */
const dbKey = (key) => createHash("sha256").update(key).digest("hex");

async function counterHits(key) {
  usedKeys.push(key);
  const r = await db().query("SELECT hits FROM rate_limit_counters WHERE key = $1 AND reset_at > now()", [dbKey(key)]);
  return r.rows[0]?.hits ?? 0;
}

/** Fills a shared counter as if other server instances had counted `hits` already. */
async function preload(key, hits) {
  usedKeys.push(key);
  await db().query(
    `INSERT INTO rate_limit_counters (key, hits, reset_at) VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (key) DO UPDATE SET hits = EXCLUDED.hits, reset_at = EXCLUDED.reset_at`,
    [dbKey(key), hits]
  );
}

const F = {};

async function customer(name) {
  const s = await signup({ role: "customer", name, email: email(), password: TEST_PASSWORD });
  assert.equal(s.status, 201, `signup: ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId };
}

async function listing(name) {
  const owner = await db().query("INSERT INTO users (name, email, password_hash, role) VALUES ('Qa2fix Owner', $1, 'x', 'vendor') RETURNING id", [
    email(),
  ]);
  const l = await createListing(owner.rows[0].id, { name: `${name} ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [l.id]);
  return { id: l.id, ownerId: owner.rows[0].id };
}

/** Days from today in India as YYYY-MM-DD. */
function isoDay(offset) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const quote = (vendorId, body, opts = {}) =>
  request(`/api/vendors/${vendorId}/quotes`, {
    method: "POST",
    body: { name: "Qa2fix Meera", phone: PHONE, ...body },
    ...opts,
  });

const multi = (vendorIds, body, opts = {}) =>
  request("/api/enquiries/multi", {
    method: "POST",
    body: { name: "Qa2fix Meera", phone: PHONE, vendorIds, ...body },
    ...opts,
  });

const review = (cookie, vendorId, body = {}) =>
  request(`/api/vendors/${vendorId}/reviews`, {
    method: "POST",
    body: { rating: 1, body: `Qa2fix review ${RUN_ID}`, ...body },
    cookie,
  });

/** Inserts an enquiry directly (status/date set as needed), returning its id. */
async function enquiry(vendorId, customerId, { status = "pending", eventDate = isoDay(30), guestCount = null } = {}) {
  const r = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, status, guest_count)
     VALUES ($1, $2, 'Qa2fix Meera', $6, $3, $4, $5) RETURNING id`,
    [vendorId, customerId, eventDate, status, guestCount, `+91${PHONE}`]
  );
  return r.rows[0].id;
}

/** The RSC payload in a page's HTML, with the JS-string escaping undone. */
const flight = (html) => html.replace(/\\"/g, '"');

before(async () => {
  await cleanup();
  F.a = await listing("Qa2fix Lens");
  F.b = await listing("Qa2fix Melam");
  F.c = await listing("Qa2fix Decor");
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-037 shared rate limits
// ---------------------------------------------------------------------------

test("QA-037: single quotes count in the shared Postgres limiter (per user and per IP)", async () => {
  const c = await customer("Qa2fix Rate");
  const key = `quote:u:${c.userId}`;
  const ok = await quote(F.a.id, { eventDate: isoDay(40) }, { cookie: c.cookie });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(await counterHits(key), 1, "the attempt is recorded in rate_limit_counters");

  // Another instance already counted 10: this one refuses too.
  await preload(key, 10);
  const limited = await quote(F.a.id, { eventDate: isoDay(41) }, { cookie: c.cookie });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, "RATE_LIMIT");

  // Guests are limited per IP through the same store.
  const ip = `203.0.113.${(RUN_ID % 200) + 1}`;
  await preload(`quote:ip:${ip}`, 10);
  const guest = await quote(F.a.id, { eventDate: isoDay(42) }, { headers: { "X-Forwarded-For": ip } });
  assert.equal(guest.status, 429);
});

test("QA-037: the multi-vendor send counts in the shared Postgres limiter", async () => {
  const c = await customer("Qa2fix Multi Rate");
  const key = `quote-multi:u:${c.userId}`;
  const ok = await multi([F.b.id], { eventDate: isoDay(43) }, { cookie: c.cookie });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(await counterHits(key), 1);
  await preload(key, 6);
  const limited = await multi([F.c.id], { eventDate: isoDay(44) }, { cookie: c.cookie });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, "RATE_LIMIT");
});

// ---------------------------------------------------------------------------
// QA-040 duplicate enquiries
// ---------------------------------------------------------------------------

test("QA-040: a second open enquiry to the same vendor for the same date is refused with the existing id", async () => {
  const c = await customer("Qa2fix Dup");
  const date = isoDay(100);
  const first = await quote(F.a.id, { eventDate: date, guestCount: 300 }, { cookie: c.cookie });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const firstId = first.data.enquiry.id;

  const again = await quote(F.a.id, { eventDate: date, guestCount: 300, message: "again" }, { cookie: c.cookie });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.code, "ALREADY_ENQUIRED");
  assert.equal(again.data.enquiryId, firstId);
  assert.equal(again.data.trackingPath, `/my/enquiries/${firstId}`);
  const n = await db().query("SELECT count(*)::int AS n FROM quote_requests WHERE customer_id = $1 AND vendor_id = $2", [c.userId, F.a.id]);
  assert.equal(n.rows[0].n, 1, "no duplicate row");

  // Parallel double taps: still only one.
  const date2 = isoDay(101);
  const both = await Promise.all([1, 2].map(() => quote(F.a.id, { eventDate: date2 }, { cookie: c.cookie })));
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);

  // A different date is a different event: allowed.
  const other = await quote(F.a.id, { eventDate: isoDay(120) }, { cookie: c.cookie });
  assert.equal(other.status, 201);

  // Once the first is withdrawn, the same date can be sent again.
  await db().query("UPDATE quote_requests SET status = 'withdrawn' WHERE id = $1", [firstId]);
  const resend = await quote(F.a.id, { eventDate: date }, { cookie: c.cookie });
  assert.equal(resend.status, 201);
});

test("QA-040: guests are not matched (no account to tie enquiries to)", async () => {
  const ip = `198.51.100.${(RUN_ID % 200) + 1}`;
  const date = isoDay(102);
  const opts = { headers: { "X-Forwarded-For": ip } };
  assert.equal((await quote(F.b.id, { eventDate: date }, opts)).status, 201);
  assert.equal((await quote(F.b.id, { eventDate: date }, opts)).status, 201);
  await db().query("DELETE FROM quote_requests WHERE vendor_id = $1 AND customer_id IS NULL", [F.b.id]);
});

test("QA-040: the multi send skips vendors already enquired for that date", async () => {
  const c = await customer("Qa2fix Multi Dup");
  const date = isoDay(110);
  const existing = await enquiry(F.a.id, c.userId, { eventDate: date });

  const r = await multi([F.a.id, F.b.id], { eventDate: date }, { cookie: c.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.sent, 1);
  const [ra, rb] = r.data.results;
  assert.equal(ra.vendorId, F.a.id, "results stay in the order sent");
  assert.equal(ra.ok, false);
  assert.equal(ra.code, "ALREADY_ENQUIRED");
  assert.equal(ra.enquiryId, existing);
  assert.equal(rb.ok, true);

  const all = await multi([F.a.id, F.b.id], { eventDate: date }, { cookie: c.cookie });
  assert.equal(all.status, 409);
  assert.equal(all.data.code, "ALREADY_ENQUIRED");
  assert.equal(all.data.results.length, 2);
  const n = await db().query("SELECT count(*)::int AS n FROM quote_requests WHERE customer_id = $1", [c.userId]);
  assert.equal(n.rows[0].n, 2);
});

test("QA-040/041: the profile shows the open enquiry and prefills the quote sheet", async () => {
  const c = await customer("Qa2fix Prefill");
  await db().query("UPDATE users SET phone_e164 = '+919847099999' WHERE id = $1", [c.userId]).catch(() => {});
  const date = isoDay(90);
  const id = await enquiry(F.c.id, c.userId, { eventDate: date, guestCount: 300 });

  const page = await request(`/vendors/${F.c.id}`, { cookie: c.cookie });
  assert.equal(page.status, 200);
  const html = flight(page.text);
  assert.ok(html.includes(`/my/enquiries/${id}`), "links the open enquiry");
  assert.match(html, /Enquiry sent/);
  // The sheet's props carry the saved event (QA-041).
  assert.match(html, new RegExp(`"prefill":\\{[^}]*"eventDate":"${date}"`));
  assert.match(html, /"prefill":\{[^}]*"guestCount":300/);
  assert.match(html, /"openEnquiry":\{"id":\d+/);

  // Another vendor: prefilled, no open-enquiry link.
  const other = flight((await request(`/vendors/${F.b.id}`, { cookie: c.cookie })).text);
  assert.match(other, /"prefill":\{[^}]*"guestCount":300/);
  assert.match(other, /"openEnquiry":null/);

  // Signed out: nothing personal.
  const anon = flight((await request(`/vendors/${F.c.id}`)).text);
  assert.ok(!anon.includes(`/my/enquiries/${id}`));
  assert.match(anon, /"prefill":null/);
});

// ---------------------------------------------------------------------------
// QA-038 review eligibility
// ---------------------------------------------------------------------------

test("QA-038: reviews need an event that has passed and a vendor reply or booking", async () => {
  // No enquiry at all.
  const none = await customer("Qa2fix Rev None");
  const r0 = await review(none.cookie, F.b.id);
  assert.equal(r0.status, 403);
  assert.equal(r0.data.code, "NO_ENQUIRY");

  // Just enquired (the QA repro): refused, and nothing counts in the rating.
  const fresh = await customer("Qa2fix Rev Fresh");
  const sent = await quote(F.b.id, { eventDate: isoDay(100) }, { cookie: fresh.cookie });
  assert.equal(sent.status, 201);
  const r1 = await review(fresh.cookie, F.b.id);
  assert.equal(r1.status, 403);
  assert.equal(r1.data.code, "NOT_ELIGIBLE");
  assert.match(r1.data.error, /after your event date/);
  const v = await db().query("SELECT reviews_count FROM vendors WHERE id = $1", [F.b.id]);
  assert.equal(v.rows[0].reviews_count, 0);

  // Booked but the event is still ahead: refused.
  const ahead = await customer("Qa2fix Rev Ahead");
  await enquiry(F.b.id, ahead.userId, { status: "booked", eventDate: isoDay(5) });
  assert.equal((await review(ahead.cookie, F.b.id)).status, 403);

  // Past date but the vendor never answered: refused.
  const ignored = await customer("Qa2fix Rev Ignored");
  await enquiry(F.b.id, ignored.userId, { status: "expired", eventDate: isoDay(-4) });
  await enquiry(F.b.id, ignored.userId, { status: "pending", eventDate: isoDay(-2) });
  assert.equal((await review(ignored.cookie, F.b.id)).status, 403);

  // Past date and the vendor replied: allowed, unverified.
  const replied = await customer("Qa2fix Rev Replied");
  await enquiry(F.b.id, replied.userId, { status: "responded", eventDate: isoDay(-3) });
  const r2 = await review(replied.cookie, F.b.id, { rating: 3 });
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
  assert.equal(r2.data.review.verified, false);

  // Expired after a vendor message: allowed, unverified.
  const msg = await customer("Qa2fix Rev Msg");
  const mq = await enquiry(F.b.id, msg.userId, { status: "expired", eventDate: isoDay(-6) });
  await db().query(
    "INSERT INTO quote_messages (quote_request_id, sender_role, sender_user_id, body) VALUES ($1, 'vendor', $2, 'Happy to help')",
    [mq, F.b.ownerId]
  );
  assert.equal((await review(msg.cookie, F.b.id, { rating: 4 })).status, 201);

  // Booked and the event has passed: allowed, verified, linked to it.
  const booked = await customer("Qa2fix Rev Booked");
  await enquiry(F.b.id, booked.userId, { status: "pending", eventDate: isoDay(30) });
  const bq = await enquiry(F.b.id, booked.userId, { status: "booked", eventDate: isoDay(-2) });
  const r3 = await review(booked.cookie, F.b.id, { rating: 5 });
  assert.equal(r3.status, 201);
  assert.equal(r3.data.review.verified, true);
  assert.equal(r3.data.review.quote_request_id, bq);

  // An explicit enquiryId that isn't eligible is refused too.
  const pick = await customer("Qa2fix Rev Pick");
  const futureQ = await enquiry(F.c.id, pick.userId, { status: "booked", eventDate: isoDay(10) });
  await enquiry(F.c.id, pick.userId, { status: "booked", eventDate: isoDay(-10) });
  const r4 = await review(pick.cookie, F.c.id, { enquiryId: futureQ });
  assert.equal(r4.status, 403);
  assert.equal(r4.data.code, "NOT_ELIGIBLE");
});

test("QA-038: the profile hides the review form until the customer is eligible, with copy saying why", async () => {
  const c = await customer("Qa2fix Rev Page");
  await enquiry(F.a.id, c.userId, { status: "pending", eventDate: isoDay(60) });
  const before = await request(`/vendors/${F.a.id}`, { cookie: c.cookie });
  assert.equal(before.status, 200);
  assert.ok(!before.text.includes("Post review"), "no review form yet");
  assert.match(before.text, /after your event date, once they have replied to your enquiry or you have booked them/);

  const none = await customer("Qa2fix Rev Page None");
  const page = await request(`/vendors/${F.a.id}`, { cookie: none.cookie });
  assert.match(page.text, /after an event you booked with them through Vela/);

  await enquiry(F.a.id, c.userId, { status: "booked", eventDate: isoDay(-1) });
  const after = await request(`/vendors/${F.a.id}`, { cookie: c.cookie });
  assert.ok(after.text.includes("Post review"), "the form shows once eligible");
});
