// P1-3 vendor approval, P1-10 verified badge, P1-11 edit on behalf + claim.
// Run: npm run test:admin  (dev server on BASE_URL, local DB in .env.local)
// Uses only listings it creates (never the seeded vendors).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_ID,
  request,
  login,
  makeCustomer,
  makeVendor,
  createAdmin,
  createListing,
  db,
  auditWatermark,
  countAudit,
  findAudit,
  cleanup,
  closeDb,
} from "./admin-helpers.mjs";

const P = "vendors";
const unowned = []; // listings with no owner, removed in after()

after(async () => {
  if (unowned.length) await db().query("DELETE FROM vendors WHERE id = ANY($1::int[]) AND owner_id IS NULL", [unowned]);
  await cleanup(P);
  await closeDb();
});

let customer, vendor, admin;

async function insertMedia(vendorId, status = "pending_review", n = 1) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await db().query(
      `INSERT INTO media_assets (vendor_id, kind, purpose, storage_driver, storage_key, status, sort_order)
       VALUES ($1, 'image', 'gallery', 'url', '/placeholder-${RUN_ID}-${i}.jpg', $2, $3) RETURNING id`,
      [vendorId, status, i]
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

/** Makes a listing complete enough to (re)submit (findListingMissing). */
async function completeListing(vendorId) {
  await db().query(
    `UPDATE vendors SET about = 'We are a test vendor with a long enough description.', logo_url = '/logo-test.png',
            phone = COALESCE(phone, '+919800001234') WHERE id = $1`,
    [vendorId]
  );
  await db().query(
    `INSERT INTO services (vendor_id, category_id, title, price_from)
     SELECT id, primary_category_id, 'Test package', 15000 FROM vendors WHERE id = $1`,
    [vendorId]
  );
  await insertMedia(vendorId, "approved", 3);
}

async function vendorWithListing(status = "pending", extra = {}) {
  const v = await makeVendor(P);
  const listing = await createListing(v.userId, { status, name: `Admtest ${status} ${RUN_ID} ${v.userId}`, ...extra });
  return { ...v, listing };
}

const decide = (id, body, cookie = admin.cookie) =>
  request(`/api/admin/vendors/${id}/decision`, { method: "POST", body, cookie });

test("setup", async () => {
  customer = await makeCustomer(P);
  vendor = await makeVendor(P);
  admin = await createAdmin(P);
  assert.ok(customer.cookie && vendor.cookie && admin.cookie);
});

test("every admin vendor route: 401 signed out, 403 customer and vendor", async () => {
  const l = await createListing(null, { name: `Admtest guard ${RUN_ID}` });
  unowned.push(l.id);
  const routes = [
    ["GET", "/api/admin/vendors"],
    ["GET", `/api/admin/vendors/${l.id}`],
    ["PATCH", `/api/admin/vendors/${l.id}`, { name: "Hacked name" }],
    ["POST", `/api/admin/vendors/${l.id}/decision`, { action: "approve" }],
    ["POST", `/api/admin/vendors/${l.id}/verify`, { verified: true }],
    ["POST", `/api/admin/vendors/${l.id}/owner`, { userId: vendor.userId }],
    ["POST", `/api/admin/vendors/${l.id}/media/1`, { action: "approve" }],
  ];
  for (const [method, path, body] of routes) {
    assert.equal((await request(path, { method, body })).status, 401, `${method} ${path} anonymous`);
    assert.equal((await request(path, { method, body, cookie: customer.cookie })).status, 403, `${method} ${path} customer`);
    assert.equal((await request(path, { method, body, cookie: vendor.cookie })).status, 403, `${method} ${path} vendor`);
  }
  const row = (await db().query("SELECT status, name, owner_id FROM vendors WHERE id = $1", [l.id])).rows[0];
  assert.deepEqual(row, { status: "pending", name: `Admtest guard ${RUN_ID}`, owner_id: null });
});

test("GET list: pending queue, search, duplicate hints", async () => {
  const phone = `+9198${String(RUN_ID).slice(-8)}`;
  const a = await createListing(null, { name: `Dup Check ${RUN_ID}`, phone });
  const b = await createListing(null, { name: `Other Name ${RUN_ID}`, phone, district: "Thrissur" });
  unowned.push(a.id, b.id);
  const r = await request(`/api/admin/vendors?status=pending&q=${encodeURIComponent(`Dup Check ${RUN_ID}`)}`, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers.cacheControl ?? "", /no-store/);
  const row = r.data.vendors.find((v) => v.id === a.id);
  assert.ok(row, "pending listing found by name");
  assert.ok(row.duplicates.some((d) => d.id === b.id && d.match.includes("phone")), "same phone flagged");
  assert.ok(r.data.counts.pending >= 1);
  const byPhone = await request(`/api/admin/vendors?status=all&q=${phone.slice(-10)}`, { cookie: admin.cookie });
  assert.ok(byPhone.data.vendors.some((v) => v.id === b.id), "search by phone digits");
  const approvedTab = await request(`/api/admin/vendors?status=approved&q=${encodeURIComponent(`Dup Check ${RUN_ID}`)}`, { cookie: admin.cookie });
  assert.equal(approvedTab.data.vendors.length, 0);
});

test("approve: listing becomes public, its pending media approved in the same txn, one audit row", async () => {
  const v = await vendorWithListing("pending");
  const media = await insertMedia(v.listing.id, "pending_review", 2);
  assert.equal((await request(`/api/vendors/${v.listing.id}`)).status, 404, "not public while pending");

  const mark = await auditWatermark();
  const r = await decide(v.listing.id, { action: "approve", expectedStatus: "pending" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.vendor.status, "approved");
  assert.equal(r.data.approvedMedia, 2);
  assert.equal((await request(`/api/vendors/${v.listing.id}`)).status, 200, "public after approve");
  const ms = await db().query("SELECT status FROM media_assets WHERE id = ANY($1::int[])", [media]);
  assert.ok(ms.rows.every((m) => m.status === "approved"));
  assert.equal(await countAudit({ entityType: "vendor", entityId: v.listing.id, afterId: mark }), 1);
  assert.equal(await countAudit({ action: "vendor.approve", entityId: v.listing.id, actorId: admin.userId, afterId: mark }), 1);
  const ev = await db().query("SELECT from_status, to_status FROM vendor_status_events WHERE vendor_id = $1", [v.listing.id]);
  assert.deepEqual(ev.rows, [{ from_status: "pending", to_status: "approved" }]);
  const n = await db().query("SELECT kind FROM notifications WHERE user_id = $1", [v.userId]);
  assert.ok(n.rows.some((x) => x.kind === "vendor.approved"));
});

test("two concurrent approvals: one 200, one 409, one audit row", async () => {
  const v = await vendorWithListing("pending");
  const mark = await auditWatermark();
  const [a, b] = await Promise.all([
    decide(v.listing.id, { action: "approve", expectedStatus: "pending" }),
    decide(v.listing.id, { action: "approve", expectedStatus: "pending" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.match(loser.data.error, /already handled/i);
  assert.equal(await countAudit({ entityType: "vendor", entityId: v.listing.id, afterId: mark }), 1);
});

test("request changes: reason required, shown to the vendor; resubmit returns to pending", async () => {
  const v = await vendorWithListing("pending");
  await completeListing(v.listing.id);
  assert.equal((await decide(v.listing.id, { action: "request_changes" })).status, 400, "reason required");
  assert.equal((await decide(v.listing.id, { action: "request_changes", reason: "x" })).status, 400, "too short");
  const mark = await auditWatermark();
  const reason = "Please add photos of a real event, not stock images.";
  const r = await decide(v.listing.id, { action: "request_changes", reason, expectedStatus: "pending" });
  assert.equal(r.status, 200);
  assert.equal(await countAudit({ action: "vendor.request_changes", entityId: v.listing.id, afterId: mark }), 1);

  const home = await request("/api/vendor/home", { cookie: v.cookie });
  assert.equal(home.status, 200);
  assert.equal(home.data.home.status, "changes_requested");
  assert.equal(home.data.home.statusReason, reason);
  const page = await request("/vendor", { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes("Changes requested") && page.text.includes("real event"), "reason on vendor home page");

  const sub = await request("/api/vendor/listing/submit", { method: "POST", cookie: v.cookie });
  assert.ok(sub.status === 200 || sub.status === 201, JSON.stringify(sub.data));
  const row = (await db().query("SELECT status, status_reason FROM vendors WHERE id = $1", [v.listing.id])).rows[0];
  assert.deepEqual(row, { status: "pending", status_reason: null });
});

test("reject: reason visible to the vendor; stale expectedStatus is 409", async () => {
  const v = await vendorWithListing("pending");
  const reason = "Duplicate of an existing listing.";
  assert.equal((await decide(v.listing.id, { action: "reject", reason, expectedStatus: "pending" })).status, 200);
  const home = await request("/api/vendor/home", { cookie: v.cookie });
  assert.equal(home.data.home.status, "rejected");
  assert.equal(home.data.home.statusReason, reason);
  const stale = await decide(v.listing.id, { action: "approve", expectedStatus: "pending" });
  assert.equal(stale.status, 409);
  assert.equal((await decide(v.listing.id, { action: "bogus" })).status, 400);
});

test("suspend hides the listing at once and blocks the owner's login; unsuspend restores both", async () => {
  const v = await vendorWithListing("approved", { name: `Admtest Suspend ${RUN_ID}` });
  assert.equal((await request(`/api/vendors/${v.listing.id}`)).status, 200);
  assert.equal((await request("/api/vendor/home", { cookie: v.cookie })).status, 200);

  assert.equal((await decide(v.listing.id, { action: "suspend" })).status, 400, "reason required");
  const mark = await auditWatermark();
  const r = await decide(v.listing.id, { action: "suspend", reason: "Fake reviews reported.", expectedStatus: "approved" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ownerSuspended, true);
  assert.equal(await countAudit({ entityType: "vendor", entityId: v.listing.id, afterId: mark }), 1);

  assert.equal((await request(`/api/vendors/${v.listing.id}`)).status, 404, "hidden from the public API");
  const search = await request(`/api/vendors?q=${encodeURIComponent(`Admtest Suspend ${RUN_ID}`)}`);
  assert.ok(!search.data.vendors.some((x) => x.id === v.listing.id), "hidden from search");
  // The root loading.tsx streams a 200 before notFound() runs, so check the body.
  const pubPage = await request(`/vendors/${v.listing.id}`);
  assert.ok(pubPage.status === 404 || /couldn(&#x27;|&apos;|')t find that page/.test(pubPage.text), "public page is not-found");
  assert.ok(!pubPage.text.includes(`Admtest Suspend ${RUN_ID}`), "public page does not show the listing");
  const sitemap = await request("/sitemap.xml");
  assert.ok(!sitemap.text.includes(`/vendors/${v.listing.id}<`), "not in sitemap");
  const old = await request("/api/vendor/home", { cookie: v.cookie });
  assert.ok([401, 403].includes(old.status), `old cookie rejected (${old.status})`);
  assert.equal((await login(v.email, v.password)).status, 403, "login blocked");

  const u = await decide(v.listing.id, { action: "unsuspend", expectedStatus: "suspended" });
  assert.equal(u.status, 200);
  assert.equal(u.data.vendor.status, "approved");
  assert.equal(u.data.ownerRestored, true);
  assert.equal((await request(`/api/vendors/${v.listing.id}`)).status, 200);
  assert.equal((await login(v.email, v.password)).status, 200, "can sign in again");
});

test("verified badge: only via admin, only for approved listings, shown publicly", async () => {
  const v = await vendorWithListing("approved");
  // The vendor can't set it through their own profile API.
  await request("/api/vendor/profile", { method: "PATCH", cookie: v.cookie, body: { verified_at: new Date().toISOString(), verifiedAt: true } });
  assert.equal((await db().query("SELECT verified_at FROM vendors WHERE id = $1", [v.listing.id])).rows[0].verified_at, null);

  const mark = await auditWatermark();
  const r = await request(`/api/admin/vendors/${v.listing.id}/verify`, { method: "POST", cookie: admin.cookie, body: { verified: true } });
  assert.equal(r.status, 200);
  assert.ok(r.data.vendor.verified_at);
  const pub = await request(`/api/vendors/${v.listing.id}`);
  assert.ok(pub.data.vendor.verified_at, "public API exposes the badge");
  const page = await request(`/vendors/${v.listing.id}`);
  assert.ok(page.text.includes("Verified business"), "badge on the public page");
  assert.equal(
    (await request(`/api/admin/vendors/${v.listing.id}/verify`, { method: "POST", cookie: admin.cookie, body: { verified: true } })).status,
    409
  );
  const off = await request(`/api/admin/vendors/${v.listing.id}/verify`, { method: "POST", cookie: admin.cookie, body: { verified: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.vendor.verified_at, null);
  assert.equal(await countAudit({ entityType: "vendor", entityId: v.listing.id, afterId: mark }), 2);

  const pending = await vendorWithListing("pending");
  const np = await request(`/api/admin/vendors/${pending.listing.id}/verify`, { method: "POST", cookie: admin.cookie, body: { verified: true } });
  assert.equal(np.status, 409);
});

test("edit on behalf: audited with before and after; invalid values are 400", async () => {
  const v = await vendorWithListing("approved");
  const mark = await auditWatermark();
  const newName = `Admtest Renamed ${RUN_ID}`;
  const r = await request(`/api/admin/vendors/${v.listing.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { name: newName, adminNotes: "Called the owner to confirm." },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, true);
  const rows = await findAudit({ action: "vendor.edit", entityId: v.listing.id, afterId: mark });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].before.name, v.listing.name);
  assert.equal(rows[0].after.name, newName);
  const row = (await db().query("SELECT name, rereview_required FROM vendors WHERE id = $1", [v.listing.id])).rows[0];
  assert.deepEqual(row, { name: newName, rereview_required: false });
  assert.equal((await request(`/api/admin/vendors/${v.listing.id}`, { method: "PATCH", cookie: admin.cookie, body: { name: "x" } })).status, 400);
  // No change -> no audit row.
  const same = await request(`/api/admin/vendors/${v.listing.id}`, { method: "PATCH", cookie: admin.cookie, body: { name: newName } });
  assert.equal(same.data.changed, false);
  assert.equal(await countAudit({ entityType: "vendor", entityId: v.listing.id, afterId: mark }), 1);

  const detail = await request(`/api/admin/vendors/${v.listing.id}`, { cookie: admin.cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.vendor.admin_notes, "Called the owner to confirm.");
  assert.ok(detail.data.auditTrail.some((a) => a.action === "vendor.edit"));
  assert.ok(detail.data.actions.includes("suspend"));
});

test("assign owner: 409 for a user who owns a listing; claim lands on /vendor", async () => {
  const l = await createListing(null, { name: `Admtest Claim ${RUN_ID}`, status: "approved" });
  unowned.push(l.id);
  const owner = await vendorWithListing("draft");
  const busy = await request(`/api/admin/vendors/${l.id}/owner`, { method: "POST", cookie: admin.cookie, body: { userId: owner.userId } });
  assert.equal(busy.status, 409);
  const cust = await request(`/api/admin/vendors/${l.id}/owner`, { method: "POST", cookie: admin.cookie, body: { email: customer.email } });
  assert.equal(cust.status, 409, "customer account refused");

  const fresh = await makeVendor(P);
  const mark = await auditWatermark();
  const r = await request(`/api/admin/vendors/${l.id}/owner`, { method: "POST", cookie: admin.cookie, body: { email: fresh.email } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await countAudit({ action: "vendor.assign_owner", entityId: l.id, afterId: mark }), 1);
  const again = await request(`/api/admin/vendors/${l.id}/owner`, { method: "POST", cookie: admin.cookie, body: { userId: vendor.userId } });
  assert.equal(again.status, 409, "already owned");
  const home = await request("/api/vendor/home", { cookie: fresh.cookie });
  assert.equal(home.status, 200);
  const relog = await login(fresh.email, fresh.password);
  assert.equal(relog.status, 200);
  assert.match(String(relog.data?.redirectTo), /^\/vendor(\?|$)/);
});

test("per-item media decision: reject needs a reason, vendor sees it; approve skips rejected items", async () => {
  const v = await vendorWithListing("pending");
  const [m1, m2] = await insertMedia(v.listing.id, "pending_review", 2);
  const path = (m) => `/api/admin/vendors/${v.listing.id}/media/${m}`;
  assert.equal((await request(path(m1), { method: "POST", cookie: admin.cookie, body: { action: "reject" } })).status, 400);
  const mark = await auditWatermark();
  const r = await request(path(m1), { method: "POST", cookie: admin.cookie, body: { action: "reject", reason: "Contains a phone number." } });
  assert.equal(r.status, 200);
  assert.equal(await countAudit({ action: "media.reject", entityId: m1, afterId: mark }), 1);
  // Media of another vendor through this vendor's path is 404.
  const other = await vendorWithListing("pending");
  const [om] = await insertMedia(other.listing.id);
  assert.equal((await request(path(om), { method: "POST", cookie: admin.cookie, body: { action: "approve" } })).status, 404);

  assert.equal((await decide(v.listing.id, { action: "approve" })).status, 200);
  const rows = await db().query("SELECT id, status, status_reason FROM media_assets WHERE id = ANY($1::int[]) ORDER BY id", [[m1, m2]]);
  assert.deepEqual(
    rows.rows.map((x) => [x.status, x.status_reason]),
    [["rejected", "Contains a phone number."], ["approved", null]]
  );
});
