// Vendor tools for the customer journey (PRODUCT_PLAN P2-6 calendar, P2-11
// reviews v2, P2-14 insights). Needs a running dev server (BASE_URL) and the
// LOCAL database:
//
//   BASE_URL=http://localhost:3155 node --env-file-if-exists=.env.local --test tests/customer-vendortools.test.mjs
//
// Test users are custtest-vtools-<digits>@example.com; they and everything
// they own (listings, enquiries, reviews, calendar rows, events) are removed
// at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, db, closeDb, createListing, RUN_ID } from "./admin-helpers.mjs";

const PATTERN = "^custtest-vtools-[0-9]+@example\\.com$";
const TAG = `vtools${RUN_ID}`;
let seq = 0;
const email = () => `custtest-vtools-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

/** YYYY-MM-DD in India, n days from today. */
function istDate(n) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  // Listings cascade to their availability, events, reviews and enquiries.
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function user(role, name) {
  const s = await signup({ role, name, email: email() });
  if (!s.cookie) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  return s;
}

/** Inserts an enquiry straight into the DB (past event dates can't go through the API). */
async function enquiry(vendorId, { customerId = null, status = "pending", eventDate = null, slot = null, createdDaysAgo = 0 } = {}) {
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, slot, status, created_at, message)
     VALUES ($1, $2, 'Vtools Customer', '+919847000000', $3::date, $4, $5, now() - make_interval(days => $6), $7)
     RETURNING id`,
    [vendorId, customerId, eventDate, slot, status, createdDaysAgo, TAG]
  );
  return rows[0].id;
}

const S = {};
const put = (cookie, body) => request("/api/vendor/availability", { method: "PUT", body, cookie });
const month = (d) => d.slice(0, 7);
const search = (date) => request(`/api/vendors?${new URLSearchParams({ q: TAG, date }).toString()}`);
const listed = (r) => (r.data?.vendors ?? []).some((v) => v.id === S.l1.id);
const row = async (date, slot = "full") =>
  (await db().query("SELECT * FROM vendor_availability WHERE vendor_id = $1 AND date = $2::date AND slot = $3", [S.l1.id, date, slot]))
    .rows[0];

before(async () => {
  await cleanup();
  S.v1 = await user("vendor", "Vtools Vendor One");
  S.v2 = await user("vendor", "Vtools Vendor Two");
  S.v3 = await user("vendor", "Vtools Vendor Three");
  S.vNone = await user("vendor", "Vtools No Listing");
  S.c1 = await user("customer", "Vtools Cust One");
  S.c2 = await user("customer", "Vtools Cust Two");
  S.c3 = await user("customer", "Vtools Cust Three");
  S.l1 = await createListing(S.v1.userId, { name: `Vtools Lens ${TAG}`, status: "approved" });
  S.l2 = await createListing(S.v2.userId, { name: `Vtools Other ${TAG}`, status: "approved" });
  S.l3 = await createListing(S.v3.userId, { name: `Vtools Insights ${TAG}`, status: "approved" });
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// P2-6 calendar
// ---------------------------------------------------------------------------

test("calendar: role guards and own-listing only", async () => {
  assert.equal((await request("/api/vendor/availability")).status, 401);
  assert.equal((await request("/api/vendor/availability", { cookie: S.c1.cookie })).status, 403);
  assert.equal((await put(S.c1.cookie, { action: "block", from: istDate(30) })).status, 403);
  const none = await request("/api/vendor/availability", { cookie: S.vNone.cookie });
  assert.equal(none.status, 404);
  assert.equal(none.data.code, "NO_LISTING");
  const ok = await request("/api/vendor/availability", { cookie: S.v1.cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.month, istDate(0).slice(0, 7));
  assert.equal(ok.data.defaultCapacity, 1);
  assert.equal(ok.headers.cacheControl, "private, no-store");
});

test("calendar: invalid input is a 400 naming the field", async () => {
  const bad = [
    [{ action: "nope", from: istDate(30) }, "action"],
    [{ action: "block" }, "from"],
    [{ action: "block", from: "2027-02-30" }, "from"],
    [{ action: "block", from: istDate(30), to: istDate(29) }, "to"],
    [{ action: "block", from: istDate(30), to: istDate(30 + 120) }, "to"],
    [{ action: "block", from: istDate(30), slot: "night" }, "slot"],
    [{ action: "capacity", from: istDate(30), capacity: 0 }, "capacity"],
    [{ action: "capacity", from: istDate(30), capacity: 51 }, "capacity"],
    [{ action: "capacity", from: istDate(30), capacity: 1.5 }, "capacity"],
    [{ action: "block", from: istDate(30), note: "x".repeat(201) }, "note"],
    [{ action: "block", from: istDate(30), force: "yes" }, "force"],
  ];
  for (const [body, field] of bad) {
    const r = await put(S.v1.cookie, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.data.field, field, JSON.stringify(body));
  }
  const past = await put(S.v1.cookie, { action: "block", from: istDate(-2) });
  assert.equal(past.status, 400);
  assert.equal(past.data.code, "PAST_DATE");
  assert.equal((await request("/api/vendor/availability?month=2027-13", { cookie: S.v1.cookie })).status, 400);
  assert.equal((await request("/api/vendor/availability?month=abc", { cookie: S.v1.cookie })).status, 400);
});

test("calendar: blocking a date removes the vendor from search on that date only; unblocking restores it", async () => {
  const D = istDate(40);
  assert.ok(listed(await search(D)), "listed before the block");
  const r = await put(S.v1.cookie, { action: "block", from: D, note: "Family wedding" });
  assert.equal(r.status, 200);
  assert.equal(r.data.days, 1);
  const stored = await row(D);
  assert.equal(stored.status, "blocked");
  assert.equal(stored.note, "Family wedding");

  const cal = await request(`/api/vendor/availability?month=${month(D)}`, { cookie: S.v1.cookie });
  assert.equal(cal.data.days[D][0].state, "blocked");
  assert.equal(listed(await search(D)), false, "blocked date hides the vendor");
  assert.ok(listed(await search(istDate(41))), "the next day is unaffected");

  // Another vendor's calendar never shows (or changes) this one.
  const other = await request(`/api/vendor/availability?month=${month(D)}`, { cookie: S.v2.cookie });
  assert.equal(other.data.days[D], undefined);

  // Enquiry on a blocked date: allowed, with a warning (section 9 #22).
  const enq = await request(`/api/vendors/${S.l1.id}/quotes`, {
    method: "POST",
    body: { name: "Vtools Guest", phone: "9847011111", eventDate: D, message: TAG },
  });
  assert.equal(enq.status, 201, JSON.stringify(enq.data));
  assert.ok(enq.data.warnings.some((w) => w.code === "DATE_UNAVAILABLE"));

  const un = await put(S.v1.cookie, { action: "unblock", from: D });
  assert.equal(un.status, 200);
  assert.equal(await row(D), undefined, "an unblocked default day leaves no row");
  assert.ok(listed(await search(D)));
});

test("calendar: half-day blocks and bulk ranges", async () => {
  const from = istDate(60);
  const to = istDate(64);
  const r = await put(S.v1.cookie, { action: "block", from, to, slot: "morning" });
  assert.equal(r.status, 200);
  assert.equal(r.data.days, 5);
  const n = await db().query(
    "SELECT count(*)::int AS n FROM vendor_availability WHERE vendor_id = $1 AND date BETWEEN $2::date AND $3::date AND slot = 'morning' AND status = 'blocked'",
    [S.l1.id, from, to]
  );
  assert.equal(n.rows[0].n, 5);
  assert.ok(listed(await search(istDate(62))), "a morning block alone keeps the vendor in search");
  await put(S.v1.cookie, { action: "block", from: istDate(62), slot: "evening" });
  assert.equal(listed(await search(istDate(62))), false, "morning and evening both blocked hides the vendor");
  assert.equal((await put(S.v1.cookie, { action: "unblock", from, to, slot: "morning" })).status, 200);
  assert.equal((await put(S.v1.cookie, { action: "unblock", from: istDate(62), slot: "evening" })).status, 200);
  const left = await db().query(
    "SELECT count(*)::int AS n FROM vendor_availability WHERE vendor_id = $1 AND date BETWEEN $2::date AND $3::date",
    [S.l1.id, from, to]
  );
  assert.equal(left.rows[0].n, 0);
});

test("calendar: blocking a date with an open enquiry warns (409) until confirmed", async () => {
  const D = istDate(45);
  const leadId = await enquiry(S.l1.id, { eventDate: D, status: "responded", slot: "evening" });
  const r = await put(S.v1.cookie, { action: "block", from: D, slot: "evening" });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "PENDING_LEADS");
  assert.deepEqual(r.data.leads.map((l) => l.id), [leadId]);
  assert.equal(await row(D, "evening"), undefined, "nothing written without confirmation");
  // A morning block doesn't clash with an evening enquiry.
  assert.equal((await put(S.v1.cookie, { action: "block", from: D, slot: "morning" })).status, 200);
  const forced = await put(S.v1.cookie, { action: "block", from: D, slot: "evening", force: true });
  assert.equal(forced.status, 200);
  assert.equal((await row(D, "evening")).status, "blocked");
  const cal = await request(`/api/vendor/availability?month=${month(D)}`, { cookie: S.v1.cookie });
  assert.ok(cal.data.openLeads.some((l) => l.id === leadId && l.date === D));
});

test("calendar: marking a lead booked increments capacity_used; capacity 2 with 1 booked is limited", async () => {
  const D = istDate(50);
  // Default capacity 1: booking fills the day.
  const one = await enquiry(S.l1.id, { eventDate: D });
  const b1 = await request(`/api/vendor/leads/${one}`, { method: "PATCH", body: { status: "booked" }, cookie: S.v1.cookie });
  assert.equal(b1.status, 200, JSON.stringify(b1.data));
  let r = await row(D);
  assert.equal(r.capacity_used, 1);
  assert.equal(r.status, "booked");
  assert.equal(listed(await search(D)), false, "a full day hides the vendor");

  // Raise D to 2: one place left -> limited, back in search.
  const cap = await put(S.v1.cookie, { action: "capacity", from: D, capacity: 2 });
  assert.equal(cap.status, 200);
  r = await row(D);
  assert.equal(r.capacity_total, 2);
  assert.equal(r.status, "limited");
  let cal = await request(`/api/vendor/availability?month=${month(D)}`, { cookie: S.v1.cookie });
  assert.equal(cal.data.days[D][0].state, "limited");
  assert.ok(cal.data.bookings.some((b) => b.id === one));
  assert.ok(listed(await search(D)), "limited still shows in search");

  // A second booking fills it.
  const two = await enquiry(S.l1.id, { eventDate: D });
  await request(`/api/vendor/leads/${two}`, { method: "PATCH", body: { status: "booked" }, cookie: S.v1.cookie });
  r = await row(D);
  assert.equal(r.capacity_used, 2);
  assert.equal(r.status, "booked");
  const low = await put(S.v1.cookie, { action: "capacity", from: D, capacity: 1 });
  assert.equal(low.status, 400);
  assert.equal(low.data.code, "CAPACITY_BELOW_BOOKED");
  assert.deepEqual(low.data.dates, [D]);

  // Un-booking frees a place again; the customer path goes through the same hook.
  const un = await request(`/api/vendor/leads/${two}`, { method: "PATCH", body: { status: "responded" }, cookie: S.v1.cookie });
  assert.equal(un.status, 200);
  r = await row(D);
  assert.equal(r.capacity_used, 1);
  assert.equal(r.status, "limited");
  cal = await request(`/api/vendor/availability?month=${month(D)}`, { cookie: S.v1.cookie });
  assert.equal(cal.data.days[D][0].state, "limited");

  // A booking on a manually blocked day keeps the block.
  const D3 = istDate(52);
  await put(S.v1.cookie, { action: "block", from: D3 });
  const three = await enquiry(S.l1.id, { eventDate: D3 });
  await request(`/api/vendor/leads/${three}`, { method: "PATCH", body: { status: "booked" }, cookie: S.v1.cookie });
  r = await row(D3);
  assert.equal(r.status, "blocked");
  assert.equal(r.capacity_used, 1);
});

// ---------------------------------------------------------------------------
// P2-11 reviews v2
// ---------------------------------------------------------------------------

const review = (cookie, vendorId, body = {}) =>
  request(`/api/vendors/${vendorId}/reviews`, {
    method: "POST",
    body: { rating: 5, body: `Lovely work, thank you ${TAG}`, ...body },
    cookie,
  });

test("reviews: need a past event the vendor replied to or was booked for; verified only when booked/accepted", async () => {
  // No enquiry -> 403.
  const none = await review(S.c1.cookie, S.l2.id);
  assert.equal(none.status, 403);
  assert.equal(none.data.code, "NO_ENQUIRY");
  // Vendors can't review.
  assert.equal((await review(S.v2.cookie, S.l1.id)).status, 403);

  // Booked, but the event is still ahead -> refused until the event (QA-038).
  await enquiry(S.l2.id, { customerId: S.c1.userId, status: "booked", eventDate: istDate(20) });
  const early = await review(S.c1.cookie, S.l2.id);
  assert.equal(early.status, 403, JSON.stringify(early.data));
  assert.equal(early.data.code, "NOT_ELIGIBLE", "no review before the event date");
  // The vendor replied and that event has passed -> allowed, unverified.
  await enquiry(S.l2.id, { customerId: S.c1.userId, status: "responded", eventDate: istDate(-1) });
  const replied = await review(S.c1.cookie, S.l2.id);
  assert.equal(replied.status, 201, JSON.stringify(replied.data));
  assert.equal(replied.data.review.verified, false, "a review without a booking is unverified");
  assert.equal((await review(S.c1.cookie, S.l2.id)).status, 409, "one review per customer");

  // Booked and the event has passed -> verified, linked to that enquiry.
  const pastBooked = await enquiry(S.l2.id, { customerId: S.c2.userId, status: "booked", eventDate: istDate(-3) });
  await enquiry(S.l2.id, { customerId: S.c2.userId, status: "pending", eventDate: istDate(30) });
  const late = await review(S.c2.cookie, S.l2.id, { rating: 4 });
  assert.equal(late.status, 201);
  assert.equal(late.data.review.verified, true, "a review after a booked event is verified");
  assert.equal(late.data.review.quote_request_id, pastBooked);

  // Past date but the vendor never replied -> refused; a bad enquiryId is a 400.
  await enquiry(S.l2.id, { customerId: S.c3.userId, status: "pending", eventDate: istDate(-5) });
  const badId = await review(S.c3.cookie, S.l2.id, { enquiryId: 999999999 });
  assert.equal(badId.status, 400);
  assert.equal(badId.data.field, "enquiryId");
  const pend = await review(S.c3.cookie, S.l2.id, { rating: 3 });
  assert.equal(pend.status, 403);
  assert.equal(pend.data.code, "NOT_ELIGIBLE");

  // The vendor got a notification for each new review.
  const n = await db().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'review.new'", [S.v2.userId]);
  assert.equal(n.rows[0].n, 2);
  S.reviewId = late.data.review.id;
});

test("reviews: one public reply per review, editable for 7 days, own reviews only", async () => {
  const url = `/api/vendor/reviews/${S.reviewId}/reply`;
  assert.equal((await request(url, { method: "POST", body: { body: "Thanks!" } })).status, 401);
  assert.equal((await request(url, { method: "POST", body: { body: "Thanks!" }, cookie: S.c2.cookie })).status, 403);
  const foreign = await request(url, { method: "POST", body: { body: "Not mine" }, cookie: S.v1.cookie });
  assert.equal(foreign.status, 403, "another vendor's review");
  assert.equal((await request(url, { method: "POST", body: { body: " " }, cookie: S.v2.cookie })).status, 400);
  assert.equal((await request(url, { method: "POST", body: { body: "x".repeat(1001) }, cookie: S.v2.cookie })).status, 400);
  assert.equal((await request("/api/vendor/reviews/abc/reply", { method: "POST", body: { body: "Hi" }, cookie: S.v2.cookie })).status, 400);
  assert.equal((await request("/api/vendor/reviews/999999999/reply", { method: "POST", body: { body: "Hi" }, cookie: S.v2.cookie })).status, 404);
  assert.equal((await request(url, { method: "PATCH", body: { body: "Edit first?" }, cookie: S.v2.cookie })).status, 404, "nothing to edit yet");

  const text = `Thank you for having us, ${TAG}!`;
  const first = await request(url, { method: "POST", body: { body: text }, cookie: S.v2.cookie });
  assert.equal(first.status, 201);
  assert.equal(first.data.reply.body, text);
  const second = await request(url, { method: "POST", body: { body: "Again" }, cookie: S.v2.cookie });
  assert.equal(second.status, 409);
  assert.equal(second.data.code, "REPLY_EXISTS");

  const edited = `${text} See you again.`;
  const edit = await request(url, { method: "PATCH", body: { body: edited }, cookie: S.v2.cookie });
  assert.equal(edit.status, 200);
  assert.ok(edit.data.reply.editedAt);

  // The customer is told about the reply.
  const n = await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'review.reply'", [S.c2.userId]);
  assert.equal(n.rows.length, 1);
  assert.equal(n.rows[0].payload.link, `/vendors/${S.l2.id}#review-${S.reviewId}`);

  // Shown publicly: the profile API and page.
  const api = await request(`/api/vendors/${S.l2.id}`);
  assert.equal(api.data.reviews.find((r) => r.id === S.reviewId)?.vendor_reply, edited);
  const page = await request(`/vendors/${S.l2.id}`);
  assert.ok(page.text.includes(`Reply from ${S.l2.name}`), "reply heading on the public profile");
  assert.ok(page.text.includes("See you again."), "reply text on the public profile");
  assert.ok(page.text.includes("Verified booking"), "verified tag on the public profile");

  // After 7 days the reply is locked.
  await db().query("UPDATE vendor_reviews SET vendor_reply_at = now() - interval '8 days' WHERE id = $1", [S.reviewId]);
  const locked = await request(url, { method: "PATCH", body: { body: "Too late" }, cookie: S.v2.cookie });
  assert.equal(locked.status, 409);
  assert.equal(locked.data.code, "EDIT_WINDOW_CLOSED");

  // Hidden reviews can't be replied to.
  const other = (await db().query("SELECT id FROM vendor_reviews WHERE vendor_id = $1 AND id <> $2 LIMIT 1", [S.l2.id, S.reviewId])).rows[0].id;
  await db().query("UPDATE vendor_reviews SET hidden_at = now() WHERE id = $1", [other]);
  const hidden = await request(`/api/vendor/reviews/${other}/reply`, { method: "POST", body: { body: "Hello" }, cookie: S.v2.cookie });
  assert.equal(hidden.status, 409);
  assert.equal(hidden.data.code, "REVIEW_HIDDEN");
});

// ---------------------------------------------------------------------------
// P2-14 insights
// ---------------------------------------------------------------------------

async function events(vendorId, kind, count, daysAgo) {
  await db().query(
    `INSERT INTO vendor_events (vendor_id, kind, created_at)
     SELECT $1, $2, now() - make_interval(days => $3) - make_interval(mins => g) FROM generate_series(1, $4) g`,
    [vendorId, kind, daysAgo, count]
  );
}

test("insights: guards, validation and the zero state", async () => {
  assert.equal((await request("/api/vendor/insights")).status, 401);
  assert.equal((await request("/api/vendor/insights", { cookie: S.c1.cookie })).status, 403);
  assert.equal((await request("/api/vendor/insights", { cookie: S.vNone.cookie })).status, 404);
  const bad = await request("/api/vendor/insights?range=14", { cookie: S.v3.cookie });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.field, "range");
  const zero = await request("/api/vendor/insights", { cookie: S.v3.cookie });
  assert.equal(zero.status, 200);
  assert.equal(zero.data.insights.range, 30);
  assert.deepEqual(zero.data.insights.current, {
    views: 0,
    whatsappClicks: 0,
    phoneReveals: 0,
    enquiries: 0,
    replied: 0,
    booked: 0,
    bookedRate: null,
  });
  const page = await request("/vendor/insights", { cookie: S.v3.cookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes("Nothing in the last 30 days yet"));
});

test("insights: numbers match the vendor_events and enquiry fixtures", async () => {
  const id = S.l3.id;
  await events(id, "profile_view", 3, 1);
  await events(id, "profile_view", 1, 20);
  await events(id, "whatsapp_click", 2, 2);
  await events(id, "whatsapp_click", 1, 40);
  await events(id, "phone_reveal", 1, 3);
  // Another vendor's events never count.
  await events(S.l1.id, "profile_view", 5, 1);
  for (const status of ["booked", "responded", "pending", "pending"]) await enquiry(id, { status, createdDaysAgo: 1 });
  await enquiry(id, { status: "booked", createdDaysAgo: 10 });
  await enquiry(id, { status: "declined", createdDaysAgo: 50 });

  const get = async (range) => (await request(`/api/vendor/insights?range=${range}`, { cookie: S.v3.cookie })).data.insights;
  const w = await get(7);
  assert.deepEqual(w.current, { views: 3, whatsappClicks: 2, phoneReveals: 1, enquiries: 4, replied: 2, booked: 1, bookedRate: 0.25 });
  assert.deepEqual(w.previous, { views: 0, whatsappClicks: 0, phoneReveals: 0, enquiries: 1, replied: 1, booked: 1, bookedRate: 1 });
  assert.deepEqual(w.byStatus, { booked: 1, responded: 1, pending: 2 });

  const m = await get(30);
  assert.deepEqual(m.current, { views: 4, whatsappClicks: 2, phoneReveals: 1, enquiries: 5, replied: 3, booked: 2, bookedRate: 0.4 });
  assert.deepEqual(m.previous, { views: 0, whatsappClicks: 1, phoneReveals: 0, enquiries: 1, replied: 1, booked: 0, bookedRate: 0 });

  const q = await get(90);
  assert.equal(q.current.views, 4);
  assert.equal(q.current.whatsappClicks, 3);
  assert.equal(q.current.enquiries, 6);
  assert.equal(q.current.booked, 2);

  const page = await request("/vendor/insights?range=7", { cookie: S.v3.cookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes("25%"), "booked rate on the page");
  assert.ok(!page.text.includes("Nothing in the last"), "no zero state with data");
});

test("pages: calendar, reviews and insights render for the vendor and stay closed to customers", async () => {
  for (const p of ["/vendor/calendar", "/vendor/reviews", "/vendor/insights"]) {
    const ok = await request(p, { cookie: S.v1.cookie });
    assert.equal(ok.status, 200, p);
  }
  const cal = await request(`/vendor/calendar?month=${month(istDate(50))}`, { cookie: S.v1.cookie });
  assert.ok(cal.text.includes("Block a range"));
  const rev = await request("/vendor/reviews", { cookie: S.v2.cookie });
  assert.ok(rev.text.includes("Request a review"));
  assert.ok(rev.text.includes("Verified booking"));
  const cust = await request("/vendor/calendar", { cookie: S.c1.cookie });
  assert.notEqual(cust.status, 200, "customers never get the vendor calendar");
});
