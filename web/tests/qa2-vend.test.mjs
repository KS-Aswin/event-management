// QA round 2 fixes, vendor workspace group (event-management-qa-tracker.md):
//   QA-044 a live / pending listing can't drop below the submission minimum
//          (3 portfolio photos + a logo or cover): 409 LISTING_MINIMUM; the
//          vendor home warns when a live listing is short anyway
//   QA-045 the lead Status select says "Quoted" when an offer is out
//   QA-046 profile strength counts portfolio photos only and priced
//          offerings only (not packages)
//   QA-047 no Retry for refusals a retry can't fix; honest type message
//   QA-053 offering reorder buttons are two separate 44 px targets
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3154 node --env-file-if-exists=.env.local --test tests/qa2-vend.test.mjs
//
// Test users are qa2fix-vend-<digits>@example.com; they and what they own are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { request, signup, db, closeDb, RUN_ID, WEB_DIR } from "./admin-helpers.mjs";
import { profileStrength } from "../app/vendor/profile-strength.ts";

const PATTERN = "^qa2fix-vend-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa2fix-vend-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const src = (rel) => readFileSync(path.join(WEB_DIR, rel), "utf8");

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function account(role, name) {
  const s = await signup({ role, name, email: email() });
  assert.ok(s.cookie, `${role} signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId };
}

/** A vendor with a draft listing (through the API, like the wizard does). */
async function vendorWithListing(label) {
  const acc = await account("vendor", `Qa2fix ${label}`);
  const { rows: cat } = await db().query("SELECT id FROM categories ORDER BY id LIMIT 1");
  const { rows: dist } = await db().query("SELECT id FROM districts ORDER BY id LIMIT 1");
  const r = await request("/api/vendor/listing", {
    method: "POST",
    cookie: acc.cookie,
    body: { name: `Qa2fix ${label} ${RUN_ID}`, vendorType: "individual", primaryCategoryId: cat[0].id, districtId: dist[0].id, phone: "+919847011223" },
  });
  assert.ok([200, 201].includes(r.status), `listing: ${r.status} ${JSON.stringify(r.data)}`);
  const vendorId = (await db().query("SELECT id FROM vendors WHERE owner_id = $1", [acc.userId])).rows[0].id;
  await db().query("UPDATE vendors SET about = $2 WHERE id = $1", [vendorId, "A test business made by the qa2 vendor fix suite, long enough."]);
  return { ...acc, vendorId };
}

let mediaSeq = 0;
async function addMedia(vendorId, purpose, status = "approved") {
  const { rows } = await db().query(
    `INSERT INTO media_assets (vendor_id, kind, purpose, storage_driver, storage_key, status, sort_order)
     VALUES ($1, 'image', $2, 'url', $3, $4, $5) RETURNING id`,
    [vendorId, purpose, `/qa2fix-vend-${RUN_ID}-${++mediaSeq}.jpg`, status, mediaSeq]
  );
  return rows[0].id;
}

async function setRoleInDb(vendorId, role, mediaId) {
  const col = role === "logo" ? "logo_media_id" : "cover_media_id";
  await db().query(`UPDATE vendors SET ${col} = $2 WHERE id = $1`, [vendorId, mediaId]);
}

async function addService(vendorId, { kind = "unit", price = 20000, title }) {
  await db().query(
    `INSERT INTO services (vendor_id, category_id, title, price_from, kind)
     SELECT id, primary_category_id, $2, $3, $4 FROM vendors WHERE id = $1`,
    [vendorId, title, price, kind]
  );
}

const S = {};

before(async () => {
  await cleanup();
  S.customer = await account("customer", "Qa2fix Customer");
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-044
// ---------------------------------------------------------------------------

test("QA-044: a live listing can't delete or hide photos below 3, or remove its last logo/cover", async () => {
  const v = await vendorWithListing("Live");
  const photos = [await addMedia(v.vendorId, "gallery"), await addMedia(v.vendorId, "gallery"), await addMedia(v.vendorId, "gallery")];
  const logo = await addMedia(v.vendorId, "logo");
  await setRoleInDb(v.vendorId, "logo", logo);
  await db().query("UPDATE vendors SET status = 'approved', onboarding_completed_at = now() WHERE id = $1", [v.vendorId]);

  let r = await request(`/api/vendor/media/${photos[0]}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, "LISTING_MINIMUM");
  assert.match(r.data.error, /at least 3 photos/);

  r = await request(`/api/vendor/media/${photos[0]}`, { method: "PATCH", cookie: v.cookie, body: { hidden: true } });
  assert.equal(r.status, 409, "hiding is refused the same way");

  // With a 4th photo, one can go; then the next is refused.
  const extra = await addMedia(v.vendorId, "gallery");
  r = await request(`/api/vendor/media/${extra}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await request(`/api/vendor/media/${photos[1]}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409);

  // Logo is the only brand image: clearing or deleting it is refused.
  r = await request("/api/vendor/media/logo", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /logo or a cover photo/);
  r = await request(`/api/vendor/media/${logo}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, "deleting the logo asset itself is refused too");

  // With a cover as well, the logo can go, but then the cover can't.
  const cover = await addMedia(v.vendorId, "cover");
  await setRoleInDb(v.vendorId, "cover", cover);
  r = await request("/api/vendor/media/logo", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await request("/api/vendor/media/cover", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(r.status, 409);

  const { rows } = await db().query(
    "SELECT COUNT(*)::int AS n FROM media_assets WHERE vendor_id = $1 AND purpose = 'gallery' AND status = 'approved'",
    [v.vendorId]
  );
  assert.equal(rows[0].n, 3, "the listing still has its 3 photos");
});

test("QA-044: draft and pending listings can still delete freely; logo/cover don't count as portfolio photos", async () => {
  const v = await vendorWithListing("Draft");
  const p = await addMedia(v.vendorId, "gallery", "pending_review");
  const logo = await addMedia(v.vendorId, "logo", "pending_review");
  const cover = await addMedia(v.vendorId, "cover", "pending_review");
  await setRoleInDb(v.vendorId, "logo", logo);
  await setRoleInDb(v.vendorId, "cover", cover);
  await addMedia(v.vendorId, "gallery", "pending_review");

  // 2 portfolio photos + logo + cover is still short of 3 photos.
  const listing = await request("/api/vendor/listing", { cookie: v.cookie });
  assert.equal(listing.status, 200);
  assert.ok(listing.data.missing.includes("images"), JSON.stringify(listing.data.missing));

  const r = await request(`/api/vendor/media/${p}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, "draft vendors aren't blocked");
  // A listing under review isn't blocked either (the home page warns instead).
  await db().query("UPDATE vendors SET status = 'pending', submitted_at = now() WHERE id = $1", [v.vendorId]);
  const home = await request("/vendor", { cookie: v.cookie });
  assert.match(home.text, /it is now missing/);
  const l = await request("/api/vendor/media/logo", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(l.status, 200);
});

test("QA-044: the vendor home warns when a live listing is below the minimum", async () => {
  const v = await vendorWithListing("Short");
  await addMedia(v.vendorId, "gallery");
  await db().query("UPDATE vendors SET status = 'approved', onboarding_completed_at = now() WHERE id = $1", [v.vendorId]);
  const home = await request("/vendor", { cookie: v.cookie });
  assert.equal(home.status, 200);
  assert.match(home.text, /Your live listing is missing the basics/);
  assert.match(home.text, /at least 3 portfolio photos/);
});

test("QA-044: the media manager asks before removing the logo or cover", () => {
  const s = src("app/vendor/_components/media-manager.tsx");
  assert.match(s, /Remove your \$\{label\}\?/);
  assert.match(s, /confirmLabel=\{`Remove \$\{label\}`\}/);
});

// ---------------------------------------------------------------------------
// QA-045
// ---------------------------------------------------------------------------

test("QA-045: after an offer, the lead Status select shows Quoted like the header", async () => {
  const v = await vendorWithListing("Leads");
  await db().query("UPDATE vendors SET status = 'approved', onboarding_completed_at = now() WHERE id = $1", [v.vendorId]);
  const { rows } = await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, status)
     VALUES ($1, $2, $3, '+919999922233', (now() AT TIME ZONE 'Asia/Kolkata')::date + 60, 'qa2fix vend', 150, 'pending')
     RETURNING id`,
    [v.vendorId, S.customer.userId, `Qa2fix Quoted ${RUN_ID}`]
  );
  const leadId = rows[0].id;
  const validUntil = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 14 * 86_400_000));
  const offer = await request(`/api/vendor/leads/${leadId}/offers`, {
    method: "POST",
    cookie: v.cookie,
    body: { lines: [{ label: "Candid photography", qty: 1, unit: "event", unitPrice: 40000 }], subtotal: 40000, validUntil, advancePct: 20 },
  });
  assert.equal(offer.status, 201, JSON.stringify(offer.data));

  const page = await request(`/vendor/leads/${leadId}`, { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /data-status-pill="quoted"/);
  const select = page.text.match(/<select[^>]*aria-label="Status of enquiry[^"]*"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, "the status select is on the page");
  assert.match(select[1], /<option[^>]*value="responded"[^>]*>Quoted<\/option>/);
  assert.doesNotMatch(select[1], />Replied</, "no second, conflicting status");
});

// ---------------------------------------------------------------------------
// QA-046
// ---------------------------------------------------------------------------

test("QA-046: profileStrength counts portfolio photos and priced offerings only", () => {
  const base = { checklist: { basics: true, logo: true, cover: true, areas: true, languages: true } };
  const s = profileStrength({ ...base, media: { images: 4 }, offerings: { pricedUnits: 2, packages: 1 } }, "");
  const item = (k) => s.items.find((i) => i.key === k);
  assert.equal(item("photos").done, false);
  assert.match(item("photos").label, /portfolio photos \(4 so far\)/);
  assert.equal(item("offerings").done, false);
  assert.match(item("offerings").label, /not counting packages \(2 so far\)/);
  const ok = profileStrength({ ...base, media: { images: 6 }, offerings: { pricedUnits: 3, packages: 1 } }, "");
  assert.equal(ok.items.find((i) => i.key === "photos").done, true);
  assert.equal(ok.items.find((i) => i.key === "offerings").done, true);
});

test("QA-046: /api/vendor/home doesn't count logo, cover or packages", async () => {
  const v = await vendorWithListing("Strength");
  for (let i = 0; i < 4; i++) await addMedia(v.vendorId, "gallery");
  const logo = await addMedia(v.vendorId, "logo");
  const cover = await addMedia(v.vendorId, "cover");
  await setRoleInDb(v.vendorId, "logo", logo);
  await setRoleInDb(v.vendorId, "cover", cover);
  await addService(v.vendorId, { title: "Unit A" });
  await addService(v.vendorId, { title: "Unit B" });
  await addService(v.vendorId, { title: "Package C", kind: "package" });

  const r = await request("/api/vendor/home", { cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.home.media.images, 4, "6 images, 4 of them portfolio photos");
  assert.equal(r.data.home.offerings.pricedUnits, 2);
  const items = Object.fromEntries(r.data.home.strength.items.map((i) => [i.key, i.done]));
  assert.equal(items.photos, false);
  assert.equal(items.offerings, false);
  assert.equal(items.logo, true);
  assert.equal(items.cover, true);
});

// ---------------------------------------------------------------------------
// QA-047
// ---------------------------------------------------------------------------

test("QA-047: failed uploads offer Retry only when a retry can help", () => {
  const uploader = src("app/vendor/_components/media-uploader.tsx");
  assert.match(uploader, /i\.retryable !== false \?/);
  assert.match(uploader, /const retryable = res\.status >= 500 \|\| res\.status === 408 \|\| res\.status === 429 \|\| res\.status === 409;/);
  const step = src("app/vendor/onboarding/step-media.tsx");
  assert.match(step, /j\.retryable !== false \?/);
  assert.match(step, /const canRetry = \(status: number\) => status === 0 \|\| status === 408 \|\| status === 409 \|\| status === 429 \|\| status >= 500;/);
  for (const v of ["res", "put", "done"]) assert.ok(step.includes(`retryable: canRetry(${v}.status)`), v);
});

test("QA-047: a non-image upload is refused 415 with a plain message; HEIC isn't claimed", async () => {
  const v = await vendorWithListing("Upload");
  const buf = Buffer.from("this is not an image at all, just text pretending to be a jpeg".repeat(20));
  const r = await request("/api/vendor/media/uploads", {
    method: "POST",
    cookie: v.cookie,
    body: { kind: "image", purpose: "gallery", contentType: "image/jpeg", bytes: buf.byteLength },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const put = await fetch(new URL(r.data.uploadUrl, process.env.BASE_URL ?? "http://localhost:3000"), {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", Cookie: v.cookie },
    body: buf,
  });
  await put.text();
  const done = await request(`/api/vendor/media/uploads/${r.data.assetId}/complete`, { method: "POST", cookie: v.cookie, body: {} });
  assert.equal(done.status, 415, JSON.stringify(done.data));
  assert.match(done.data.error, /isn't a JPEG, PNG or WebP photo/);
  assert.doesNotMatch(src("README.md"), /JPEG\/PNG\/WebP\/HEIC/, "README no longer says HEIC is accepted");
});

// ---------------------------------------------------------------------------
// QA-053
// ---------------------------------------------------------------------------

test("QA-053: offering reorder buttons are separate 44 px targets", () => {
  const s = src("app/vendor/offerings/offerings-manager.tsx");
  const group = s.match(/<span role="group" aria-label=\{`Reorder[^>]*>([\s\S]*?)<\/span>\s*<button/);
  assert.ok(group, "reorder group present");
  assert.match(group[0], /className="inline-flex gap-2/);
  const buttons = group[1].match(/className="btn [^"]*"/g) ?? [];
  assert.equal(buttons.length, 2);
  for (const b of buttons) assert.match(b, /min-w-11/);
  // .btn keeps a 44 px min-height below the sm breakpoint.
  assert.match(src("app/globals.css"), /\.btn \{[\s\S]*?min-height: 44px/);
});
