// Enquiry thread, offers, status machine and notifications (PRODUCT_PLAN
// P2-4, P2-5, P2-13). Unit tests for lib/enquiry-status.ts and
// lib/offer-math.ts need nothing; the API tests need a running dev server
// (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3152 node --env-file-if-exists=.env.local --test tests/customer-thread.test.mjs
//
// Test users are custtest-thread-<digits>@example.com and are removed (with
// their listings, enquiries and notifications) at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, login, db, closeDb, createListing, RUN_ID } from "./admin-helpers.mjs";
import {
  canTransition,
  nextStatuses,
  canSendOffer,
  canMessage,
  maskMessageContacts,
  billingEnabled,
  ENQUIRY_STATUSES,
} from "../lib/enquiry-status.ts";
import { parseOfferBody, rupeesToPaise, formatPaise } from "../lib/offer-math.ts";

const PATTERN = "^custtest-thread-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `custtest-thread-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

// ---------------------------------------------------------------------------
// Unit: status machine
// ---------------------------------------------------------------------------

test("machine: nothing moves a withdrawn enquiry, for any actor", () => {
  for (const to of ENQUIRY_STATUSES) {
    for (const actor of ["vendor", "customer", "system"]) assert.equal(canTransition("withdrawn", to, actor), false, `${actor} -> ${to}`);
  }
});

test("machine: per-actor rules", () => {
  assert.equal(canTransition("responded", "accepted", "customer"), true);
  assert.equal(canTransition("accepted", "booked", "customer"), true);
  assert.equal(canTransition("responded", "booked", "customer"), false, "customer books only after accepting");
  assert.equal(canTransition("booked", "withdrawn", "customer"), false);
  assert.equal(canTransition("pending", "accepted", "vendor"), false, "only the customer accepts");
  assert.equal(canTransition("pending", "withdrawn", "vendor"), false, "only the customer withdraws");
  assert.equal(canTransition("pending", "responded", "vendor"), true);
  assert.equal(canTransition("accepted", "booked", "vendor"), true);
  assert.equal(canTransition("pending", "expired", "system"), true);
  assert.equal(canTransition("booked", "expired", "system"), false);
  assert.equal(canTransition("pending", "pending", "vendor"), false, "same status is not a transition");
  assert.equal(canTransition("nope", "booked", "vendor"), false);
  assert.deepEqual(nextStatuses("withdrawn", "vendor"), []);
  assert.equal(canSendOffer("booked"), false);
  assert.equal(canSendOffer("withdrawn"), false);
  assert.equal(canSendOffer("accepted"), true);
  assert.equal(canMessage("expired"), false);
  assert.equal(canMessage("booked"), true);
});

// ---------------------------------------------------------------------------
// Unit: contact masking (BILLING_ENABLED)
// ---------------------------------------------------------------------------

test("mask: contact details hidden only while billing is on", () => {
  const msg = "Call +91 98470 12345, mail me@x.com or wa.me/919847012345. 300 plates on 12/12/2026 for ₹45000";
  const on = maskMessageContacts(msg, true);
  assert.equal(on.masked, true);
  assert.doesNotMatch(on.text, /98470|me@x\.com|wa\.me/);
  assert.match(on.text, /300 plates on 12\/12\/2026 for ₹45000/, "ordinary numbers stay");
  const off = maskMessageContacts(msg, false);
  assert.deepEqual(off, { text: msg, masked: false });
  assert.equal(billingEnabled({ BILLING_ENABLED: "true" }), true);
  assert.equal(billingEnabled({}), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: "false" }), false);
});

// ---------------------------------------------------------------------------
// Unit: offer parsing and totals
// ---------------------------------------------------------------------------

const TODAY = "2026-11-06";
const goodOffer = () => ({
  lines: [
    { label: "Veg sadya", qty: 300, unit: "plate", unitPrice: "450" },
    { label: "Stage decor", qty: 1, unit: "event", unitPrice: 25000.5 },
  ],
  subtotal: "160000.50",
  travel: 2000,
  discount: "500",
  validUntil: "2026-11-20",
  advancePct: 25,
  terms: "Advance on booking.",
});

test("offer: totals are recomputed in paise", () => {
  const r = parseOfferBody(goodOffer(), TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.offer.lines.map((l) => l.amountPaise), [13500000, 2500050]);
  assert.equal(r.offer.subtotalPaise, 16000050);
  assert.equal(r.offer.totalPaise, 16000050 + 200000 - 50000);
  assert.equal(rupeesToPaise("1,234.5"), 123450);
  assert.equal(rupeesToPaise("12.345"), null);
  assert.equal(rupeesToPaise(-1), null);
  assert.equal(formatPaise(16150050), "₹1,61,500.50");
});

test("offer: line amounts must add up to the subtotal; bad totals, dates and fields are 400s", () => {
  const cases = [
    [{ ...goodOffer(), subtotal: "160000" }, "subtotal"],
    [{ ...goodOffer(), total: "1" }, "total"],
    [{ ...goodOffer(), lines: [] }, "lines"],
    [{ ...goodOffer(), lines: [{ label: "X", qty: 1, unit: "event", unitPrice: 1 }], subtotal: 1 }, "lines[0].label"],
    [{ ...goodOffer(), lines: [{ label: "Lights", qty: 0, unit: "set", unitPrice: 1 }], subtotal: 0 }, "lines[0].qty"],
    [{ ...goodOffer(), validUntil: "2026-11-01" }, "validUntil"],
    [{ ...goodOffer(), validUntil: "2026-02-30" }, "validUntil"],
    [{ ...goodOffer(), advancePct: 101 }, "advancePct"],
    [{ ...goodOffer(), discount: 999999 }, "discount"],
    [{ ...goodOffer(), lines: [{ label: "Lights", qty: 1, unit: "set", unitPrice: 1, serviceId: "7" }], subtotal: 1 }, "lines[0].serviceId"],
  ];
  for (const [body, field] of cases) {
    const r = parseOfferBody(body, TODAY);
    assert.equal(r.ok, false, `expected ${field} to fail`);
    assert.equal(r.field, field);
  }
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const S = {};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

async function mkUser(role, name) {
  const s = await signup({ role, name, email: email() });
  assert.ok(s.cookie, `${role} signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId, email: s.email };
}

async function enquiry(vendorId, customerId, { days = 30, name = "Thread Customer" } = {}) {
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count)
     VALUES ($1, $2, $3, '+919999911111', (now() AT TIME ZONE 'Asia/Kolkata')::date + $4::int, 'custtest thread', 300) RETURNING id`,
    [vendorId, customerId, name, days]
  );
  return rows[0].id;
}

const notes = async (userId, kind) =>
  (await db().query("SELECT * FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY id", [userId, kind])).rows;
const events = async (id) =>
  (await db().query("SELECT from_status, to_status FROM quote_status_events WHERE quote_id = $1 ORDER BY id", [id])).rows.map(
    (r) => `${r.from_status}>${r.to_status}`
  );
const statusOf = async (id) => (await db().query("SELECT status FROM quote_requests WHERE id = $1", [id])).rows[0].status;

const offerBody = (extra = {}) => ({
  lines: [{ label: "Candid photography", qty: 1, unit: "event", unitPrice: 45000 }],
  subtotal: 45000,
  validUntil: today(),
  advancePct: 20,
  ...extra,
});

before(async () => {
  await cleanup();
  S.v1 = await mkUser("vendor", "Thread Vendor One");
  S.v2 = await mkUser("vendor", "Thread Vendor Two");
  S.c1 = await mkUser("customer", "Thread Customer");
  S.c2 = await mkUser("customer", "Other Customer");
  S.l1 = await createListing(S.v1.userId, { name: `Custtest Lens ${RUN_ID}`, status: "approved" });
  S.l2 = await createListing(S.v2.userId, { name: `Custtest Other ${RUN_ID}`, status: "approved" });
  const svc = async (vendorId) =>
    (
      await db().query(
        `INSERT INTO services (vendor_id, category_id, title, price_from, price_unit)
         VALUES ($1, (SELECT id FROM categories WHERE name = 'Photography'), 'Candid photography', 45000, 'event') RETURNING id`,
        [vendorId]
      )
    ).rows[0].id;
  S.s1 = await svc(S.l1.id);
  S.s2 = await svc(S.l2.id);
  S.e1 = await enquiry(S.l1.id, S.c1.userId);
});

after(async () => {
  await cleanup();
  await closeDb();
});

test("api: a new enquiry notifies the vendor in the same transaction (trigger)", async () => {
  const n = await notes(S.v1.userId, "lead.new");
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.link, `/vendor/leads/${S.e1}`);
  assert.equal(n[0].payload.quoteId, S.e1);
});

test("api: customers only see their own enquiries; vendors only their own leads", async () => {
  assert.equal((await request("/api/my/enquiries")).status, 401);
  let r = await request("/api/my/enquiries", { cookie: S.c1.cookie });
  assert.equal(r.status, 200);
  assert.ok(r.data.enquiries.some((e) => e.id === S.e1));
  r = await request("/api/my/enquiries", { cookie: S.c2.cookie });
  assert.ok(!r.data.enquiries.some((e) => e.id === S.e1));
  assert.equal((await request(`/api/my/enquiries/${S.e1}`, { cookie: S.c2.cookie })).status, 404);
  assert.equal((await request(`/api/my/enquiries/${S.e1}`, { cookie: S.v2.cookie })).status, 404, "a vendor who didn't send it");
  assert.equal((await request("/api/my/enquiries/abc", { cookie: S.c1.cookie })).status, 404);
  r = await request(`/api/my/enquiries/${S.e1}`, { cookie: S.c1.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.enquiry.vendor.id, S.l1.id);
  assert.equal(r.headers.cacheControl, "private, no-store");
  assert.equal((await request(`/api/vendor/leads/${S.e1}/messages`, { cookie: S.v2.cookie })).status, 403);
  assert.equal((await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v2.cookie, body: offerBody() })).status, 403);
  assert.equal((await request(`/api/vendor/leads/${S.e1}/messages`, { cookie: S.c1.cookie })).status, 403, "customers can't use vendor tools");
  assert.equal((await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: S.c2.cookie, body: { body: "hi" } })).status, 404);
});

test("api: messages both ways, first vendor reply -> responded, notifications and read marks", async () => {
  let r = await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: S.c1.cookie, body: { body: "Is 12 Dec free?" } });
  assert.equal(r.status, 201);
  assert.equal((await notes(S.v1.userId, "lead.message")).length, 1);
  // A second unread message refreshes the same notification instead of stacking.
  await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: S.c1.cookie, body: { body: "Also need a drone." } });
  assert.equal((await notes(S.v1.userId, "lead.message")).length, 1);

  assert.equal((await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: S.c1.cookie, body: { body: "   " } })).status, 400);
  assert.equal(
    (await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: S.c1.cookie, body: { body: "x".repeat(4001) } })).status,
    400
  );

  r = await request(`/api/vendor/leads/${S.e1}/messages`, { cookie: S.v1.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.thread.messages.length, 2);
  const unread = await db().query("SELECT count(*)::int AS n FROM quote_messages WHERE quote_request_id = $1 AND read_at IS NULL", [S.e1]);
  assert.equal(unread.rows[0].n, 0, "opening the thread marks the customer's messages read");
  const vn = await db().query(
    "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND payload->>'quoteId' = $2",
    [S.v1.userId, String(S.e1)]
  );
  assert.equal(vn.rows[0].n, 0, "and this lead's notifications");

  assert.equal(await statusOf(S.e1), "pending");
  r = await request(`/api/vendor/leads/${S.e1}/messages`, { method: "POST", cookie: S.v1.cookie, body: { body: "Yes, free. Offer coming." } });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, "responded");
  assert.deepEqual(await events(S.e1), ["pending>responded"]);
  assert.equal((await notes(S.c1.userId, "enquiry.message")).length, 1);
  r = await request("/api/my/enquiries", { cookie: S.c1.cookie });
  assert.equal(r.data.enquiries.find((e) => e.id === S.e1).unread, 1);
});

test("api: offers validate totals, GST and ownership; v2 supersedes v1", async () => {
  let r = await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody({ subtotal: 40000 }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, "subtotal");
  r = await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody({ gst: 8100 }) });
  assert.deepEqual([r.status, r.data.code], [400, "GST_NOT_ALLOWED"]);
  r = await request(`/api/vendor/leads/${S.e1}/offers`, {
    method: "POST",
    cookie: S.v1.cookie,
    body: offerBody({ lines: [{ serviceId: S.s2, label: "Candid", qty: 1, unit: "event", unitPrice: 45000 }] }),
  });
  assert.equal(r.status, 400, "another vendor's offering");
  assert.equal((await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: [] })).status, 400);

  r = await request(`/api/vendor/leads/${S.e1}/offers`, {
    method: "POST",
    cookie: S.v1.cookie,
    body: offerBody({ lines: [{ serviceId: S.s1, label: "Candid photography", qty: 1, unit: "event", unitPrice: 45000 }], travel: 1500, total: 46500 }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.version, 1);
  S.o1 = r.data.offerId;
  const row = (await db().query("SELECT * FROM quote_offers WHERE id = $1", [S.o1])).rows[0];
  assert.deepEqual([Number(row.subtotal_paise), Number(row.travel_paise), Number(row.total_paise), row.status], [4500000, 150000, 4650000, "sent"]);
  assert.equal((await notes(S.c1.userId, "enquiry.offer")).length, 1);

  r = await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody({ discount: 5000 }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.version, 2);
  S.o2 = r.data.offerId;
  const st = (await db().query("SELECT version, status FROM quote_offers WHERE quote_request_id = $1 ORDER BY version", [S.e1])).rows;
  assert.deepEqual(st.map((x) => `${x.version}:${x.status}`), ["1:superseded", "2:sent"]);

  r = await request(`/api/my/enquiries/${S.e1}`, { cookie: S.c1.cookie });
  assert.equal(r.data.enquiry.thread.offers[0].version, 2);
  assert.equal(r.data.enquiry.thread.offers[0].totalPaise, 4000000);
  assert.equal(r.data.enquiry.thread.offers[0].lines[0].label, "Candid photography");
});

test("api: customer accept / decline / expired offers and booking", async () => {
  const patch = (body, cookie = S.c1.cookie, id = S.e1) => request(`/api/my/enquiries/${id}`, { method: "PATCH", cookie, body });
  assert.equal((await patch({ action: "accept" })).status, 400, "offerId required");
  assert.equal((await patch({ action: "dance" })).status, 400);
  assert.equal((await patch({ action: "accept", offerId: S.o2 }, S.c2.cookie)).status, 404, "not their enquiry");
  let r = await patch({ action: "accept", offerId: S.o1 });
  assert.deepEqual([r.status, r.data.code], [409, "OFFER_NOT_OPEN"], "a superseded offer can't be accepted");

  // Expired: valid_until in the past.
  await db().query("UPDATE quote_offers SET valid_until = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 WHERE id = $1", [S.o2]);
  r = await patch({ action: "accept", offerId: S.o2 });
  assert.equal(r.status, 409);
  assert.equal((await db().query("SELECT status FROM quote_offers WHERE id = $1", [S.o2])).rows[0].status, "expired");
  assert.equal(await statusOf(S.e1), "responded");

  r = await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody() });
  assert.equal(r.data.version, 3);
  S.o3 = r.data.offerId;
  assert.equal((await patch({ action: "booked" })).status, 409, "customer books only after accepting");
  r = await patch({ action: "accept", offerId: S.o3 });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "accepted");
  assert.equal((await notes(S.v1.userId, "lead.offer_accepted")).length, 1);
  assert.equal((await patch({ action: "decline", offerId: S.o3 })).status, 409, "already accepted");
  assert.equal((await patch({ action: "accept", offerId: S.o3 })).status, 409);

  r = await patch({ action: "booked" });
  assert.equal(r.status, 200);
  assert.equal(await statusOf(S.e1), "booked");
  const av = await db().query("SELECT status, quote_request_id FROM vendor_availability WHERE vendor_id = $1", [S.l1.id]);
  assert.equal(av.rows[0]?.quote_request_id, S.e1, "booking blocks the vendor's date");
  assert.equal((await notes(S.v1.userId, "lead.booked")).length, 1);
  assert.deepEqual(await events(S.e1), ["pending>responded", "responded>accepted", "accepted>booked"]);

  r = await request(`/api/vendor/leads/${S.e1}`, { method: "PATCH", cookie: S.v1.cookie, body: { status: "pending" } });
  assert.equal(r.status, 409, "booked -> new is not a move");
  r = await request(`/api/vendor/leads/${S.e1}`, { method: "PATCH", cookie: S.v1.cookie, body: { status: "accepted" } });
  assert.equal(r.status, 409, "only the customer accepts");
  assert.equal((await request(`/api/vendor/leads/${S.e1}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody() })).status, 409);
  assert.equal((await withdraw(S.e1)).status, 409, "a booked enquiry can't be withdrawn");
  assert.deepEqual(await events(S.e1), ["pending>responded", "responded>accepted", "accepted>booked"], "invalid moves write nothing");
});

const withdraw = (id, cookie = S.c1.cookie) => request(`/api/my/enquiries/${id}`, { method: "PATCH", cookie, body: { action: "withdraw" } });

test("api: decline keeps the enquiry open; withdraw closes it for everyone (409s)", async () => {
  const e2 = await enquiry(S.l1.id, S.c1.userId);
  let r = await request(`/api/vendor/leads/${e2}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody() });
  const o = r.data.offerId;
  r = await request(`/api/my/enquiries/${e2}`, { method: "PATCH", cookie: S.c1.cookie, body: { action: "decline", offerId: o, message: "Over budget" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "responded");
  assert.equal((await db().query("SELECT status FROM quote_offers WHERE id = $1", [o])).rows[0].status, "declined");
  assert.equal((await notes(S.v1.userId, "lead.offer_declined")).length, 1);

  r = await withdraw(e2);
  assert.equal(r.status, 200);
  assert.equal(await statusOf(e2), "withdrawn");
  assert.equal((await notes(S.v1.userId, "lead.withdrawn")).length, 1);
  assert.equal((await withdraw(e2)).status, 409);
  assert.equal((await request(`/api/vendor/leads/${e2}`, { method: "PATCH", cookie: S.v1.cookie, body: { status: "booked" } })).status, 409, "no booked after withdrawn");
  assert.equal((await request(`/api/quotes/${e2}`, { method: "PATCH", cookie: S.v1.cookie, body: { status: "booked" } })).status, 409, "legacy route too");
  assert.equal((await request(`/api/vendor/leads/${e2}/messages`, { method: "POST", cookie: S.v1.cookie, body: { body: "?" } })).status, 409);
  assert.equal((await request(`/api/my/enquiries/${e2}/messages`, { method: "POST", cookie: S.c1.cookie, body: { body: "?" } })).status, 409);
  assert.equal((await request(`/api/vendor/leads/${e2}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody() })).status, 409);
  assert.deepEqual(await events(e2), ["pending>responded", "responded>withdrawn"]);
});

test("api: open enquiries expire once the event date has passed", async () => {
  const e3 = await enquiry(S.l1.id, S.c1.userId, { days: -2 });
  const r = await request("/api/my/enquiries", { cookie: S.c1.cookie });
  assert.equal(r.data.enquiries.find((e) => e.id === e3).status, "expired");
  assert.deepEqual(await events(e3), ["pending>expired"]);
  assert.equal((await withdraw(e3)).status, 409);
});

test("api: GST lines only with a GSTIN", async () => {
  await db().query("UPDATE vendors SET gstin = '32ABCDE1234F1Z5' WHERE id = $1", [S.l1.id]);
  const e4 = await enquiry(S.l1.id, S.c1.userId);
  const r = await request(`/api/vendor/leads/${e4}/offers`, { method: "POST", cookie: S.v1.cookie, body: offerBody({ gst: 8100, total: 53100 }) });
  assert.equal(r.status, 201);
  const row = (await db().query("SELECT gst_paise, total_paise FROM quote_offers WHERE id = $1", [r.data.offerId])).rows[0];
  assert.deepEqual([Number(row.gst_paise), Number(row.total_paise)], [810000, 5310000]);
});

test("api: notifications unread count is accurate; mark all read", async () => {
  assert.equal((await request("/api/notifications")).status, 401);
  const dbCount = async (uid) =>
    (await db().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [uid])).rows[0].n;
  let r = await request("/api/notifications", { cookie: S.v1.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.unread, await dbCount(S.v1.userId));
  assert.ok(r.data.unread > 0);
  r = await request("/api/notifications", { method: "PATCH", cookie: S.v1.cookie, body: { all: true } });
  assert.equal(r.status, 200);
  assert.equal((await request("/api/notifications", { cookie: S.v1.cookie })).data.unread, 0);
  // The customer's are untouched.
  r = await request("/api/notifications", { cookie: S.c1.cookie });
  assert.equal(r.data.unread, await dbCount(S.c1.userId));
  assert.ok(r.data.items.every((n) => n.link === null || n.link.startsWith("/my/enquiries/")));
});

test("api: page guards: customer thread pages are the owner's only", async () => {
  let r = await request(`/my/enquiries/${S.e1}`, { cookie: S.c1.cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /Offer v3/);
  assert.equal((await request(`/my/enquiries/${S.e1}`, { cookie: S.c2.cookie })).status, 404);
  assert.equal((await request("/my/enquiries", { cookie: S.c1.cookie })).status, 200);
  r = await request(`/vendor/leads/${S.e1}`, { cookie: S.v1.cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /Conversation/);
  assert.equal((await request(`/vendor/leads/${S.e1}`, { cookie: S.v2.cookie })).status, 404);
  for (const tab of ["quoted", "accepted", "withdrawn", "expired"]) {
    assert.equal((await request(`/vendor/leads?status=${tab}`, { cookie: S.v1.cookie })).status, 200, tab);
  }
});

test("api: message sending is rate limited (429)", async () => {
  const c = await login(S.c2.email);
  let last;
  for (let i = 0; i < 21; i++) {
    last = await request(`/api/my/enquiries/${S.e1}/messages`, { method: "POST", cookie: c.cookie, body: { body: `spam ${i}` } });
  }
  assert.equal(last.status, 429);
});
