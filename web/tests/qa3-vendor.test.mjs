// QA round 3 fixes, vendor group b (event-management-qa-tracker.md):
//   QA-058 onboarding step 3: the package sheet uses the prices typed on the
//          page and ticks the priced units; a valid price clears a stale error
//   QA-068 removing the cover/logo deletes the image made for it (row + files)
//          and the wizard summary counts portfolio photos only
//   QA-069 a live listing can't delete / switch off its last bookable priced
//          offering (409 LISTING_MINIMUM), like the photo minimum
//   QA-070 /vendor/profile "Where you work" doesn't count the home district
//   QA-077 relative notification times don't cause a hydration mismatch
//   QA-078 the lead-card name link is a 44 px tap target
//   QA-083 /vendor/calendar Profile link is underlined; the disabled uploader
//          hint keeps its full contrast
//
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3162 node --env-file-if-exists=.env.local --test tests/qa3-vendor.test.mjs
//
// Test users are qa3fix-b-<digits>@example.com; they and what they own are
// removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { request, signup, db, closeDb, RUN_ID, WEB_DIR } from "./admin-helpers.mjs";

const PATTERN = "^qa3fix-b-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa3fix-b-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const src = (rel) => readFileSync(path.join(WEB_DIR, rel), "utf8");
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || process.env.STORAGE_LOCAL_ROOT || path.join(WEB_DIR, "uploads"));
const vendorIds = [];

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  const v = await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[]) RETURNING id", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  for (const row of [...v.rows.map((r) => r.id), ...vendorIds]) {
    rmSync(path.join(uploadsRoot, "vendors", String(row)), { recursive: true, force: true });
  }
}

/** A vendor with a draft listing (through the API, like the wizard does). */
async function vendorWithListing(label) {
  const s = await signup({ role: "vendor", name: `Qa3fix ${label}`, email: email() });
  assert.ok(s.cookie, `vendor signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  const { rows: cat } = await db().query("SELECT id FROM categories ORDER BY id LIMIT 1");
  const { rows: dist } = await db().query("SELECT id FROM districts ORDER BY id LIMIT 1");
  const r = await request("/api/vendor/listing", {
    method: "POST",
    cookie: s.cookie,
    body: { name: `Qa3fix ${label} ${RUN_ID}`, vendorType: "individual", primaryCategoryId: cat[0].id, districtId: dist[0].id, phone: "+919847011224" },
  });
  assert.ok([200, 201].includes(r.status), `listing: ${r.status} ${JSON.stringify(r.data)}`);
  const vendorId = (await db().query("SELECT id FROM vendors WHERE owner_id = $1", [s.userId])).rows[0].id;
  vendorIds.push(vendorId);
  await db().query("UPDATE vendors SET about = $2 WHERE id = $1", [vendorId, "A test business made by the qa3 vendor fix suite, long enough."]);
  return { cookie: s.cookie, userId: s.userId, vendorId, districtId: dist[0].id };
}

const approve = (vendorId) =>
  db().query("UPDATE vendors SET status = 'approved', onboarding_completed_at = now(), submitted_at = now() WHERE id = $1", [vendorId]);

let mediaSeq = 0;
/** A media row; with `file: true` it is a local-driver asset with a real full.webp on disk. */
async function addMedia(vendorId, purpose, { status = "approved", file = false } = {}) {
  mediaSeq += 1;
  if (!file) {
    const { rows } = await db().query(
      `INSERT INTO media_assets (vendor_id, kind, purpose, storage_driver, storage_key, status, sort_order)
       VALUES ($1, 'image', $2, 'url', $3, $4, $5) RETURNING id`,
      [vendorId, purpose, `/qa3fix-b-${RUN_ID}-${mediaSeq}.jpg`, status, mediaSeq]
    );
    return { id: rows[0].id };
  }
  const uuid = randomUUID();
  const key = `vendors/${vendorId}/${uuid}`;
  const dir = path.join(uploadsRoot, "vendors", String(vendorId), uuid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "full.webp"), Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 qa3fix"));
  const { rows } = await db().query(
    `INSERT INTO media_assets (vendor_id, kind, purpose, storage_driver, storage_key, variants, mime, status, sort_order)
     VALUES ($1, 'image', $2, 'local', $3, $4, 'image/webp', $5, $6) RETURNING id`,
    [vendorId, purpose, key, JSON.stringify({ full: { key: `${key}/full.webp`, w: 1600, h: 900 } }), status, mediaSeq]
  );
  return { id: rows[0].id, url: `/media/${key}/full.webp`, dir };
}

async function setRole(vendorId, role, mediaId) {
  const col = role === "logo" ? "logo_media_id" : "cover_media_id";
  await db().query(`UPDATE vendors SET ${col} = $2 WHERE id = $1`, [vendorId, mediaId]);
}

async function addService(vendorId, { kind = "unit", price = 20000, saleMode = "separate", title, active = true }) {
  const { rows } = await db().query(
    `INSERT INTO services (vendor_id, category_id, title, price_from, kind, sale_mode, price_mode, active)
     SELECT id, primary_category_id, $2, $3, $4, $5, 'from', $6 FROM vendors WHERE id = $1 RETURNING id`,
    [vendorId, title, price, kind, saleMode, active]
  );
  return rows[0].id;
}

const exists = async (id) => (await db().query("SELECT 1 FROM media_assets WHERE id = $1", [id])).rowCount === 1;

before(cleanup);
after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-068
// ---------------------------------------------------------------------------

test("QA-068: removing the cover deletes the image made for it (row and files stop being served)", async () => {
  const v = await vendorWithListing("Cover");
  const cover = await addMedia(v.vendorId, "cover", { file: true });
  await setRole(v.vendorId, "cover", cover.id);

  let img = await request(cover.url);
  assert.equal(img.status, 200, "the cover is served before removal");

  const r = await request("/api/vendor/media/cover", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await exists(cover.id), false, "the media_assets row is gone");
  assert.equal(existsSync(path.join(cover.dir, "full.webp")), false, "the files are gone");
  img = await request(cover.url);
  assert.equal(img.status, 404, "the old URL no longer serves the photo");
  const { rows } = await db().query("SELECT cover_media_id, cover_image_url FROM vendors WHERE id = $1", [v.vendorId]);
  assert.equal(rows[0].cover_media_id, null);
  assert.equal(rows[0].cover_image_url, null);
});

test("QA-068: a portfolio photo used as the logo stays in the portfolio when the logo is removed", async () => {
  const v = await vendorWithListing("LogoGallery");
  const photo = await addMedia(v.vendorId, "gallery");
  let r = await request("/api/vendor/media/logo", { method: "PUT", cookie: v.cookie, body: { mediaId: photo.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await request("/api/vendor/media/logo", { method: "PUT", cookie: v.cookie, body: { mediaId: null } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await exists(photo.id), true, "the gallery photo is kept");
});

test("QA-068: swapping the cover for a portfolio photo deletes the old cover-only image", async () => {
  const v = await vendorWithListing("Swap");
  const cover = await addMedia(v.vendorId, "cover", { file: true });
  await setRole(v.vendorId, "cover", cover.id);
  const photo = await addMedia(v.vendorId, "gallery");
  const r = await request("/api/vendor/media/cover", { method: "PUT", cookie: v.cookie, body: { mediaId: photo.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await exists(cover.id), false, "the replaced cover-only image is deleted");
  assert.equal(await exists(photo.id), true);
});

test("QA-068: the wizard's photo count is portfolio photos only (not the logo or cover)", async () => {
  const v = await vendorWithListing("Count");
  for (let i = 0; i < 3; i++) await addMedia(v.vendorId, "gallery");
  await addMedia(v.vendorId, "gallery", { status: "rejected" });
  const logo = await addMedia(v.vendorId, "logo");
  const cover = await addMedia(v.vendorId, "cover");
  await setRole(v.vendorId, "logo", logo.id);
  await setRole(v.vendorId, "cover", cover.id);
  const r = await request("/api/vendor/listing", { cookie: v.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.media.images, 3, JSON.stringify(r.data.media));
});

// ---------------------------------------------------------------------------
// QA-069
// ---------------------------------------------------------------------------

test("QA-069: a live listing can't delete or switch off its last bookable priced offering", async () => {
  const v = await vendorWithListing("Offer");
  const a = await addService(v.vendorId, { title: "Candid photography" });
  await approve(v.vendorId);

  let r = await request(`/api/vendor/offerings/${a}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, "LISTING_MINIMUM");
  assert.match(r.data.error, /at least one priced offering or package/);

  r = await request(`/api/vendor/offerings/${a}`, { method: "PATCH", cookie: v.cookie, body: { active: false } });
  assert.equal(r.status, 409, "switching it off is refused too");
  r = await request(`/api/vendor/offerings/${a}`, { method: "PATCH", cookie: v.cookie, body: { saleMode: "package_only" } });
  assert.equal(r.status, 409, "making it package-only is refused too");

  // Editing it in other ways still works.
  r = await request(`/api/vendor/offerings/${a}`, { method: "PATCH", cookie: v.cookie, body: { priceFrom: 25000 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // With a second priced unit, the first can go; then the second can't.
  const b = await addService(v.vendorId, { title: "Traditional photography" });
  r = await request(`/api/vendor/offerings/${a}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await request(`/api/vendor/offerings/${b}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409);
});

test("QA-069: deleting a unit whose package would become incomplete counts the package as lost", async () => {
  const v = await vendorWithListing("Pkg");
  const unit = await addService(v.vendorId, { title: "Photo unit", saleMode: "package_only" });
  const pkg = await addService(v.vendorId, { title: "Wedding package", kind: "package", price: 50000 });
  await db().query("INSERT INTO package_items (package_id, item_id, qty) VALUES ($1, $2, 1)", [pkg, unit]);
  await approve(v.vendorId);
  // The package is the only bookable thing; deleting its unit would make it incomplete.
  let r = await request(`/api/vendor/offerings/${unit}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  r = await request(`/api/vendor/packages/${pkg}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.data));
});

test("QA-069: draft listings can still remove their offerings", async () => {
  const v = await vendorWithListing("DraftOffer");
  const a = await addService(v.vendorId, { title: "Candid photography" });
  const r = await request(`/api/vendor/offerings/${a}`, { method: "DELETE", cookie: v.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

// ---------------------------------------------------------------------------
// QA-070
// ---------------------------------------------------------------------------

test("QA-070: 'Where you work' doesn't count the home district as a travel district", async () => {
  const v = await vendorWithListing("Areas");
  await db().query(
    "INSERT INTO vendor_service_areas (vendor_id, district_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [v.vendorId, v.districtId]
  );
  let page = await request("/vendor/profile", { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /You also travel to 1 district/);
  assert.match(page.text, /You haven(&#x27;|')t added other districts yet/);

  const { rows } = await db().query("SELECT id FROM districts WHERE id <> $1 ORDER BY id LIMIT 1", [v.districtId]);
  await db().query("INSERT INTO vendor_service_areas (vendor_id, district_id) VALUES ($1, $2)", [v.vendorId, rows[0].id]);
  page = await request("/vendor/profile", { cookie: v.cookie });
  assert.match(page.text, /You also travel to <!-- -->?1<!-- -->? district\.|You also travel to 1 district\./);
});

// ---------------------------------------------------------------------------
// QA-077
// ---------------------------------------------------------------------------

test("QA-077: the server render of 'Updates from Vela' doesn't print clock-dependent relative times", async () => {
  const v = await vendorWithListing("Notes");
  await approve(v.vendorId);
  await db().query(
    `INSERT INTO notifications (user_id, kind, payload, created_at)
     VALUES ($1, 'listing_approved', '{"title":"Qa3fix note"}', now() - interval '89.9 seconds')`,
    [v.userId]
  );
  const page = await request("/vendor", { cookie: v.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Qa3fix note/);
  assert.doesNotMatch(page.text, /min ago|just now/, "relative times are rendered on the client after mount");
  const s = src("app/vendor/notifications-list.tsx");
  assert.match(s, /useSyncExternalStore\(subscribeClock, clockSnapshot, serverClock\)/);
  assert.match(s, /suppressHydrationWarning/);
});

// ---------------------------------------------------------------------------
// QA-058, QA-078, QA-083 (client components; the e2e spec covers QA-058 end to end)
// ---------------------------------------------------------------------------

test("QA-058: 'Create a package from these' saves typed prices and pre-ticks the priced units", () => {
  const s = src("app/vendor/onboarding/step-prices.tsx");
  assert.match(s, /async function openNewPackage\(\)/);
  assert.match(s, /h\.priced\(\)/);
  assert.match(s, /preselect=\{composer\.preselect \?\?/);
  const f = src("app/vendor/_components/offering-unit-form.tsx");
  assert.match(f, /priced: \(\) => boolean;/);
  assert.match(f, /if \(err\?\.field === field && Number\(v\) > 0\) setErr\(null\)/, "a valid price clears the stale error");
});

test("QA-078: the lead-card name link is at least 44 px tall", () => {
  const s = src("app/vendor/leads/lead-row.tsx");
  assert.match(s, /href=\{`\/vendor\/leads\/\$\{l\.id\}`\} className="inline-flex items-center min-h-11/);
});

test("QA-083: calendar Profile link is underlined; the disabled uploader doesn't fade its hint", () => {
  const c = src("app/vendor/calendar/calendar-client.tsx");
  assert.match(c, /href="\/vendor\/profile" className="text-accent underline /);
  const u = src("app/vendor/_components/media-uploader.tsx");
  assert.doesNotMatch(u, /\$\{blocked \? "opacity-70" : ""\}/, "no opacity on the whole drop zone (it dimmed the hint text)");
});
