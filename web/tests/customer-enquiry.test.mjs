// Customer enquiry API tests (P2-2 enquiry v2, P2-3 guest tracking and
// account linking, P2-9 multi-vendor send). Run against a dev server:
//   BASE_URL=http://localhost:3151 node --env-file-if-exists=.env.local --test tests/customer-enquiry.test.mjs
// LOCAL ONLY (admin-helpers refuses a non-local BASE_URL / DATABASE_URL).
// Users are custtest-enquiry-<digits>@example.com; everything they own, the
// enquiries sent from this run's phones and blocked contacts are removed in after().

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request, db, closeDb, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const EMAIL_RE = "^custtest-enquiry-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `custtest-enquiry-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const tail = String(RUN_ID).slice(-7);
// UAE mobiles unique to this run: guest form, multi-vendor, daily cap.
const PHONE_UAE = `+97150${tail}`;
const PHONE_MULTI = `+97152${tail}`;
const PHONE_CAP = `+97155${tail}`;
const PHONE_BLOCK = `+97156${tail}`;
const PHONES = [PHONE_UAE, PHONE_MULTI, PHONE_CAP, PHONE_BLOCK];
const TAG = `custtest enquiry ${RUN_ID}`;

let ipSeq = 0;
/** Fresh client IP per call so the per-IP limits never interfere. */
function req(path, opts = {}) {
  ipSeq += 1;
  const ip = `10.${150 + (Math.floor(RUN_ID / 1000) % 50)}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  return request(path, { ...opts, headers: { "X-Forwarded-For": ip, ...(opts.headers ?? {}) } });
}

function future(days) {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

async function register(role, addr = email(), name = "Custtest User") {
  const r = await req("/api/auth/register", { method: "POST", body: { name, email: addr, password: TEST_PASSWORD, role } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.cookie, userId: r.data.user.id, email: addr };
}

async function listing(ownerId, { name, status = "approved", published = true } = {}) {
  const { rows } = await db().query(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status, published,
                          district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
     VALUES ($1, $2, 'Catering', 'Ernakulam', 0, 'Price on request', '3 yrs', 'Custtest listing.', $3, $4,
             (SELECT id FROM districts WHERE name = 'Ernakulam' LIMIT 1),
             (SELECT id FROM categories WHERE slug = 'catering' LIMIT 1), '+919847000111', '+919847000111', 6, now(), now())
     RETURNING id`,
    [ownerId, name ?? `Custtest Caterer ${RUN_ID}`, status, published]
  );
  return rows[0].id;
}

async function service(vendorId, { title, priceUnit = "plate", minQty = null, saleMode = "separate", active = true }) {
  const { rows } = await db().query(
    `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit, min_qty, sale_mode, active, kind)
     VALUES ($1, (SELECT id FROM categories WHERE slug = 'catering' LIMIT 1), $2, 'Custtest service', 450, $3, $4, $5, $6, 'unit')
     RETURNING id`,
    [vendorId, title, priceUnit, minQty, saleMode, active]
  );
  return rows[0].id;
}

const ctx = {};

before(async () => {
  ctx.owner = await register("vendor", email(), "Custtest Owner");
  ctx.vendorId = await listing(ctx.owner.userId);
  ctx.plateId = await service(ctx.vendorId, { title: "Sadya", priceUnit: "plate", minQty: 100 });
  ctx.pkgOnlyId = await service(ctx.vendorId, { title: "Live counter", priceUnit: "item", saleMode: "package_only" });
  ctx.inactiveId = await service(ctx.vendorId, { title: "Old menu", active: false });

  ctx.owner2 = await register("vendor", email(), "Custtest Owner Two");
  ctx.hiddenVendorId = await listing(ctx.owner2.userId, { name: `Custtest Hidden ${RUN_ID}`, published: false });

  ctx.customer = await register("customer", email(), "Custtest Customer");
  const et = await db().query("SELECT id FROM event_types WHERE slug = 'nikah'");
  ctx.eventTypeId = et.rows[0].id;
  const d = await db().query("SELECT id FROM districts WHERE name = 'Thrissur' AND state = 'Kerala'");
  ctx.districtId = d.rows[0].id;
  const seeded = await db().query(
    "SELECT id FROM vendors WHERE owner_id IS NULL AND status = 'approved' AND published ORDER BY id LIMIT 6"
  );
  ctx.seeded = seeded.rows.map((r) => r.id);
  assert.equal(ctx.seeded.length, 6, "needs the seeded vendors (npm run db:seed)");
});

after(async () => {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [EMAIL_RE])).rows.map((r) => r.id);
  await db().query(
    "DELETE FROM quote_requests WHERE phone = ANY($1::text[]) OR customer_id = ANY($2::int[]) OR message LIKE $3",
    [PHONES, ids, `${TAG}%`]
  );
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM blocked_contacts WHERE value = ANY($1::text[])", [PHONES]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  await closeDb();
});

const base = () => ({
  name: "Fathima Guest",
  phone: "+971 50 " + tail.slice(0, 3) + " " + tail.slice(3),
  eventDate: future(60),
  eventTypeId: ctx.eventTypeId,
  guestCount: 50,
  districtId: ctx.districtId,
  venueType: "hall",
  venueText: "Lulu Convention Centre",
  budgetMin: 100000,
  budgetMax: 300000,
  slot: "evening",
  foodPref: "non_veg",
  preferredContact: "whatsapp",
  message: `${TAG} v2 form`,
});

// ---------------------------------------------------------------------------
// P2-2: enquiry form v2
// ---------------------------------------------------------------------------

test("guest v2 enquiry: +971 stored as E.164, context, snapshot, token, warning and vendor notification", async () => {
  const contactEmail = email();
  ctx.guestEmail = contactEmail;
  const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { ...base(), contactEmail: contactEmail.toUpperCase(), units: [{ serviceId: ctx.plateId }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const e = r.data.enquiry;
  assert.equal(r.data.quote.id, e.id, "legacy quote.id kept");
  assert.match(e.guestToken, /^[0-9a-f-]{36}$/);
  assert.equal(e.trackingPath, `/enquiry/${e.guestToken}`);
  assert.ok(
    r.data.warnings.some((w) => w.code === "BELOW_MIN_QTY" && w.serviceId === ctx.plateId),
    "50 guests below a 100-plate minimum warns but is allowed"
  );
  ctx.guestToken = e.guestToken;
  ctx.guestEnquiryId = e.id;

  const { rows } = await db().query("SELECT * FROM quote_requests WHERE id = $1", [e.id]);
  const q = rows[0];
  assert.equal(q.phone, PHONE_UAE);
  assert.equal(q.customer_id, null);
  assert.equal(q.contact_email, contactEmail, "email stored lower-case");
  assert.equal(q.event_type_id, ctx.eventTypeId);
  assert.equal(q.district_id, ctx.districtId);
  assert.equal(q.guest_count, 50);
  assert.equal(q.venue_type, "hall");
  assert.equal(q.slot, "evening");
  assert.equal(q.food_pref, "non_veg");
  assert.equal(q.budget_min, 100000);
  assert.equal(q.budget_max, 300000);
  assert.equal(q.preferred_contact, "whatsapp");
  assert.equal(q.source, "web");
  assert.equal(q.status, "pending");

  const units = await db().query("SELECT service_id, snapshot FROM quote_request_services WHERE quote_request_id = $1", [e.id]);
  assert.equal(units.rows.length, 1);
  assert.equal(units.rows[0].snapshot.title, "Sadya");
  assert.equal(units.rows[0].snapshot.price_unit, "plate");

  const n = await db().query(
    "SELECT kind, payload FROM notifications WHERE user_id = $1 AND payload->>'link' = $2 ORDER BY id DESC",
    [ctx.owner.userId, `/vendor/leads/${e.id}`]
  );
  assert.equal(n.rows.length, 1, "vendor owner notified exactly once");
  assert.equal(n.rows[0].kind, "lead.new");
  assert.equal(n.rows[0].payload.link, `/vendor/leads/${e.id}`);
});

test("explicit qty below the minimum warns; at the minimum it doesn't", async () => {
  let r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { ...base(), guestCount: 500, units: [{ serviceId: ctx.plateId, qty: 80 }] },
  });
  assert.equal(r.status, 201);
  assert.ok(r.data.warnings.some((w) => w.code === "BELOW_MIN_QTY"));
  const qty = await db().query("SELECT qty::float AS qty FROM quote_request_services WHERE quote_request_id = $1", [r.data.enquiry.id]);
  assert.equal(qty.rows[0].qty, 80);
  r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { ...base(), units: [{ serviceId: ctx.plateId, qty: 100 }] },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.warnings, []);
});

test("validation: past date, bad phone, references, enums, budget and email rules are 400", async () => {
  const cases = [
    [{ eventDate: "2020-01-01" }, "eventDate", "PAST_DATE"],
    [{ eventDate: "2027-02-30" }, "eventDate"],
    [{ phone: "12345" }, "phone"],
    [{ phone: "+91 12345 67890" }, "phone"],
    [{ phone: "+971 12" }, "phone"],
    [{ name: "A" }, "name"],
    [{ eventTypeId: 99999999 }, "eventTypeId"],
    [{ districtId: 99999999 }, "districtId"],
    [{ venueType: "beach" }, "venueType"],
    [{ slot: "night" }, "slot"],
    [{ foodPref: "vegan" }, "foodPref"],
    [{ guestCount: 0 }, "guestCount"],
    [{ budgetMin: 500000, budgetMax: 100000 }, "budget"],
    [{ preferredContact: "email", contactEmail: null }, "contactEmail"],
    [{ contactEmail: "not-an-email" }, "contactEmail"],
    [{ eventEndDate: future(10) }, "eventEndDate"],
  ];
  for (const [patch, field, code] of cases) {
    const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: { ...base(), ...patch } });
    assert.equal(r.status, 400, `${JSON.stringify(patch)} -> ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.field, field, JSON.stringify(patch));
    if (code) assert.equal(r.data.code, code);
  }
  const bad = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: "[]" });
  assert.equal(bad.status, 400);
});

test("indian numbers in any common form are stored as +91 E.164", async () => {
  const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { name: "Anu Local", phone: "098470 12345", message: `${TAG} local` },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { rows } = await db().query("SELECT phone FROM quote_requests WHERE id = $1", [r.data.enquiry.id]);
  assert.equal(rows[0].phone, "+919847012345");
});

test("services: another vendor's, inactive, or package-only alone are refused", async () => {
  const foreign = (await db().query("SELECT id FROM services WHERE vendor_id = $1 AND active LIMIT 1", [ctx.seeded[0]])).rows[0].id;
  let r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: { ...base(), serviceIds: [foreign] } });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "INVALID_SERVICE");
  r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: { ...base(), serviceIds: [ctx.inactiveId] } });
  assert.equal(r.status, 400);
  r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: { ...base(), serviceIds: [ctx.pkgOnlyId] } });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "PACKAGE_ONLY");
  r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: { ...base(), units: [{ serviceId: ctx.plateId, qty: -1 }] } });
  assert.equal(r.status, 400);
});

test("signed-in customer: linked by customer_id, no guest token, account email used", async () => {
  const body = { ...base(), message: `${TAG} customer` };
  delete body.contactEmail;
  const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body, cookie: ctx.customer.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.enquiry.guestToken, null);
  assert.equal(r.data.enquiry.trackingPath, `/my/enquiries/${r.data.enquiry.id}`);
  const { rows } = await db().query("SELECT customer_id, guest_token, contact_email FROM quote_requests WHERE id = $1", [r.data.enquiry.id]);
  assert.equal(rows[0].customer_id, ctx.customer.userId);
  assert.equal(rows[0].guest_token, null);
  assert.equal(rows[0].contact_email, ctx.customer.email);
});

test("owner can't enquire on their own listing (403); unpublished or unknown vendor is 404", async () => {
  let r = await req(`/api/vendors/${ctx.vendorId}/quotes`, { method: "POST", body: base(), cookie: ctx.owner.cookie });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, "OWN_LISTING");
  r = await req(`/api/vendors/${ctx.hiddenVendorId}/quotes`, { method: "POST", body: base() });
  assert.equal(r.status, 404);
  r = await req(`/api/vendors/2147483000/quotes`, { method: "POST", body: base() });
  assert.equal(r.status, 404);
  r = await req(`/api/vendors/abc/quotes`, { method: "POST", body: base() });
  assert.equal(r.status, 400);
});

test("a blocked international phone is refused with a generic 403", async () => {
  await db().query("INSERT INTO blocked_contacts (value, reason) VALUES ($1, 'custtest') ON CONFLICT DO NOTHING", [PHONE_BLOCK]);
  const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { ...base(), phone: `00${PHONE_BLOCK.slice(1)}` },
  });
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.data.error, /block/i);
});

// ---------------------------------------------------------------------------
// P2-3: guest tracking
// ---------------------------------------------------------------------------

test("tracking API: shows status, vendor, units, offers and messages; never vendor-private fields", async () => {
  await db().query("UPDATE quote_requests SET vendor_notes = 'secret note' WHERE id = $1", [ctx.guestEnquiryId]);
  const offer = await db().query(
    `INSERT INTO quote_offers (quote_request_id, version, subtotal_paise, total_paise, advance_pct, valid_until, terms)
     VALUES ($1, 1, 4500000, 4500000, 30, $2, 'Custtest terms') RETURNING id`,
    [ctx.guestEnquiryId, future(20)]
  );
  await db().query(
    `INSERT INTO quote_offer_lines (offer_id, label, qty, unit, unit_price_paise, amount_paise)
     VALUES ($1, 'Sadya', 100, 'plate', 45000, 4500000)`,
    [offer.rows[0].id]
  );
  await db().query(
    "INSERT INTO quote_messages (quote_request_id, sender_role, body) VALUES ($1, 'vendor', 'Hello from the caterer')",
    [ctx.guestEnquiryId]
  );
  const r = await req(`/api/enquiries/track/${ctx.guestToken}`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.cacheControl ?? "", /no-store/);
  const e = r.data.enquiry;
  assert.equal(e.status, "pending");
  assert.equal(e.vendor.id, ctx.vendorId);
  assert.equal(e.vendor.available, true);
  assert.equal(e.units[0].title, "Sadya");
  assert.equal(e.offers.length, 1);
  assert.equal(e.offers[0].totalPaise, 4500000);
  assert.equal(e.offers[0].lines[0].qty, 100);
  assert.equal(e.messages[0].from, "vendor");
  assert.equal(e.messages[0].body, "Hello from the caterer");
  assert.doesNotMatch(r.text, /secret note/);
  assert.doesNotMatch(r.text, new RegExp(PHONE_UAE.replace("+", "\\+")), "phone not exposed");
});

test("tracking: unknown or malformed token is 404 (API and page); the page renders noindex", async () => {
  assert.equal((await req(`/api/enquiries/track/${randomUUID()}`)).status, 404);
  assert.equal((await req("/api/enquiries/track/not-a-token")).status, 404);
  assert.equal((await req("/api/enquiries/track/1")).status, 404);
  const page = await req(`/enquiry/${ctx.guestToken}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Custtest Caterer/);
  assert.match(page.text, /noindex/);
  assert.match(page.text, /Hello from the caterer/);
  const missing = await req(`/enquiry/${randomUUID()}`);
  assert.ok([200, 404].includes(missing.status));
  assert.match(missing.text, /couldn.t find that page/i);
  assert.doesNotMatch(missing.text, /Custtest Caterer/);
});

// QA-003: a matching (unverified) email alone never links a guest enquiry;
// the guest's private tracking token does. Full coverage: tests/qa1-auth.test.mjs.
test("signing up with the enquiry's email alone does NOT link it; signing up with its token does", async () => {
  const squatter = await register("customer", ctx.guestEmail, "Fathima Guest");
  let { rows } = await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [ctx.guestEnquiryId]);
  assert.equal(rows[0].customer_id, null);

  const r0 = await req("/api/auth/register", {
    method: "POST",
    body: { name: "Fathima Real", email: email(), password: TEST_PASSWORD, role: "customer", enquiryToken: ctx.guestToken },
  });
  assert.equal(r0.status, 201, JSON.stringify(r0.data));
  ({ rows } = await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [ctx.guestEnquiryId]));
  assert.equal(rows[0].customer_id, r0.data.user.id);
  assert.notEqual(rows[0].customer_id, squatter.userId);
  // The token still works and now says the enquiry is in an account.
  const r = await req(`/api/enquiries/track/${ctx.guestToken}`);
  assert.equal(r.data.enquiry.linkedToAccount, true);
});

test("logging in never links guest enquiries by email; vendor accounts are never linked", async () => {
  const r = await req(`/api/vendors/${ctx.vendorId}/quotes`, {
    method: "POST",
    body: { ...base(), contactEmail: ctx.customer.email, message: `${TAG} login link` },
  });
  assert.equal(r.status, 201);
  const login = await req("/api/auth/login", { method: "POST", body: { email: ctx.customer.email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200);
  let { rows } = await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [r.data.enquiry.id]);
  assert.equal(rows[0].customer_id, null);

  const v = await req(`/api/vendors/${ctx.seeded[0]}/quotes`, {
    method: "POST",
    body: { ...base(), contactEmail: ctx.owner2.email, message: `${TAG} vendor no link` },
  });
  assert.equal(v.status, 201);
  await req("/api/auth/login", {
    method: "POST",
    body: { email: ctx.owner2.email, password: TEST_PASSWORD, enquiryToken: v.data.enquiry.guestToken },
  });
  ({ rows } = await db().query("SELECT customer_id FROM quote_requests WHERE id = $1", [v.data.enquiry.id]));
  assert.equal(rows[0].customer_id, null);
});

// ---------------------------------------------------------------------------
// P2-9: multi-vendor send
// ---------------------------------------------------------------------------

const multiBody = (vendorIds, extra = {}) => ({
  ...base(),
  phone: PHONE_MULTI,
  message: `${TAG} multi`,
  vendorIds,
  ...extra,
});

test("multi: 6 vendors, none, or malformed ids are 400", async () => {
  let r = await req("/api/enquiries/multi", { method: "POST", body: multiBody(ctx.seeded) });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, "vendorIds");
  r = await req("/api/enquiries/multi", { method: "POST", body: multiBody([]) });
  assert.equal(r.status, 400);
  r = await req("/api/enquiries/multi", { method: "POST", body: multiBody(["1"]) });
  assert.equal(r.status, 400);
  r = await req("/api/enquiries/multi", { method: "POST", body: multiBody([ctx.vendorId], { eventDate: "2020-05-05" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, "PAST_DATE");
});

test("multi: one batch, per-vendor results, partial success with an unpublished vendor", async () => {
  const r = await req("/api/enquiries/multi", {
    method: "POST",
    body: multiBody([ctx.vendorId, ctx.hiddenVendorId, ctx.seeded[1]], {
      unitsByVendor: { [ctx.vendorId]: [{ serviceId: ctx.plateId, qty: 150 }] },
    }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.sent, 2);
  assert.equal(r.data.failed, 1);
  assert.deepEqual(r.data.results.map((x) => x.vendorId), [ctx.vendorId, ctx.hiddenVendorId, ctx.seeded[1]]);
  const hidden = r.data.results.find((x) => x.vendorId === ctx.hiddenVendorId);
  assert.equal(hidden.ok, false);
  assert.equal(hidden.code, "VENDOR_UNAVAILABLE");
  const okIds = r.data.results.filter((x) => x.ok).map((x) => x.enquiryId);
  const { rows } = await db().query("SELECT batch_id, source, guest_token FROM quote_requests WHERE id = ANY($1::int[])", [okIds]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.batch_id === r.data.batchId && x.source === "multi" && x.guest_token));
  const units = await db().query("SELECT qty::float AS qty FROM quote_request_services WHERE quote_request_id = $1", [okIds[0]]);
  assert.equal(units.rows[0].qty, 150);
});

test("multi: nothing sendable is 409; units for an unselected vendor are 400", async () => {
  let r = await req("/api/enquiries/multi", { method: "POST", body: multiBody([ctx.hiddenVendorId]) });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "NO_VENDORS_AVAILABLE");
  assert.equal(r.data.results[0].code, "VENDOR_UNAVAILABLE");
  r = await req("/api/enquiries/multi", {
    method: "POST",
    body: multiBody([ctx.seeded[2]], { unitsByVendor: { [ctx.vendorId]: [{ serviceId: ctx.plateId }] } }),
  });
  assert.equal(r.status, 400);
});

test("multi: a signed-in vendor's own listing is reported, others still go", async () => {
  const r = await req("/api/enquiries/multi", {
    method: "POST",
    body: multiBody([ctx.vendorId, ctx.seeded[3]]),
    cookie: ctx.owner.cookie,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.results.find((x) => x.vendorId === ctx.vendorId).code, "OWN_LISTING");
  assert.equal(r.data.sent, 1);
});

test("multi: the 16th enquiry from one phone within 24 hours is 429", async () => {
  // 14 earlier enquiries from this phone today (any route counts).
  await db().query(
    `INSERT INTO quote_requests (vendor_id, name, phone, message, created_at)
     SELECT $1, 'Cap Test', $2, $3, now() - (g || ' minutes')::interval FROM generate_series(1, 14) g`,
    [ctx.seeded[0], PHONE_CAP, `${TAG} cap`]
  );
  // An old one (25 h ago) doesn't count.
  await db().query(
    "INSERT INTO quote_requests (vendor_id, name, phone, message, created_at) VALUES ($1, 'Cap Test', $2, $3, now() - interval '25 hours')",
    [ctx.seeded[0], PHONE_CAP, `${TAG} cap old`]
  );
  const body = (ids) => ({ ...multiBody(ids), phone: PHONE_CAP });
  let r = await req("/api/enquiries/multi", { method: "POST", body: body([ctx.seeded[1], ctx.seeded[2]]) });
  assert.equal(r.status, 429, "14 + 2 would be 16");
  assert.equal(r.data.code, "DAILY_LIMIT");
  assert.equal(r.data.remaining, 1);
  r = await req("/api/enquiries/multi", { method: "POST", body: body([ctx.seeded[1]]) });
  assert.equal(r.status, 201, "the 15th is allowed");
  r = await req("/api/enquiries/multi", { method: "POST", body: body([ctx.seeded[2]]) });
  assert.equal(r.status, 429, "the 16th is refused");
  assert.equal(r.data.remaining, 0);
  const n = await db().query("SELECT count(*)::int AS n FROM quote_requests WHERE phone = $1 AND created_at > now() - interval '24 hours'", [PHONE_CAP]);
  assert.equal(n.rows[0].n, 15);
});
