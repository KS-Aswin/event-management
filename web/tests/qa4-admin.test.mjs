// qa4 fix round, admin: QA-085 (unsuspend restores the admin's note that went
// with the restored status, via the listing's Unsuspend and via the owner's
// account reinstatement), QA-088 (space after the middle dot in the admin
// offerings list), QA-098 (the Verified badge button markup) and QA-099
// (unhiding a review notifies the vendor).
// QA-097 (active tab scrolled into view at 390px) needs a browser: it is
// covered by e2e/qa4-admin.spec.ts (QA4-ADM-2).
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3173 node --env-file-if-exists=.env.local --test tests/qa4-admin.test.mjs
//
// Test users are admtest-qa4fixadm-<digits>@example.com; they and their
// listings are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, db, closeDb, createAdmin, makeVendor, createListing, cleanup, login, RUN_ID } from "./admin-helpers.mjs";

const PREFIX = "qa4fixadm";
let admin;

const decide = (id, body) => request(`/api/admin/vendors/${id}/decision`, { method: "POST", body, cookie: admin.cookie });
const vendorRow = async (id) => (await db().query("SELECT status, status_reason FROM vendors WHERE id = $1", [id])).rows[0];
const notifications = async (userId, kind) =>
  (await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY id", [userId, kind])).rows;

before(async () => {
  await cleanup(PREFIX);
  admin = await createAdmin(PREFIX, { name: "QA4 Fix Admin" });
});

after(async () => {
  await cleanup(PREFIX);
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-085
// ---------------------------------------------------------------------------

test("QA-085: unsuspending a changes-requested listing brings back the admin's note (also after a second cycle)", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA4 Fix Changes ${RUN_ID}` });
  const note = `qa4 fix: please add three photos of your own weddings ${RUN_ID}`;

  assert.equal((await decide(listing.id, { action: "request_changes", reason: note })).status, 200);
  assert.equal((await decide(listing.id, { action: "suspend", reason: "qa4 fix: fake reviews" })).status, 200);
  assert.equal((await vendorRow(listing.id)).status_reason, "qa4 fix: fake reviews");

  const un = await decide(listing.id, { action: "unsuspend" });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.equal(un.data.to, "changes_requested");
  assert.equal(un.data.vendor.status_reason, note);
  assert.deepEqual(await vendorRow(listing.id), { status: "changes_requested", status_reason: note });

  // A second suspend / unsuspend still restores the original note, not the
  // reason of the earlier "out of suspended" event.
  assert.equal((await decide(listing.id, { action: "suspend", reason: "qa4 fix: second suspension" })).status, 200);
  assert.equal((await decide(listing.id, { action: "unsuspend", reason: "qa4 fix: lifted" })).status, 200);
  assert.deepEqual(await vendorRow(listing.id), { status: "changes_requested", status_reason: note });

  // The vendor (signed in again: suspension bumped the session) sees the note on /vendor.
  const l = await login(vendor.email, vendor.password);
  assert.ok(l.cookie, JSON.stringify(l.data));
  const home = await request("/vendor", { cookie: l.cookie });
  assert.equal(home.status, 200);
  assert.ok(home.text.includes(note), "the change request note is back on the vendor home");

  // And the admin detail page shows it again.
  const page = await request(`/admin/vendors/${listing.id}`, { cookie: admin.cookie });
  assert.ok(page.text.includes(note), "the admin detail page shows the note again");
});

test("QA-085: unsuspending a rejected listing keeps the rejection reason; an approved one has none", async () => {
  const vendor = await makeVendor(PREFIX);
  const rejected = await createListing(vendor.userId, { name: `QA4 Fix Rejected ${RUN_ID}` });
  const why = `qa4 fix: duplicate of another listing ${RUN_ID}`;
  assert.equal((await decide(rejected.id, { action: "reject", reason: why })).status, 200);
  assert.equal((await decide(rejected.id, { action: "suspend", reason: "qa4 fix: spam" })).status, 200);
  assert.equal((await decide(rejected.id, { action: "unsuspend" })).status, 200);
  assert.deepEqual(await vendorRow(rejected.id), { status: "rejected", status_reason: why });

  const vendor2 = await makeVendor(PREFIX);
  const live = await createListing(vendor2.userId, { name: `QA4 Fix Approved ${RUN_ID}` });
  assert.equal((await decide(live.id, { action: "approve" })).status, 200);
  assert.equal((await decide(live.id, { action: "suspend", reason: "qa4 fix: spam" })).status, 200);
  assert.equal((await decide(live.id, { action: "unsuspend" })).status, 200);
  assert.deepEqual(await vendorRow(live.id), { status: "approved", status_reason: null });
});

test("QA-085: reinstating a suspended account restores its listing's change request note", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA4 Fix Account ${RUN_ID}` });
  const note = `qa4 fix: add a price for the full-day package ${RUN_ID}`;
  assert.equal((await decide(listing.id, { action: "request_changes", reason: note })).status, 200);

  const sus = await request(`/api/admin/users/${vendor.userId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { action: "suspend", reason: "qa4 fix: chargeback" },
  });
  assert.equal(sus.status, 200, JSON.stringify(sus.data));
  assert.equal((await vendorRow(listing.id)).status, "suspended");

  const un = await request(`/api/admin/users/${vendor.userId}`, { method: "PATCH", cookie: admin.cookie, body: { action: "unsuspend" } });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.deepEqual(await vendorRow(listing.id), { status: "changes_requested", status_reason: note });
});

// ---------------------------------------------------------------------------
// QA-099
// ---------------------------------------------------------------------------

test("QA-099: unhiding a review notifies the vendor, like hiding it does", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA4 Fix Reviews ${RUN_ID}`, status: "approved" });
  const rv = (
    await db().query(
      "INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1, 'QA4 fix reviewer', 1, $2) RETURNING id",
      [listing.id, `qa4 fix review with 9999999999 ${RUN_ID}`]
    )
  ).rows[0];

  const hide = await request(`/api/admin/reviews/${rv.id}/hide`, { method: "POST", cookie: admin.cookie, body: { reason: "qa4 fix: contact details" } });
  assert.equal(hide.status, 200, JSON.stringify(hide.data));
  assert.equal((await notifications(vendor.userId, "review.hidden")).length, 1);
  assert.equal((await notifications(vendor.userId, "review.unhidden")).length, 0);

  const un = await request(`/api/admin/reviews/${rv.id}/unhide`, { method: "POST", cookie: admin.cookie, body: {} });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  const n = await notifications(vendor.userId, "review.unhidden");
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.title, "A review is back on your profile");
  assert.equal(n[0].payload.link, "/vendor/reviews");
  assert.equal(n[0].payload.reviewId, rv.id);
  assert.match(n[0].payload.body, /rating/i);
});

// ---------------------------------------------------------------------------
// QA-088 / QA-098 (server-rendered markup)
// ---------------------------------------------------------------------------

const visibleText = (html) => html.replace(/<!-- -->/g, "");

test("QA-088: the admin offerings list has a space after the middle dot", async () => {
  const withOffering = (await db().query("SELECT vendor_id FROM services ORDER BY id LIMIT 1")).rows[0];
  if (!withOffering) return; // no offerings in this DB: nothing to render
  const page = await request(`/admin/vendors/${withOffering.vendor_id}`, { cookie: admin.cookie });
  assert.equal(page.status, 200);
  const text = visibleText(page.text);
  assert.match(text, /(Service|Package|Add-on) · \S/);
  assert.doesNotMatch(text, /(Service|Package|Add-on) ·\S/);
});

test("QA-098: the Verified badge control is a button named by its visible text", async () => {
  const vendor = await makeVendor(PREFIX);
  const listing = await createListing(vendor.userId, { name: `QA4 Fix Badge ${RUN_ID}`, status: "approved" });
  const page = await request(`/admin/vendors/${listing.id}`, { cookie: admin.cookie });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /aria-label="Verified business badge"/);
  assert.doesNotMatch(page.text, /role="switch"/);
  assert.match(page.text, /aria-describedby="verified-badge-h verified-badge-d"[^>]*>Mark verified</);
});
