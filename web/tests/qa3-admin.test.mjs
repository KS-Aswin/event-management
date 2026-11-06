// qa3 fix round, admin group (d): QA-060 (unhide admin-hidden media), QA-072
// (category display names on admin vendor pages), QA-073 (no "admin:" prefix
// in reasons), QA-074 (duplicate chip wraps), QA-076 (password_reset_used
// credited to the account holder), QA-079 (activity text cut at a word with
// an ellipsis) and QA-083 (analytics scroll regions are focusable).
// QA-075 (focus after Move up/down) is covered by e2e/qa3-admin.spec.ts.
//
// Needs a running server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3164 node --env-file-if-exists=.env.local --test tests/qa3-admin.test.mjs
//
// Test users are admtest-qa3fixd-<digits>@example.com; they and their
// listings are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, db, closeDb, createAdmin, makeCustomer, makeVendor, createListing, cleanup, RUN_ID } from "./admin-helpers.mjs";
import { clip, displayStatusReason, isAdminHidden } from "../lib/admin/format.ts";

const PREFIX = "qa3fixd";
let admin, vendor, listing;

async function insertImage(vendorId, status = "approved") {
  const key = `vendors/${vendorId}/qa3fixd-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const variants = {
    thumb: { key: `${key}/thumb.webp`, w: 320, h: 240 },
    card: { key: `${key}/card.webp`, w: 800, h: 600 },
    full: { key: `${key}/full.webp`, w: 1600, h: 1200 },
  };
  const { rows } = await db().query(
    `INSERT INTO media_assets (vendor_id, purpose, kind, storage_driver, storage_key, variants, mime, width, height, caption, status)
     VALUES ($1, 'gallery', 'image', 'local', $2, $3::jsonb, 'image/webp', 1600, 1200, 'QA3 fix photo', $4)
     RETURNING *`,
    [vendorId, key, JSON.stringify(variants), status]
  );
  return rows[0];
}

const decide = (id, body) => request(`/api/admin/media/${id}/decision`, { method: "POST", body, cookie: admin.cookie });

before(async () => {
  await cleanup(PREFIX);
  admin = await createAdmin(PREFIX, { name: "QA3 Fix Admin" });
  vendor = await makeVendor(PREFIX);
  listing = await createListing(vendor.userId, { name: `QA3 Fix Listing ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [listing.id]);
});

after(async () => {
  await cleanup(PREFIX);
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-060 / QA-073
// ---------------------------------------------------------------------------

test("QA-060: an admin-hidden photo is listed in the Hidden tab and can be unhidden", async () => {
  const m = await insertImage(listing.id);
  const hide = await decide(m.id, { action: "hide", reason: "QA3 fix: watermark with phone number" });
  assert.equal(hide.status, 200, JSON.stringify(hide.data));

  const q = await request("/api/admin/media?tab=hidden", { cookie: admin.cookie });
  assert.equal(q.status, 200);
  assert.equal(typeof q.data.counts.hidden, "number");
  assert.ok(q.data.counts.hidden >= 1);
  const item = q.data.items.find((x) => x.id === m.id);
  assert.ok(item, "hidden item is in the Hidden tab");
  assert.equal(item.status, "hidden");
  assert.equal(item.statusReason, "QA3 fix: watermark with phone number", "QA-073: no admin: prefix");

  // The vendor detail page shows it as hidden by Vela, without the prefix, with Unhide.
  const page = await request(`/admin/vendors/${listing.id}`, { cookie: admin.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Hidden by Vela/);
  assert.match(page.text, /QA3 fix: watermark with phone number/);
  assert.doesNotMatch(page.text, /“admin:/, "QA-073: the shown reason has no internal prefix");
  assert.match(page.text, /aria-label="Unhide this photo"/);

  const tabPage = await request("/admin/media?tab=hidden", { cookie: admin.cookie });
  assert.equal(tabPage.status, 200);
  assert.match(tabPage.text, /Hidden by Vela/);
  assert.match(tabPage.text, new RegExp(`data-media-id="${m.id}"`));

  const un = await decide(m.id, { action: "unhide" });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.equal(un.data.status, "approved");
  const row = (await db().query("SELECT status, status_reason FROM media_assets WHERE id = $1", [m.id])).rows[0];
  assert.deepEqual(row, { status: "approved", status_reason: null });
  const n = await db().query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'media.unhidden'", [vendor.userId]);
  assert.equal(n.rowCount, 1, "the vendor is told");
  const a = await db().query("SELECT actor_id FROM admin_audit_log WHERE action = 'media.unhide' AND entity_id = $1", [String(m.id)]);
  assert.equal(a.rowCount, 1);
  assert.equal(a.rows[0].actor_id, admin.userId);

  // Not hidden any more (or never hidden by Vela): 409.
  assert.equal((await decide(m.id, { action: "unhide" })).status, 409);
  const own = await insertImage(listing.id, "hidden"); // hidden by the vendor themself
  assert.equal((await decide(own.id, { action: "unhide" })).status, 409, "a vendor's own hide is their choice");
  const q2 = await request("/api/admin/media?tab=hidden", { cookie: admin.cookie });
  assert.ok(!q2.data.items.some((x) => x.id === own.id || x.id === m.id));
});

test("QA-060: unhide needs an admin", async () => {
  const m = await insertImage(listing.id);
  await decide(m.id, { action: "hide", reason: "QA3 fix: auth check" });
  const r = await request(`/api/admin/media/${m.id}/decision`, { method: "POST", body: { action: "unhide" }, cookie: vendor.cookie });
  assert.ok(r.status === 401 || r.status === 403, String(r.status));
  // The vendor still can't unhide it from their side either.
  const v = await request(`/api/vendor/media/${m.id}`, { method: "PATCH", body: { hidden: false }, cookie: vendor.cookie });
  assert.notEqual(v.status, 200);
});

test("QA-073: displayStatusReason strips only the internal marker", () => {
  assert.equal(displayStatusReason("admin:Watermark"), "Watermark");
  assert.equal(displayStatusReason("admin: Watermark "), "Watermark");
  assert.equal(displayStatusReason("Blurry"), "Blurry");
  assert.equal(displayStatusReason(null), null);
  assert.equal(displayStatusReason("admin:"), null);
  assert.equal(isAdminHidden("hidden", "admin:x"), true);
  assert.equal(isAdminHidden("hidden", "plan_limit"), false);
  assert.equal(isAdminHidden("approved", "admin:x"), false);
});

// ---------------------------------------------------------------------------
// QA-072
// ---------------------------------------------------------------------------

test("QA-072: admin vendor filter, rows and detail use the category display name", async (t) => {
  const r = await db().query(
    `SELECT id, name, display_name FROM categories
      WHERE active AND btrim(display_name) <> '' AND display_name <> name ORDER BY id LIMIT 1`
  );
  const cat = r.rows[0];
  if (!cat) return t.skip("no renamed category in the local DB");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const owner = await makeVendor(PREFIX);
  const l = await createListing(owner.userId, { name: `QA3 Fix Cat ${RUN_ID}`, status: "pending", category: cat.name });

  const list = await request(`/admin/vendors?status=all&category=${cat.id}`, { cookie: admin.cookie });
  assert.equal(list.status, 200);
  assert.match(list.text, new RegExp(`<option value="${cat.id}"[^>]*>${esc(cat.display_name)}</option>`), "filter option");
  assert.match(list.text, new RegExp(`${esc(cat.display_name)} · Ernakulam`), "list row");

  const detail = await request(`/admin/vendors/${l.id}`, { cookie: admin.cookie });
  assert.equal(detail.status, 200);
  assert.match(detail.text, new RegExp(esc(cat.display_name)));
  assert.doesNotMatch(detail.text, new RegExp(`>${esc(cat.name)}(,|<)`), "no internal name in the Category row");
});

// ---------------------------------------------------------------------------
// QA-074
// ---------------------------------------------------------------------------

test("QA-074: the possible-duplicate chip may wrap", async () => {
  const phone = `+91 9${String(RUN_ID).slice(-9)}`;
  const a = await createListing((await makeVendor(PREFIX)).userId, { name: `QA3 Fix Dup A ${RUN_ID}`, status: "pending", phone });
  await createListing((await makeVendor(PREFIX)).userId, { name: `QA3 Fix Dup B with a long listing name ${RUN_ID}`, status: "pending", phone });
  const page = await request(`/admin/vendors?status=pending&q=${encodeURIComponent(`QA3 Fix Dup A ${RUN_ID}`)}`, {
    cookie: admin.cookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`data-vendor-id="${a.id}"`));
  const chip = page.text.match(/<span class="([^"]*)" data-testid="duplicate-chip"/);
  assert.ok(chip, "duplicate chip rendered");
  assert.match(chip[1], /whitespace-normal/);
  assert.match(chip[1], /max-w-full/);
});

// ---------------------------------------------------------------------------
// QA-076
// ---------------------------------------------------------------------------

test("QA-076: password_reset_used is shown as done by the account holder", async () => {
  const c = await makeCustomer(PREFIX);
  const link = await request(`/api/admin/users/${c.userId}/password-reset`, { method: "POST", body: {}, cookie: admin.cookie });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  const token = new URL(link.data.url).searchParams.get("token");
  const ok = await request("/api/auth/reset-password", { method: "POST", body: { token, password: "qa3fixd-new-pass-1" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  const row = (
    await db().query("SELECT after, reason FROM admin_audit_log WHERE action = 'user.password_reset_used' AND entity_id = $1", [
      String(c.userId),
    ])
  ).rows[0];
  assert.equal(row.after.changedBy, "account holder");
  assert.match(row.reason, /account holder/);

  const page = await request(`/admin/audit?entity=user&entityId=${c.userId}`, { cookie: admin.cookie });
  assert.equal(page.status, 200);
  const text = page.text.replace(/<!-- -->/g, "");
  assert.match(text, /by the account holder, with a reset link created by QA3 Fix Admin/);
  const user = await request(`/admin/users/${c.userId}`, { cookie: admin.cookie });
  assert.match(user.text.replace(/<!-- -->/g, ""), /by the account holder, with a reset link created by QA3 Fix Admin/);
});

// ---------------------------------------------------------------------------
// QA-079
// ---------------------------------------------------------------------------

test("QA-079: clip cuts at a word boundary and adds an ellipsis", () => {
  const s = "Please add at least three photos of invitations you have printed yourself, not stock images.";
  const out = clip(s, 60);
  assert.ok(out.length <= 60, out);
  assert.ok(out.endsWith("…"), out);
  assert.ok(s.startsWith(out.slice(0, -1)), out);
  assert.match(out, /\S…$/);
  assert.ok(!/ pri…$/.test(out), "never ends mid-word when a space is near");
  assert.equal(clip("Short reason", 60), "Short reason");
  assert.equal(clip("  extra   spaces  ", 60), "extra spaces");
});

test("QA-079: the Today page renders the activity cards", async () => {
  const page = await request("/admin", { cookie: admin.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /data-tile="changes_requested"/);
});

// ---------------------------------------------------------------------------
// QA-083
// ---------------------------------------------------------------------------

test("QA-083: the analytics signups table is a focusable, labelled region", async () => {
  const page = await request("/admin/analytics", { cookie: admin.cookie });
  assert.equal(page.status, 200);
  const region = page.text.match(/<div[^>]*aria-label="Signups per day \(scrollable\)"[^>]*>/);
  assert.ok(region, "signups region rendered");
  assert.match(region[0], /tabindex="0"/i);
  assert.match(region[0], /role="region"/);
});
