// QA round 4 fixes, vendor offers & leads group (event-management-qa-tracker.md):
//   QA-084 deleting a unit that sits in a package removes it from the package;
//          the package stays visible while it has other (on) units, and is
//          marked incomplete only when no units are left. The edit page names
//          the real cause instead of always blaming a unit that is off.
//   QA-090 placeholders are category-neutral (no "300 plates").
//   QA-094 is covered by e2e/qa4-vendor.spec.ts (QA4-V1).
//
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3171 node --env-file-if-exists=.env.local --test tests/qa4-vendor-offers-leads.test.mjs
//
// Test users are qa4fix-vol-<digits>@example.com; they and what they own are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { request, signup, db, closeDb, RUN_ID, WEB_DIR } from "./admin-helpers.mjs";

const PATTERN = "^qa4fix-vol-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa4fix-vol-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const src = (rel) => readFileSync(path.join(WEB_DIR, rel), "utf8");

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

/** A vendor with a draft listing (not live, so the offering minimum doesn't apply). */
async function vendorWithListing(label) {
  const s = await signup({ role: "vendor", name: `Qa4fix ${label}`, email: email() });
  assert.ok(s.cookie, `vendor signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  const { rows: cat } = await db().query("SELECT id FROM categories ORDER BY id LIMIT 1");
  const { rows: dist } = await db().query("SELECT id FROM districts ORDER BY id LIMIT 1");
  const r = await request("/api/vendor/listing", {
    method: "POST",
    cookie: s.cookie,
    body: { name: `Qa4fix ${label} ${RUN_ID}`, vendorType: "individual", primaryCategoryId: cat[0].id, districtId: dist[0].id, phone: "+919847011225" },
  });
  assert.ok([200, 201].includes(r.status), `listing: ${r.status} ${JSON.stringify(r.data)}`);
  const vendorId = (await db().query("SELECT id FROM vendors WHERE owner_id = $1", [s.userId])).rows[0].id;
  return { cookie: s.cookie, vendorId };
}

async function addService(vendorId, { kind = "unit", price = 20000, title, active = true }) {
  const { rows } = await db().query(
    `INSERT INTO services (vendor_id, category_id, title, price_from, kind, sale_mode, price_mode, active)
     SELECT id, primary_category_id, $2, $3, $4, 'separate', 'from', $5 FROM vendors WHERE id = $1 RETURNING id`,
    [vendorId, title, price, kind, active]
  );
  return rows[0].id;
}

async function packageWith(vendorId, title, itemIds) {
  const pkg = await addService(vendorId, { kind: "package", title, price: 60000 });
  for (const [i, id] of itemIds.entries()) {
    await db().query("INSERT INTO package_items (package_id, item_id, qty, sort_order) VALUES ($1, $2, 1, $3)", [pkg, id, i]);
  }
  return pkg;
}

const pkgState = async (pkg) => {
  const { rows } = await db().query(
    "SELECT incomplete, ARRAY(SELECT item_id FROM package_items WHERE package_id = $1 ORDER BY sort_order) AS items FROM services WHERE id = $1",
    [pkg]
  );
  return rows[0];
};

before(cleanup);
after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-084
// ---------------------------------------------------------------------------

test("QA-084: deleting one unit of a two-unit package keeps the package complete and visible", async () => {
  const v = await vendorWithListing("Keep");
  const candid = await addService(v.vendorId, { title: "Candid photography", price: 30000 });
  const trad = await addService(v.vendorId, { title: "Wedding photography (traditional)", price: 35000 });
  const pkg = await packageWith(v.vendorId, "Wedding day full cover", [candid, trad]);

  const r = await request(`/api/vendor/offerings/${candid}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, "deleted");
  const st = await pkgState(pkg);
  assert.deepEqual(st.items, [trad], "the deleted unit is gone from the package");
  assert.equal(st.incomplete, false, "a package with a remaining unit that is on is not incomplete");

  const page = await request(`/vendor/offerings/packages/${pkg}`, { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /This package is incomplete/);
});

test("QA-084: deleting the only unit of a package marks it incomplete and says no units are left", async () => {
  const v = await vendorWithListing("Empty");
  const only = await addService(v.vendorId, { title: "Stage decor" });
  const pkg = await packageWith(v.vendorId, "Stage package", [only]);

  const r = await request(`/api/vendor/offerings/${only}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const st = await pkgState(pkg);
  assert.deepEqual(st.items, []);
  assert.equal(st.incomplete, true, "a package with nothing left to sell is incomplete");

  const page = await request(`/vendor/offerings/packages/${pkg}`, { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /This package is incomplete/);
  assert.match(page.text, /it has no units left/);
  assert.doesNotMatch(page.text, /one of its units is off/, "no unit is off, so the page must not say so");
});

test("QA-084: a unit that is off is named on the package edit page", async () => {
  const v = await vendorWithListing("Off");
  const a = await addService(v.vendorId, { title: "Mehendi artist" });
  const b = await addService(v.vendorId, { title: "Bridal makeup" });
  const pkg = await packageWith(v.vendorId, "Bridal package", [a, b]);
  const r = await request(`/api/vendor/offerings/${b}`, { method: "PATCH", cookie: v.cookie, body: { active: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await pkgState(pkg)).incomplete, true, "turning a unit off still hides its packages");

  const page = await request(`/vendor/offerings/packages/${pkg}`, { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /one of its units is off \(Bridal makeup\)/);
});

test("QA-084: the offerings list, delete confirm and vendor home describe both causes", () => {
  const mgr = src("app/vendor/offerings/offerings-manager.tsx");
  assert.doesNotMatch(mgr, /Packages marked Incomplete include a unit that is off\./);
  assert.match(mgr, /or they have no units\s+left/);
  // The delete confirm looks up the packages the unit is in, like the turn-off confirm.
  const remove = mgr.slice(mgr.indexOf("async function remove("), mgr.indexOf("async function move("));
  assert.match(remove, /items\s*\.filter\(\(i\) => i\.item_id === o\.id\)/);
  assert.match(remove, /deleting removes it from/);
  const home = src("app/vendor/page.tsx");
  assert.doesNotMatch(home, /A unit inside it was turned off, so customers can't see it\./);
  assert.match(home, /or it has no units left/);
});

// ---------------------------------------------------------------------------
// QA-090
// ---------------------------------------------------------------------------

test("QA-090: vendor placeholders don't assume a caterer", async () => {
  for (const rel of [
    "app/vendor/_components/offering-package-form.tsx",
    "app/vendor/leads/[id]/page.tsx",
    "app/vendor/leads/[id]/offer-builder.tsx",
  ]) {
    assert.doesNotMatch(src(rel), /placeholder=["{][^"\n]*plates?\b/i, `${rel} has a catering placeholder`);
  }
  // The package item Note placeholder is short enough not to be cut off at 390 px.
  const v = await vendorWithListing("Placeholder");
  const a = await addService(v.vendorId, { title: "Candid photography" });
  const pkg = await packageWith(v.vendorId, "Photo package", [a]);
  const page = await request(`/vendor/offerings/packages/${pkg}`, { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /300 plates/);
  assert.match(page.text, /placeholder="e\.g\. 4 hours"/);
});
