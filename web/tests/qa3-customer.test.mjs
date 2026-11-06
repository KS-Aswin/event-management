// qa3 fix round, customer group: QA-061..QA-067.
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3163 node --env-file-if-exists=.env.local --test tests/qa3-customer.test.mjs
//
// Layout issues (QA-061, QA-062) and the multi-vendor sheet (QA-063) are
// covered end to end by e2e/qa3-customer.spec.ts; here the server-rendered
// markup and the API behaviour are checked. Test users are
// qa3fix-c-<digits>@example.com; they and their listings are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, db, closeDb, createListing, login, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^qa3fix-c-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa3fix-c-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function mkUser(role, name) {
  const addr = email();
  const r = await request("/api/auth/register", { method: "POST", body: { name, email: addr, password: TEST_PASSWORD, role } });
  assert.equal(r.status, 201, `register ${role}: ${r.status} ${r.text.slice(0, 200)}`);
  const l = await login(addr);
  return { cookie: l.cookie ?? r.cookie, userId: r.data.user.id, email: addr };
}

const S = {};

/** An enquiry from the customer (or a guest) to a listing, straight in the DB. */
async function enquiry(vendorId, customerId, { days = 120, guestToken = null, districtName = null } = {}) {
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, guest_token, district_id)
     VALUES ($1, $2, 'Qa3 Customer', '+919999922222', (now() AT TIME ZONE 'Asia/Kolkata')::date + $3::int, 'qa3fix customer', 80,
             $4::uuid, (SELECT id FROM districts WHERE name = $5 LIMIT 1))
     RETURNING id, event_date::text AS event_date`,
    [vendorId, customerId, days, guestToken, districtName]
  );
  return rows[0];
}

const offerBody = () => ({
  lines: [{ label: "Candid photography", qty: 1, unit: "event", unitPrice: 82500 }],
  subtotal: 82500,
  advancePct: 20,
});

/** Visible text of an HTML page (tags and scripts out, whitespace collapsed). */
function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

const offerStatus = async (leadId) =>
  (await db().query("SELECT status FROM quote_offers WHERE quote_request_id = $1 ORDER BY version DESC LIMIT 1", [leadId])).rows[0]?.status;

before(async () => {
  await cleanup();
  S.v = await mkUser("vendor", "Qa3 Vendor");
  S.c = await mkUser("customer", "Qa3 Customer");
  S.l = await createListing(S.v.userId, { name: `Qa3fix Lens Studio ${RUN_ID}`, status: "approved" });
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-067
// ---------------------------------------------------------------------------

test("QA-067: marking a lead Booked closes the offer still waiting for a reply, on both sides", async () => {
  const e = await enquiry(S.l.id, S.c.userId);
  let r = await request(`/api/vendor/leads/${e.id}/offers`, { method: "POST", cookie: S.v.cookie, body: offerBody() });
  assert.equal(r.status, 201, r.text.slice(0, 300));
  const offerId = r.data.offer?.id ?? (await db().query("SELECT id FROM quote_offers WHERE quote_request_id = $1", [e.id])).rows[0].id;
  assert.equal(await offerStatus(e.id), "sent");

  r = await request(`/api/vendor/leads/${e.id}`, { method: "PATCH", cookie: S.v.cookie, body: { status: "booked" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(await offerStatus(e.id), "closed", "the open offer is closed by the booking");

  // Customer API: booked enquiry, closed offer, and it can no longer be accepted.
  r = await request(`/api/my/enquiries/${e.id}`, { cookie: S.c.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.enquiry.status, "booked");
  assert.equal(r.data.enquiry.thread.offers[0].status, "closed");
  r = await request(`/api/my/enquiries/${e.id}`, { method: "PATCH", cookie: S.c.cookie, body: { action: "accept", offerId } });
  assert.equal(r.status, 409, r.text.slice(0, 300));

  // Customer pages: no "waiting for your reply" next to Booked.
  const list = text((await request("/my/enquiries", { cookie: S.c.cookie })).text);
  assert.doesNotMatch(list, /Offer v1 · ₹82,500 · waiting for your reply/);
  assert.match(list, /Offer v1 · ₹82,500 · booking confirmed/);
  const detail = text((await request(`/my/enquiries/${e.id}`, { cookie: S.c.cookie })).text);
  assert.doesNotMatch(detail, /Waiting for reply/);
  assert.match(detail, /confirmed the booking, so this offer is closed/);

  // Vendor page: the offer card says it's closed, not "Waiting for reply".
  const lead = text((await request(`/vendor/leads/${e.id}`, { cookie: S.v.cookie })).text);
  assert.doesNotMatch(lead, /Waiting for reply/);
  assert.match(lead, /Closed when you marked this lead Booked/);

  // Undoing the booking (back to replied) reopens the offer.
  r = await request(`/api/vendor/leads/${e.id}`, { method: "PATCH", cookie: S.v.cookie, body: { status: "responded" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(await offerStatus(e.id), "sent");
});

test("QA-067: declining a lead closes its open offer too; an accepted offer stays accepted when booked", async () => {
  const e = await enquiry(S.l.id, S.c.userId, { days: 140 });
  let r = await request(`/api/vendor/leads/${e.id}/offers`, { method: "POST", cookie: S.v.cookie, body: offerBody() });
  assert.equal(r.status, 201);
  r = await request(`/api/vendor/leads/${e.id}`, { method: "PATCH", cookie: S.v.cookie, body: { status: "declined" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(await offerStatus(e.id), "closed");

  const e2 = await enquiry(S.l.id, S.c.userId, { days: 160 });
  r = await request(`/api/vendor/leads/${e2.id}/offers`, { method: "POST", cookie: S.v.cookie, body: offerBody() });
  assert.equal(r.status, 201);
  const offerId = (await db().query("SELECT id FROM quote_offers WHERE quote_request_id = $1", [e2.id])).rows[0].id;
  r = await request(`/api/my/enquiries/${e2.id}`, { method: "PATCH", cookie: S.c.cookie, body: { action: "accept", offerId } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  r = await request(`/api/vendor/leads/${e2.id}`, { method: "PATCH", cookie: S.v.cookie, body: { status: "booked" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(await offerStatus(e2.id), "accepted");
});

// ---------------------------------------------------------------------------
// QA-064
// ---------------------------------------------------------------------------

test("QA-064: a withdrawn enquiry doesn't invite a message next to 'conversation is closed'", async () => {
  const e = await enquiry(S.l.id, S.c.userId, { days: 180 });
  const r = await request(`/api/my/enquiries/${e.id}`, { method: "PATCH", cookie: S.c.cookie, body: { action: "withdraw" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  const page = text((await request(`/my/enquiries/${e.id}`, { cookie: S.c.cookie })).text);
  assert.match(page, /conversation is closed/);
  assert.doesNotMatch(page, /No messages yet/);
  assert.doesNotMatch(page, /anything about your event/);
});

// ---------------------------------------------------------------------------
// QA-065
// ---------------------------------------------------------------------------

test("QA-065: guest tracking page after a message-only reply: no phantom offer, 'Where', vendor base town", async () => {
  const token = crypto.randomUUID();
  const e = await enquiry(S.l.id, null, { days: 200, guestToken: token, districtName: "Kollam" });
  const r = await request(`/api/vendor/leads/${e.id}/messages`, {
    method: "POST",
    cookie: S.v.cookie,
    body: { body: "Thanks! The date is free. What time does it start?" },
  });
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${r.text.slice(0, 300)}`);
  const page = text((await request(`/enquiry/${token}`)).text);
  assert.match(page, /No offer yet/);
  assert.doesNotMatch(page, /See their offer/);
  assert.match(page, /replied with a message/);
  assert.match(page, /Where Kollam/);
  assert.doesNotMatch(page, /Venue Kollam/);
  assert.match(page, /based in Ernakulam/);
});

// ---------------------------------------------------------------------------
// QA-066
// ---------------------------------------------------------------------------

test("QA-066: profile price headline doesn't say 'Starting from ... onwards'", async () => {
  await db().query("UPDATE vendors SET price = 30000, price_label = '₹30,000 onwards' WHERE id = $1", [S.l.id]);
  const page = text((await request(`/vendors/${S.l.id}`)).text);
  assert.match(page, /Starting from ₹30,000/);
  assert.doesNotMatch(page, /Starting from ₹30,000 onwards/);

  // Without a price there is no "Starting from" lead-in.
  await db().query("UPDATE vendors SET price = 0, price_label = 'Price on request' WHERE id = $1", [S.l.id]);
  const page2 = text((await request(`/vendors/${S.l.id}`)).text);
  assert.doesNotMatch(page2, /Starting from Price on request/);
});

// ---------------------------------------------------------------------------
// QA-061 / QA-063 (server side)
// ---------------------------------------------------------------------------

test("QA-061: the category page's top-vendor list can't grow wider than the phone", async () => {
  const slug = (await db().query("SELECT slug FROM categories WHERE name = 'Photography' LIMIT 1")).rows[0]?.slug;
  assert.ok(slug);
  const html = (await request(`/c/${slug}`)).text;
  assert.match(html, /<ul class="grid grid-cols-1 [^"]*"><li class="min-w-0">/);
});

test("QA-063: the shortlist sends each vendor's open enquiry dates to the send sheet", async () => {
  const e = await enquiry(S.l.id, S.c.userId, { days: 220 });
  await db().query("INSERT INTO favorites (customer_id, vendor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [S.c.userId, S.l.id]);
  const html = (await request("/my/shortlist", { cookie: S.c.cookie })).text;
  assert.match(html.replace(/\\"/g, '"'), new RegExp(`"openEnquiryDates":\\[[^\\]]*"${e.event_date}"`));
});
