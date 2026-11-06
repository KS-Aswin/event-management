// qa5 fix round (fix5), admin: QA-106 (/admin/users search with a plain
// 10-digit phone number), QA-107 (removing the Verified badge takes an
// optional reason, audits it and notifies the vendor), QA-108 (the reinstate
// notification says what the listing went back to and links to /vendor) and
// QA-112 (the admin review queue's star rating is role="img").
// QA-110 (tap targets at 390) and the QA-107 confirm dialog need a browser:
// e2e/fix5-admin.spec.ts.
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3175 node --env-file-if-exists=.env.local --test tests/qa5-admin.test.mjs
//
// Test users are admtest-qa5fixadm-<digits>@example.com; they and their
// listings are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, db, closeDb, createAdmin, makeVendor, createListing, cleanup, findAudit, RUN_ID } from "./admin-helpers.mjs";

const PREFIX = "qa5fixadm";
let admin;

const decide = (id, body) => request(`/api/admin/vendors/${id}/decision`, { method: "POST", body, cookie: admin.cookie });
const notifications = async (userId, kind) =>
  (await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY id", [userId, kind])).rows;

before(async () => {
  await cleanup(PREFIX);
  admin = await createAdmin(PREFIX, { name: "QA5 Fix Admin" });
});

after(async () => {
  await cleanup(PREFIX);
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-106
// ---------------------------------------------------------------------------

test("QA-106: /admin/users finds a user by a plain 10-digit number (and with a trunk 0) without crashing", async () => {
  const vendor = await makeVendor(PREFIX, { name: `QA5 Phone Person ${RUN_ID}` });
  // A unique Indian mobile number for this run.
  const local = `9${String(RUN_ID).slice(-9)}`;
  await db().query("UPDATE users SET phone_e164 = $2 WHERE id = $1", [vendor.userId, `+91${local}`]);

  for (const q of [local, `0${local}`, `+91 ${local.slice(0, 5)} ${local.slice(5)}`]) {
    const r = await request(`/admin/users?q=${encodeURIComponent(q)}`, { cookie: admin.cookie });
    assert.equal(r.status, 200, `q=${q}`);
    assert.ok(!r.text.includes("Something went wrong"), `q=${q} does not show the error page`);
    assert.ok(r.text.includes(`QA5 Phone Person ${RUN_ID}`), `q=${q} lists the user`);
  }

  // A digit string past the int4 range is still a valid search (no match by id).
  const big = await request("/admin/users?q=2147483648", { cookie: admin.cookie });
  assert.equal(big.status, 200);
  assert.ok(!big.text.includes("Something went wrong"));

  // A small number still finds the user by id.
  const byId = await request(`/admin/users?q=${vendor.userId}`, { cookie: admin.cookie });
  assert.ok(byId.text.includes(`QA5 Phone Person ${RUN_ID}`), "search by user id still works");

  // The audit log's actor filter has the same int4 guard.
  const audit = await request("/admin/audit?actor=98470111220", { cookie: admin.cookie });
  assert.notEqual(audit.status, 500);
  assert.ok(!audit.text.includes("Something went wrong"));
});

// ---------------------------------------------------------------------------
// QA-107
// ---------------------------------------------------------------------------

async function verifiedListing(name) {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name, status: "approved" });
  await db().query("UPDATE vendors SET verified_at = now(), verified_by = $2 WHERE id = $1", [listing.id, admin.userId]);
  return { vendor, listing };
}

test("QA-107: removing the Verified badge stores the reason in the audit row and notifies the vendor", async () => {
  const { vendor, listing } = await verifiedListing(`QA5 Fix Verified ${RUN_ID}`);
  const url = `/api/admin/vendors/${listing.id}/verify`;

  const bad = await request(url, { method: "POST", cookie: admin.cookie, body: { verified: false, reason: "x" } });
  assert.equal(bad.status, 400, "a too-short reason is refused");

  const why = `qa5 fix: the GST certificate expired ${RUN_ID}`;
  const r = await request(url, { method: "POST", cookie: admin.cookie, body: { verified: false, reason: why } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.vendor.verified_at, null);

  const [row] = await findAudit({ action: "vendor.unverify", entityId: listing.id }, 1);
  assert.equal(row.reason, why);

  const n = await notifications(vendor.userId, "vendor.unverified");
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.title, "The Verified badge was removed");
  assert.equal(n[0].payload.link, "/vendor");
  assert.ok(n[0].payload.body.includes(why), "the vendor sees the admin's note");
});

test("QA-107: removing the badge without a reason still notifies the vendor (audit reason null)", async () => {
  const { vendor, listing } = await verifiedListing(`QA5 Fix Verified NoReason ${RUN_ID}`);
  const r = await request(`/api/admin/vendors/${listing.id}/verify`, { method: "POST", cookie: admin.cookie, body: { verified: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [row] = await findAudit({ action: "vendor.unverify", entityId: listing.id }, 1);
  assert.equal(row.reason, null);
  const n = await notifications(vendor.userId, "vendor.unverified");
  assert.equal(n.length, 1);
  assert.match(n[0].payload.body, /no longer shows/);
});

// ---------------------------------------------------------------------------
// QA-108
// ---------------------------------------------------------------------------

async function suspendAndReinstate(userId) {
  const sus = await request(`/api/admin/users/${userId}`, { method: "PATCH", cookie: admin.cookie, body: { action: "suspend", reason: "qa5 fix: chargeback" } });
  assert.equal(sus.status, 200, JSON.stringify(sus.data));
  const un = await request(`/api/admin/users/${userId}`, { method: "PATCH", cookie: admin.cookie, body: { action: "unsuspend" } });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  const n = await notifications(userId, "account.unsuspended");
  assert.equal(n.length, 1);
  return n[0].payload;
}

test("QA-108: reinstating a changes-requested vendor says the listing is not live yet and links to /vendor", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA5 Fix Changes ${RUN_ID}` });
  assert.equal((await decide(listing.id, { action: "request_changes", reason: "qa5 fix: add prices" })).status, 200);

  const p = await suspendAndReinstate(vendor.userId);
  assert.equal(p.link, "/vendor");
  assert.equal(p.vendorId, listing.id);
  assert.doesNotMatch(p.body, /restored\.$/);
  assert.match(p.body, /not live yet/);
  assert.match(p.body, /changes/);
  const st = (await db().query("SELECT status FROM vendors WHERE id = $1", [listing.id])).rows[0].status;
  assert.equal(st, "changes_requested");
});

test("QA-108: reinstating a live vendor says the listing is live again", async () => {
  const vendor = await makeVendor(PREFIX);
  await createListing(vendor.userId, { name: `QA5 Fix Live ${RUN_ID}`, status: "approved" });
  const p = await suspendAndReinstate(vendor.userId);
  assert.equal(p.link, "/vendor");
  assert.match(p.body, /live again/);
});

test("QA-108: reinstating a pending vendor says it is back in review", async () => {
  const vendor = await makeVendor(PREFIX);
  await createListing(vendor.userId, { name: `QA5 Fix Pending ${RUN_ID}` });
  const p = await suspendAndReinstate(vendor.userId);
  assert.match(p.body, /review/);
  assert.doesNotMatch(p.body, /live again/);
});

// ---------------------------------------------------------------------------
// QA-112
// ---------------------------------------------------------------------------

test("QA-112: the admin review queue's star rating is an image with a name", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA5 Fix Reviews ${RUN_ID}`, status: "approved" });
  const rv = (
    await db().query(
      "INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1, 'QA5 fix reviewer', 4, $2) RETURNING id",
      [listing.id, `qa5 fix review ${RUN_ID}`]
    )
  ).rows[0];
  const hide = await request(`/api/admin/reviews/${rv.id}/hide`, { method: "POST", cookie: admin.cookie, body: { reason: "qa5 fix: test" } });
  assert.equal(hide.status, 200, JSON.stringify(hide.data));

  const page = await request("/admin/reviews?tab=hidden", { cookie: admin.cookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`qa5 fix review ${RUN_ID}`), "the hidden review is listed");
  assert.match(page.text, /<span role="img"[^>]*aria-label="4 out of 5 stars"/);
  assert.doesNotMatch(page.text, /<span class="inline-flex items-center gap-1" aria-label="\d out of 5 stars"/);
});
