// qa5 fix round, vendor group (event-management-qa-tracker.md):
//   QA-103 deleting the last unit of a priced package on a live listing: the
//          409 LISTING_MINIMUM names the package and says it would be left
//          with no units (the server check simulates the delete the same way)
//   QA-104 offer lines: the unit is optional (no "event" default), and the
//          quantity text is plural-aware ("2 events", or "2" with no unit)
// QA-105 and QA-111 need a browser: e2e/qa5-vendor.spec.ts (QA5-V3) and
// e2e/qa5-security.spec.ts (QA5-SEC-A11Y-1).
//
// The unit tests need nothing; the API tests need a running dev server
// (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3173 node --env-file-if-exists=.env.local --test tests/qa5-vendor.test.mjs
//
// Test users are qa5fix-v-<digits>@example.com; they and their listings are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, db, closeDb, RUN_ID } from "./admin-helpers.mjs";
import { parseOfferBody } from "../lib/offer-math.ts";
import { offerLineQty, pluralUnit } from "../app/_components/enquiry-thread/offer-line-qty.ts";

const PATTERN = "^qa5fix-v-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa5fix-v-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function liveVendor(label) {
  const s = await signup({ role: "vendor", name: `Qa5fix ${label}`, email: email() });
  assert.ok(s.cookie, `vendor signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  const { rows: cat } = await db().query("SELECT id FROM categories ORDER BY id LIMIT 1");
  const { rows: dist } = await db().query("SELECT id FROM districts ORDER BY id LIMIT 1");
  const r = await request("/api/vendor/listing", {
    method: "POST",
    cookie: s.cookie,
    body: { name: `Qa5fix ${label} ${RUN_ID}`, vendorType: "individual", primaryCategoryId: cat[0].id, districtId: dist[0].id, phone: "+919847011225" },
  });
  assert.ok([200, 201].includes(r.status), `listing: ${r.status} ${JSON.stringify(r.data)}`);
  const vendorId = (await db().query("SELECT id FROM vendors WHERE owner_id = $1", [s.userId])).rows[0].id;
  return { cookie: s.cookie, vendorId };
}

async function addService(vendorId, { kind = "unit", price = 20000, title }) {
  const { rows } = await db().query(
    `INSERT INTO services (vendor_id, category_id, title, price_from, kind, sale_mode, price_mode, active)
     SELECT id, primary_category_id, $2, $3, $4, 'separate', 'from', true FROM vendors WHERE id = $1 RETURNING id`,
    [vendorId, title, price, kind]
  );
  return rows[0].id;
}

before(cleanup);
after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-103
// ---------------------------------------------------------------------------

test("QA-103: deleting the last unit of a live listing's only package names the package", async () => {
  const v = await liveVendor("Pkg");
  const unit = await addService(v.vendorId, { title: "Candid photography" });
  const pkg = await addService(v.vendorId, { kind: "package", price: 40000, title: `Qa5 Full day ${RUN_ID}` });
  await db().query("INSERT INTO package_items (package_id, item_id, qty) VALUES ($1, $2, 1)", [pkg, unit]);
  await db().query("UPDATE vendors SET status = 'approved', onboarding_completed_at = now(), submitted_at = now() WHERE id = $1", [v.vendorId]);

  const r = await request(`/api/vendor/offerings/${unit}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, "LISTING_MINIMUM");
  const msg = r.data.error;
  assert.match(msg, new RegExp(`Qa5 Full day ${RUN_ID}`), msg);
  assert.match(msg, /left with no units/, msg);
  assert.doesNotMatch(msg, /book on its own/, "not the generic message");
  assert.equal((await db().query("SELECT 1 FROM services WHERE id = $1", [unit])).rowCount, 1, "nothing deleted");

  // With a second unit in the package, the delete goes through.
  const other = await addService(v.vendorId, { title: "Traditional photography" });
  await db().query("INSERT INTO package_items (package_id, item_id, qty) VALUES ($1, $2, 1)", [pkg, other]);
  const ok = await request(`/api/vendor/offerings/${unit}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

// ---------------------------------------------------------------------------
// QA-104
// ---------------------------------------------------------------------------

test("QA-104: an offer line's unit is optional", () => {
  const base = { subtotal: 39000, validUntil: null };
  const ok = parseOfferBody({
    ...base,
    lines: [
      { label: "Candid coverage", qty: 1, unit: "event", unitPrice: 30000 },
      { label: "Album 40 pages", qty: 2, unit: "", unitPrice: 4500 },
    ],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.offer.lines[1].unit, "");
  const noKey = parseOfferBody({ ...base, subtotal: 9000, lines: [{ label: "Album 40 pages", qty: 2, unitPrice: 4500 }] });
  assert.equal(noKey.ok, true, JSON.stringify(noKey));
  const tooLong = parseOfferBody({ ...base, subtotal: 1, lines: [{ label: "Lights", qty: 1, unit: "x".repeat(31), unitPrice: 1 }] });
  assert.equal(tooLong.ok, false);
});

test("QA-104: offer line quantity text is plural-aware", () => {
  assert.equal(offerLineQty(2, ""), "2");
  assert.equal(offerLineQty("2.00", null), "2");
  assert.equal(offerLineQty(2, "event"), "2 events");
  assert.equal(offerLineQty(1, "event"), "1 event");
  assert.equal(offerLineQty("1.00", "event"), "1 event");
  assert.equal(offerLineQty(300, "plate"), "300 plates");
  assert.equal(offerLineQty(1.5, "hour"), "1.5 hours");
  assert.equal(offerLineQty(2, "person"), "2 people");
  assert.equal(offerLineQty(3, "day"), "3 days");
  assert.equal(offerLineQty(2, "pages"), "2 pages");
  assert.equal(offerLineQty(2, "kg"), "2 kg");
  assert.equal(pluralUnit("batch"), "batches");
  assert.equal(pluralUnit("copy"), "copies");
  assert.equal(pluralUnit("sq ft"), "sq ft");
  assert.equal(offerLineQty(2, "sqft"), "2 sqft");
});
