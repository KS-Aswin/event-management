// P1-12 analytics and event capture.
// Run: BASE_URL=http://localhost:<port> node --env-file-if-exists=.env.local --test tests/admin-analytics.test.mjs
//
// Optional: ANALYTICS_EMPTY_BASE_URL=<a dev server whose DATABASE_URL is a freshly
// migrated, empty local DB> plus ANALYTICS_EMPTY_ADMIN_COOKIE checks the page
// renders with no data at all. Without them the empty-range path is still
// checked through the API shape.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  request,
  makeCustomer,
  makeVendor,
  createAdmin,
  createListing,
  db,
  cleanup,
  closeDb,
  auditWatermark,
  countAudit,
} from "./admin-helpers.mjs";

const P = "analytics";

after(async () => {
  await cleanup(P);
  await closeDb();
});

let customer, vendor, admin, listing, pendingListing;

async function viewCount(vendorId) {
  const { rows } = await db().query(
    "SELECT count(*)::int AS n FROM vendor_events WHERE vendor_id = $1 AND kind = 'profile_view'",
    [vendorId]
  );
  return rows[0].n;
}

async function beacon(body, cookie) {
  return request("/api/events", { method: "POST", body, cookie });
}

test("setup: accounts and an approved listing", async () => {
  customer = await makeCustomer(P);
  vendor = await makeVendor(P);
  admin = await createAdmin(P);
  listing = await createListing(vendor.userId, { status: "approved", name: `Admtest Analytics ${Date.now()}` });
  const other = await makeVendor(P);
  pendingListing = await createListing(other.userId, { status: "pending" });
  assert.ok(listing.id && pendingListing.id);
});

test("GET /api/admin/analytics: anonymous 401, customer 403, vendor 403, admin 200", async () => {
  assert.equal((await request("/api/admin/analytics")).status, 401);
  assert.equal((await request("/api/admin/analytics", { cookie: customer.cookie })).status, 403);
  assert.equal((await request("/api/admin/analytics", { cookie: vendor.cookie })).status, 403);
  const r = await request("/api/admin/analytics?days=7", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers.cacheControl ?? "", /no-store/);
  assert.equal(r.data.days, 7);
  assert.equal(r.data.signups.byDay.length, 7);
  for (const k of ["listings", "enquiries", "response", "engagement", "supplyGap"]) assert.ok(k in r.data, k);
  // Unknown range falls back to 30 days.
  const r2 = await request("/api/admin/analytics?days=12", { cookie: admin.cookie });
  assert.equal(r2.data.days, 30);
  assert.equal(r2.data.signups.byDay.length, 30);
});

test("/admin/analytics page: 404 for non-admins, renders for an admin in every range", async () => {
  assert.equal((await request("/admin/analytics", { cookie: customer.cookie })).status, 404);
  for (const days of [7, 30, 90]) {
    const r = await request(`/admin/analytics?days=${days}`, { cookie: admin.cookie });
    assert.equal(r.status, 200, `days=${days}`);
    assert.match(r.text, /Signups by role/);
    assert.match(r.text, /Supply gap/);
    assert.match(r.text, /How these numbers are worked out/);
    assert.doesNotMatch(r.text, /could not be loaded/);
  }
});

test("beacon: a profile view counts once per session per vendor", async () => {
  const before = await viewCount(listing.id);
  const first = await beacon({ vendorId: listing.id, kind: "profile_view" });
  assert.equal(first.status, 200);
  assert.equal(first.data.counted, true);
  assert.match(first.cookie ?? "", /^vela_sid=/);
  const again = await beacon({ vendorId: listing.id, kind: "profile_view" }, first.cookie);
  assert.equal(again.data.counted, false);
  const third = await beacon({ vendorId: listing.id, kind: "profile_view" }, first.cookie);
  assert.equal(third.data.counted, false);
  assert.equal(await viewCount(listing.id), before + 1);

  // A different browser session counts again.
  const other = await beacon({ vendorId: listing.id, kind: "profile_view" });
  assert.equal(other.data.counted, true);
  assert.equal(await viewCount(listing.id), before + 2);
});

test("beacon: owner and admin views are ignored; customers count", async () => {
  const before = await viewCount(listing.id);
  const owner = await beacon({ vendorId: listing.id, kind: "profile_view" }, vendor.cookie);
  assert.equal(owner.data.counted, false);
  const adm = await beacon({ vendorId: listing.id, kind: "profile_view" }, admin.cookie);
  assert.equal(adm.data.counted, false);
  assert.equal(await viewCount(listing.id), before);
  const cust = await beacon({ vendorId: listing.id, kind: "profile_view" }, customer.cookie);
  assert.equal(cust.data.counted, true);
  assert.equal(await viewCount(listing.id), before + 1);
});

test("beacon: only approved vendors; bad input is 400; clicks are stored", async () => {
  const pend = await beacon({ vendorId: pendingListing.id, kind: "profile_view" });
  assert.equal(pend.status, 200);
  assert.equal(pend.data.counted, false);
  assert.equal(await viewCount(pendingListing.id), 0);

  assert.equal((await beacon({ vendorId: listing.id, kind: "search_impression" })).status, 400);
  assert.equal((await beacon({ vendorId: "abc", kind: "profile_view" })).status, 400);
  assert.equal((await beacon({ kind: "profile_view" })).status, 400);
  const bad = await request("/api/events", { method: "POST", body: [1, 2] });
  assert.equal(bad.status, 400);

  const wa = await beacon({ vendorId: listing.id, kind: "whatsapp_click" });
  assert.equal(wa.data.counted, true);
  const ph = await beacon({ vendorId: listing.id, kind: "phone_click" });
  assert.equal(ph.data.counted, true);
  const { rows } = await db().query(
    "SELECT kind, count(*)::int AS n FROM vendor_events WHERE vendor_id = $1 GROUP BY kind ORDER BY kind",
    [listing.id]
  );
  const by = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  assert.equal(by.whatsapp_click, 1);
  assert.equal(by.phone_reveal, 1);
});

test("beacon: a cross-origin Origin header is refused", async () => {
  const r = await request("/api/events", {
    method: "POST",
    body: { vendorId: listing.id, kind: "profile_view" },
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(r.status, 403);
});

test("vendor home 7-day stats read the beacon events", async () => {
  const r = await request("/api/vendor/home", { cookie: vendor.cookie });
  assert.equal(r.status, 200);
  const s = r.data?.home?.last7Days;
  assert.ok(s, JSON.stringify(r.data));
  assert.ok(s.profileViews >= 3, JSON.stringify(s));
  assert.ok(s.whatsappClicks >= 1 && s.phoneReveals >= 1, JSON.stringify(s));
});

test("analytics numbers move with fixture enquiries, responses and events (read-only: no audit rows)", async () => {
  const mark = await auditWatermark();
  const before = (await request("/api/admin/analytics?days=7", { cookie: admin.cookie })).data;

  // Two enquiries to the approved listing: one answered by a vendor message 30 minutes later.
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, status, district_id, created_at)
     VALUES ($1, $2, 'Admtest Enquirer', '+919800000001', 'pending', $3, now() - interval '2 hours'),
            ($1, $2, 'Admtest Enquirer', '+919800000002', 'pending', $3, now() - interval '1 hour')
     RETURNING id`,
    [listing.id, customer.userId, listing.district_id]
  );
  await db().query(
    `INSERT INTO quote_messages (quote_request_id, sender_role, sender_user_id, body, created_at)
     VALUES ($1, 'vendor', $2, 'Thanks, we are available.', now() - interval '90 minutes')`,
    [rows[0].id, vendor.userId]
  );

  const r = await request("/api/admin/analytics?days=7", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  const a = r.data;
  assert.ok(a.enquiries.total >= before.enquiries.total + 2);
  assert.ok(a.response.total >= before.response.total + 2);
  assert.ok(a.response.responded >= before.response.responded + 1);
  assert.ok(a.response.rate > 0 && a.response.rate <= 1);
  assert.ok(typeof a.response.medianMinutes === "number");
  assert.ok(a.engagement.profileViews >= 3 && a.engagement.whatsappClicks >= 1 && a.engagement.phoneReveals >= 1);
  assert.ok(a.signups.totals.all >= 4); // this run's accounts
  const approved = a.listings.find((l) => l.status === "approved");
  assert.ok(approved && approved.count >= 1);
  // Our enquiries show up under the listing's district and category in the 90-day supply gap.
  const gap = a.supplyGap.find((g) => g.district === "Ernakulam" && /Photograph/.test(g.category));
  if (gap) assert.ok(gap.enquiries >= 2 && gap.approvedVendors >= 1);
  assert.equal(await countAudit({ afterId: mark, entityType: "analytics" }), 0);
});

test("empty data: the page renders with no rows (separate empty DB server, optional)", async (t) => {
  const base = process.env.ANALYTICS_EMPTY_BASE_URL;
  const cookie = process.env.ANALYTICS_EMPTY_ADMIN_COOKIE;
  if (!base || !cookie) return t.skip("set ANALYTICS_EMPTY_BASE_URL and ANALYTICS_EMPTY_ADMIN_COOKIE");
  const res = await fetch(`${base.replace(/\/$/, "")}/admin/analytics?days=7`, { headers: { Cookie: cookie } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /No enquiries in this period/);
  assert.match(html, /No enquiries with a district and category/);
});
