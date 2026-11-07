// P1-5 review moderation and P1-6 media moderation (PRODUCT_PLAN section 8).
// Run: BASE_URL=http://localhost:<port> node --env-file-if-exists=.env.local --test tests/admin-moderation.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  WEB_DIR,
  RUN_ID,
  request,
  makeCustomer,
  makeVendor,
  createAdmin,
  createListing,
  db,
  auditWatermark,
  countAudit,
  cleanup,
  closeDb,
} from "./admin-helpers.mjs";

const P = "moderation";
const UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(WEB_DIR, "uploads"));

after(async () => {
  await cleanup(P);
  await closeDb();
});

let customer, customer2, vendor, vendor2, admin;
let liveListing, pendingListing;

/** Inserts a processed image row for vendorId (optionally with real files on disk). */
async function insertImage(vendorId, { status = "approved", withFiles = false, createdAt = null } = {}) {
  const key = `vendors/${vendorId}/modtest-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const variants = {
    thumb: { key: `${key}/thumb.webp`, w: 320, h: 240 },
    card: { key: `${key}/card.webp`, w: 800, h: 600 },
    full: { key: `${key}/full.webp`, w: 1600, h: 1200 },
  };
  if (withFiles) {
    const dir = path.join(UPLOADS, ...key.split("/"));
    mkdirSync(dir, { recursive: true });
    for (const v of ["thumb", "card", "full"]) writeFileSync(path.join(dir, `${v}.webp`), Buffer.from("RIFF0000WEBP"));
  }
  const { rows } = await db().query(
    `INSERT INTO media_assets (vendor_id, purpose, kind, storage_driver, storage_key, variants, mime, width, height,
                               caption, status, created_at)
     VALUES ($1, 'gallery', 'image', 'local', $2, $3::jsonb, 'image/webp', 1600, 1200, 'Modtest photo', $4,
             COALESCE($5::timestamptz, now()))
     RETURNING *`,
    [vendorId, key, JSON.stringify(variants), status, createdAt]
  );
  return rows[0];
}

async function mediaRow(id) {
  return (await db().query("SELECT * FROM media_assets WHERE id = $1", [id])).rows[0];
}

async function notifications(userId, kind) {
  return (await db().query("SELECT * FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY id", [userId, kind])).rows;
}

test("setup: accounts and listings", async () => {
  customer = await makeCustomer(P);
  customer2 = await makeCustomer(P);
  vendor = await makeVendor(P);
  vendor2 = await makeVendor(P);
  admin = await createAdmin(P);
  liveListing = await createListing(vendor.userId, { name: `Modtest Live ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true, seed_rating = 4.0, seed_reviews_count = 10, rating = 4.0, reviews_count = 10 WHERE id = $1", [
    liveListing.id,
  ]);
  pendingListing = await createListing(vendor2.userId, { name: `Modtest Pending ${RUN_ID}`, status: "pending" });
  assert.ok(liveListing.id && pendingListing.id);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test("every moderation route: anonymous 401, customer 403, vendor 403", async () => {
  const routes = [
    ["GET", "/api/admin/media"],
    ["GET", "/api/admin/media?tab=reported"],
    ["POST", "/api/admin/media/1/decision", { action: "approve" }],
    ["GET", "/api/admin/reviews/reports"],
    ["POST", "/api/admin/reviews/1/hide", { reason: "test reason" }],
    ["POST", "/api/admin/reviews/1/unhide", {}],
    ["POST", "/api/admin/reports/1/dismiss", {}],
  ];
  for (const [method, url, body] of routes) {
    assert.equal((await request(url, { method, body })).status, 401, `${method} ${url} anonymous`);
    assert.equal((await request(url, { method, body, cookie: customer.cookie })).status, 403, `${method} ${url} customer`);
    assert.equal((await request(url, { method, body, cookie: vendor.cookie })).status, 403, `${method} ${url} vendor`);
  }
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

test("media queue tabs: pre-moderation, recently uploaded, reported", async () => {
  const pending = await insertImage(pendingListing.id, { status: "pending_review" });
  const recent = await insertImage(liveListing.id, { status: "approved" });
  const old = await insertImage(liveListing.id, { status: "approved", createdAt: new Date(Date.now() - 20 * 864e5).toISOString() });

  const pre = await request("/api/admin/media?tab=pre", { cookie: admin.cookie });
  assert.equal(pre.status, 200);
  assert.match(pre.headers.cacheControl ?? "", /no-store/);
  assert.ok(pre.data.items.some((i) => i.id === pending.id), "pending media of a pending listing is in pre-moderation");
  assert.ok(!pre.data.items.some((i) => i.id === recent.id));
  const item = pre.data.items.find((i) => i.id === pending.id);
  assert.equal(item.vendor.id, pendingListing.id);
  assert.match(item.thumb, /^\/media\/vendors\//);

  const rec = await request("/api/admin/media?tab=recent", { cookie: admin.cookie });
  assert.ok(rec.data.items.some((i) => i.id === recent.id), "fresh approved upload is in recently uploaded");
  assert.ok(!rec.data.items.some((i) => i.id === old.id), "uploads older than 14 days are not");
  assert.equal(typeof rec.data.counts.pre, "number");
});

test("media approve: one audit row, then 409 already handled; marks a recent upload as checked", async () => {
  const pending = await insertImage(pendingListing.id, { status: "pending_review" });
  const w = await auditWatermark();
  const r = await request(`/api/admin/media/${pending.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "approve" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "approved");
  const row = await mediaRow(pending.id);
  assert.equal(row.status, "approved");
  assert.equal(row.reviewed_by, admin.userId);
  assert.equal(await countAudit({ afterId: w, action: "media.approve", entityType: "media", entityId: String(pending.id) }), 1);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1, "exactly one audit row for the mutation");

  const again = await request(`/api/admin/media/${pending.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "approve" } });
  assert.equal(again.status, 409);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1, "a 409 writes no audit row");

  const recent = await insertImage(liveListing.id, { status: "approved" });
  await request(`/api/admin/media/${recent.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "approve" } });
  const rec = await request("/api/admin/media?tab=recent", { cookie: admin.cookie });
  assert.ok(!rec.data.items.some((i) => i.id === recent.id), "a checked upload leaves the spot-check queue");
});

test("media reject: reason required, vendor notified and sees the reason, gone from the public page", async () => {
  const keep = await insertImage(liveListing.id, { status: "approved" });
  const bad = await insertImage(liveListing.id, { status: "approved" });

  const before = await request(`/vendors/${liveListing.id}`);
  assert.equal(before.status, 200);
  assert.ok(before.text.includes(bad.storage_key), "approved photo is public before the reject");

  const noReason = await request(`/api/admin/media/${bad.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "reject" } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.field, "reason");
  const bogus = await request(`/api/admin/media/${bad.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "nuke", reason: "abc" } });
  assert.equal(bogus.status, 400);

  const w = await auditWatermark();
  const r = await request(`/api/admin/media/${bad.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", reason: "Contact details in the image" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = await mediaRow(bad.id);
  assert.equal(row.status, "rejected");
  assert.equal(row.status_reason, "Contact details in the image");
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
  assert.equal(await countAudit({ afterId: w, action: "media.reject", entityId: String(bad.id) }), 1);
  const n = await notifications(vendor.userId, "media.rejected");
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.body, "Contact details in the image");
  assert.equal(n[0].payload.link, "/vendor/media");

  const mine = await request("/api/vendor/media", { cookie: vendor.cookie });
  assert.equal(mine.status, 200);
  const a = mine.data.assets.find((x) => x.id === bad.id);
  assert.equal(a.status, "rejected");
  assert.equal(a.statusReason, "Contact details in the image");

  const pub = await request(`/vendors/${liveListing.id}`);
  assert.ok(!pub.text.includes(bad.storage_key), "rejected photo is gone from the public page");
  assert.ok(pub.text.includes(keep.storage_key), "other photos stay");

  const again = await request(`/api/admin/media/${bad.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", reason: "Again" },
  });
  assert.equal(again.status, 409);
});

test("media hide: the vendor cannot unhide an admin-hidden item; 404 for missing media", async () => {
  const m = await insertImage(liveListing.id, { status: "approved" });
  const w = await auditWatermark();
  const r = await request(`/api/admin/media/${m.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "hide", reason: "Watermark of another studio" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = await mediaRow(m.id);
  assert.equal(row.status, "hidden");
  assert.equal(row.status_reason, "admin:Watermark of another studio");
  assert.equal(await countAudit({ afterId: w, action: "media.hide" }), 1);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);

  const unhide = await request(`/api/vendor/media/${m.id}`, { method: "PATCH", cookie: vendor.cookie, body: { hidden: false } });
  assert.equal(unhide.status, 403);
  assert.equal((await mediaRow(m.id)).status, "hidden");

  const missing = await request(`/api/admin/media/999999999/decision`, { method: "POST", cookie: admin.cookie, body: { action: "approve" } });
  assert.equal(missing.status, 404);
});

test("media remove: deletes the row and the stored files, notifies the vendor, one audit row", async () => {
  const m = await insertImage(liveListing.id, { status: "approved", withFiles: true });
  const dir = path.join(UPLOADS, ...m.storage_key.split("/"));
  assert.ok(existsSync(dir));
  const w = await auditWatermark();
  const r = await request(`/api/admin/media/${m.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "remove", reason: "Private photo shared without consent" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "removed");
  assert.equal(await mediaRow(m.id), undefined);
  assert.ok(!existsSync(dir), "storage objects deleted");
  assert.equal(await countAudit({ afterId: w, action: "media.remove", entityId: String(m.id) }), 1);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
  assert.equal((await notifications(vendor.userId, "media.removed")).length, 1);
  const again = await request(`/api/admin/media/${m.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "remove", reason: "again" } });
  assert.equal(again.status, 404);
});

test("public media report: sign-in required, one per person, 2 reports send it back to review", async () => {
  const m = await insertImage(liveListing.id, { status: "approved" });
  const url = `/api/media/${m.id}/report`;
  assert.equal((await request(url, { method: "POST", body: { reason: "Not their work" } })).status, 401);
  assert.equal((await request(url, { method: "POST", cookie: customer.cookie, body: { reason: "x" } })).status, 400);
  assert.equal((await request(url, { method: "POST", cookie: vendor.cookie, body: { reason: "My own photo" } })).status, 400, "owner can't report own media");

  const r1 = await request(url, { method: "POST", cookie: customer.cookie, body: { reason: "Not their work" } });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  let row = await mediaRow(m.id);
  assert.equal(row.status, "approved", "one report does not take it down");
  assert.equal(row.report_count, 1);
  assert.equal((await request(url, { method: "POST", cookie: customer.cookie, body: { reason: "Again" } })).status, 409);

  const r2 = await request(url, { method: "POST", cookie: customer2.cookie, body: { reason: "Stolen from another studio" } });
  assert.equal(r2.status, 201);
  row = await mediaRow(m.id);
  assert.equal(row.status, "pending_review", "second person's report moves it to pending_review");
  assert.equal(row.report_count, 2);
  const pub = await request(`/vendors/${liveListing.id}`);
  assert.ok(!pub.text.includes(m.storage_key), "reported photo is off the public page");
  assert.equal((await request(url, { method: "POST", cookie: vendor2.cookie, body: { reason: "Third" } })).status, 404, "no longer public");

  const q = await request("/api/admin/media?tab=reported", { cookie: admin.cookie });
  const item = q.data.items.find((i) => i.id === m.id);
  assert.ok(item, "in the reported tab");
  assert.equal(item.reports.length, 2);
  const pre = await request("/api/admin/media?tab=pre", { cookie: admin.cookie });
  assert.ok(!pre.data.items.some((i) => i.id === m.id), "not in pre-moderation");

  const w = await auditWatermark();
  const keep = await request(`/api/admin/media/${m.id}/decision`, { method: "POST", cookie: admin.cookie, body: { action: "approve" } });
  assert.equal(keep.status, 200);
  row = await mediaRow(m.id);
  assert.equal(row.status, "approved");
  assert.equal(row.report_count, 0);
  const open = await db().query("SELECT count(*)::int AS n FROM media_reports WHERE media_id = $1 AND status = 'open'", [m.id]);
  assert.equal(open.rows[0].n, 0);
  const dismissed = await db().query("SELECT count(*)::int AS n FROM media_reports WHERE media_id = $1 AND status = 'dismissed'", [m.id]);
  assert.equal(dismissed.rows[0].n, 2);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

let fiveStar, oneStar;

test("review fixture: seed 4.0 x 10 plus a 5 and a 1 gives 3.8 from 12", async () => {
  const ins = async (customerId, rating, body) =>
    (
      await db().query(
        "INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body) VALUES ($1,$2,'Modtest Reviewer',$3,$4) RETURNING *",
        [liveListing.id, customerId, rating, body]
      )
    ).rows[0];
  fiveStar = await ins(customer.userId, 5, "Wonderful team, on time and friendly.");
  oneStar = await ins(customer2.userId, 1, `Call me on 98470 00000 for the real story ${RUN_ID}`);
  // Same formula as recomputeVendorRating: (4.0*10 + 5 + 1) / 12 = 3.83 -> 3.8
  await db().query("UPDATE vendors SET rating = 3.8, reviews_count = 12 WHERE id = $1", [liveListing.id]);
  const r = await request(`/api/reviews/${oneStar.id}/report`, { method: "POST", cookie: customer.cookie, body: { reason: "Contact details in a review" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test("review queue lists the reported review with vendor and reporter reason", async () => {
  const q = await request("/api/admin/reviews/reports", { cookie: admin.cookie });
  assert.equal(q.status, 200);
  const item = q.data.items.find((i) => i.reviewId === oneStar.id);
  assert.ok(item, "reported review is in the open queue");
  assert.equal(item.vendor.id, liveListing.id);
  assert.equal(item.rating, 1);
  assert.match(item.body, /real story/);
  assert.equal(item.reports[0].reason, "Contact details in a review");
  assert.ok(!q.data.items.some((i) => i.reviewId === fiveStar.id));
});

test("hide a 1-star review: reason required, rating rises to 4.1 from 11, report actioned, hidden everywhere public", async () => {
  const noReason = await request(`/api/admin/reviews/${oneStar.id}/hide`, { method: "POST", cookie: admin.cookie, body: {} });
  assert.equal(noReason.status, 400);

  const w = await auditWatermark();
  const r = await request(`/api/admin/reviews/${oneStar.id}/hide`, {
    method: "POST",
    cookie: admin.cookie,
    body: { reason: "Contains phone numbers or contact details" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // (4.0*10 + 5) / 11 = 4.09 -> 4.1
  assert.equal(Number(r.data.vendorRating.rating), 4.1);
  assert.equal(r.data.vendorRating.reviewsCount, 11);
  const v = (await db().query("SELECT rating, reviews_count FROM vendors WHERE id = $1", [liveListing.id])).rows[0];
  assert.equal(Number(v.rating), 4.1);
  assert.equal(v.reviews_count, 11);
  const rep = (await db().query("SELECT status, resolved_by FROM review_reports WHERE review_id = $1", [oneStar.id])).rows;
  assert.deepEqual(rep.map((x) => x.status), ["actioned"]);
  assert.equal(rep[0].resolved_by, admin.userId);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
  assert.equal(await countAudit({ afterId: w, action: "review.hide", entityId: String(oneStar.id) }), 1);
  assert.equal((await notifications(vendor.userId, "review.hidden")).length, 1);

  const api = await request(`/api/vendors/${liveListing.id}`);
  assert.equal(api.status, 200);
  assert.ok(!api.data.reviews.some((x) => x.id === oneStar.id), "hidden review absent from the public API");
  assert.ok(api.data.reviews.some((x) => x.id === fiveStar.id));
  const page = await request(`/vendors/${liveListing.id}`);
  assert.ok(!page.text.includes(`real story ${RUN_ID}`), "hidden review absent from the public page");

  assert.equal((await request(`/api/reviews/${oneStar.id}/report`, { method: "POST", cookie: customer2.cookie, body: { reason: "again" } })).status, 404);
  const again = await request(`/api/admin/reviews/${oneStar.id}/hide`, { method: "POST", cookie: admin.cookie, body: { reason: "again" } });
  assert.equal(again.status, 409);

  const hiddenTab = await request("/api/admin/reviews/reports?tab=hidden", { cookie: admin.cookie });
  assert.ok(hiddenTab.data.items.some((i) => i.reviewId === oneStar.id));
});

test("unhide restores 3.8 from 12; a new review keeps hidden ones out of the maths", async () => {
  const w = await auditWatermark();
  const r = await request(`/api/admin/reviews/${oneStar.id}/unhide`, { method: "POST", cookie: admin.cookie, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(Number(r.data.vendorRating.rating), 3.8);
  assert.equal(r.data.vendorRating.reviewsCount, 12);
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
  assert.equal(await countAudit({ afterId: w, action: "review.unhide" }), 1);
  assert.equal((await request(`/api/admin/reviews/${oneStar.id}/unhide`, { method: "POST", cookie: admin.cookie, body: {} })).status, 409);
  const api = await request(`/api/vendors/${liveListing.id}`);
  assert.ok(api.data.reviews.some((x) => x.id === oneStar.id));
});

test("dismiss a report: review stays, report dismissed, one audit row, then 409", async () => {
  const rep = await request(`/api/reviews/${fiveStar.id}/report`, { method: "POST", cookie: customer2.cookie, body: { reason: "I think this is fake" } });
  assert.equal(rep.status, 201);
  const id = (await db().query("SELECT id FROM review_reports WHERE review_id = $1 AND status = 'open'", [fiveStar.id])).rows[0].id;
  const w = await auditWatermark();
  const r = await request(`/api/admin/reports/${id}/dismiss`, { method: "POST", cookie: admin.cookie, body: { scope: "review", note: "Verified customer" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.dismissed, [id]);
  const row = (await db().query("SELECT status, resolution_note FROM review_reports WHERE id = $1", [id])).rows[0];
  assert.equal(row.status, "dismissed");
  assert.equal(row.resolution_note, "Verified customer");
  assert.equal(await countAudit({ afterId: w, actorId: admin.userId }), 1);
  assert.equal(await countAudit({ afterId: w, action: "report.dismiss", entityId: String(id) }), 1);
  const hidden = (await db().query("SELECT hidden_at FROM vendor_reviews WHERE id = $1", [fiveStar.id])).rows[0];
  assert.equal(hidden.hidden_at, null);
  assert.equal((await request(`/api/admin/reports/${id}/dismiss`, { method: "POST", cookie: admin.cookie, body: {} })).status, 409);
  assert.equal((await request(`/api/admin/reports/999999999/dismiss`, { method: "POST", cookie: admin.cookie, body: {} })).status, 404);
});
