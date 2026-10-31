// Seeds sample vendors (Kerala) with offerings, packages, add-ons, service
// areas, reviews and media. The first 9 vendors are the same as /demo, so both
// versions of the app show consistent data; 3 more complete the P0-16
// archetypes (event company, chenda troupe, rental). Data: db/seed-data.mjs.
//
// Admin queue fixtures (P1, not public): 3 non-approved listings (2 pending,
// one with photos awaiting review; 1 changes requested), 3 "Kolkali" custom
// offerings, open review and media reports, a re-review flag, and sample
// enquiries including a spam burst (one phone to 11 vendors within 30 min).
// Their enquiry messages start with "[seed]". No admin user is created: use
// npm run admin:create.
//
// Media: placeholder photos are drawn by db/fixtures/make-media.mjs (our own
// gradients and text, license-free, each < 60 KB, committed under
// db/fixtures/media) and imported through the storage adapter
// (lib/storage, STORAGE_DRIVER, default local -> web/uploads/), with the same
// thumb/card/full WebP variants as a real upload (lib/media/image.ts).
//
// DESTRUCTIVE: it deletes ALL vendors, quote requests, reviews, services,
// media and favourites, then re-inserts the sample vendors (vendor ids restart
// at 1). Users are kept. To protect real data it refuses to run when the
// database holds anything the seed did not create (owned or extra vendors,
// quote requests, user-written reviews, favourites), unless the database name
// ends in "_test" or you pass --force (or set SEED_CONFIRM=1).
// Requires migrations first: npm run db:migrate
//
// Run with: npm run db:seed            (reads DATABASE_URL from .env.local)
//           npm run db:seed -- --force (wipe even if non-seed data exists)

import { registerHooks } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { allSeedVendors as vendors, reviewsByVendor, mediaPlan, fixtureSpecs, kolkaliOfferings } from "./seed-data.mjs";
import { ensureFixtures, FIXTURE_DIR } from "./fixtures/make-media.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load the app's TypeScript helpers (Node >= 22.18 strips types). Maps "@/..."
// and extensionless relative imports inside .ts files to the .ts source.
registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(WEB, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base && !path.extname(base)) {
      for (const cand of [`${base}.ts`, path.join(base, "index.ts")]) {
        if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
      }
    }
    return next(specifier, context);
  },
});
const tsImport = (rel) => import(pathToFileURL(path.join(WEB, rel)).href);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not found in the environment or .env.local. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const force = process.argv.includes("--force") || process.env.SEED_CONFIRM === "1";
const client = new pg.Client({ connectionString });

// Sample contact numbers (not real), one per vendor.
const phoneFor = (i) => `+9198950${String(10001 + i).padStart(5, "0")}`;

try {
  await client.connect();

  // Guard: never silently wipe data the seed did not create.
  const { rows: [db] } = await client.query("SELECT current_database() AS name");
  if (!force && !db.name.endsWith("_test")) {
    const { rows: [c] } = await client.query(
      `SELECT
         (SELECT count(*) FROM vendors WHERE owner_id IS NOT NULL OR NOT (name = ANY($1::text[])))::int AS vendors,
         (SELECT count(*) FROM quote_requests WHERE message IS NULL OR message NOT LIKE '[seed]%')::int AS quotes,
         (SELECT count(*) FROM vendor_reviews WHERE customer_id IS NOT NULL)::int AS reviews,
         (SELECT count(*) FROM favorites)::int AS favorites`,
      [vendors.map((v) => v.name)]
    );
    if (c.vendors + c.quotes + c.reviews + c.favorites > 0) {
      console.error(
        `✗ Refusing to seed "${db.name}": it contains non-seed data ` +
          `(${c.vendors} extra/owned vendors, ${c.quotes} quote requests, ${c.reviews} user reviews, ${c.favorites} favourites).\n` +
          `  Seeding DELETES all of it. Re-run with --force (npm run db:seed -- --force) or SEED_CONFIRM=1 if that is what you want.`
      );
      await client.end();
      process.exit(1);
    }
  }

  const { getStorage, currentStorageDriver } = await tsImport("lib/storage/index.ts");
  const { processImage } = await tsImport("lib/media/image.ts");
  const { formatVendorPriceLabel } = await tsImport("lib/offering-validation.ts");
  const storage = getStorage();
  const driver = currentStorageDriver();

  await ensureFixtures(fixtureSpecs());

  // Lookups
  const cats = new Map((await client.query("SELECT id, name FROM categories")).rows.map((r) => [r.name, r.id]));
  const districts = new Map((await client.query("SELECT id, name FROM districts WHERE state = 'Kerala'")).rows.map((r) => [r.name, r.id]));
  const templates = new Map(
    (await client.query("SELECT id, code, category_id, kind, default_price_unit, allowed_price_units FROM offering_templates")).rows
      .map((r) => [`${r.category_id}:${r.code}`, r])
  );
  const need = (map, key, what) => {
    const v = map.get(key);
    if (v === undefined) throw new Error(`Unknown ${what}: ${key}`);
    return v;
  };

  const oldIds = (await client.query("SELECT id FROM vendors")).rows.map((r) => r.id);

  await client.query("BEGIN");

  // Wipe and re-insert rather than trying to upsert-match by name.
  await client.query("DELETE FROM vendor_reviews");
  await client.query("DELETE FROM quote_requests");
  await client.query("DELETE FROM favorites");
  await client.query("DELETE FROM vendors"); // services, media, albums, areas cascade
  await client.query("ALTER SEQUENCE vendors_id_seq RESTART WITH 1");

  // Old files of the wiped vendors (ids restart, so clear before writing new ones).
  for (const id of new Set([...oldIds, ...vendors.map((_, i) => i + 1)])) {
    await storage.deletePrefix(`vendors/${id}`);
  }

  let offeringCount = 0;
  let mediaCount = 0;

  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    const primaryId = need(cats, v.category, "category");
    const districtId = need(districts, v.district, "district");
    const phone = phoneFor(i);
    const { rows: [{ id: vendorId }] } = await client.query(
      `INSERT INTO vendors (name, category, location, price, price_label, rating, reviews_count, experience, tags, about,
                            vendor_type, district_id, status, phone, whatsapp, primary_category_id, legal_name,
                            years_experience, team_size, languages, max_guests, max_events_per_day, fssai_no,
                            travel_outside_kerala, onboarding_step, onboarding_completed_at, submitted_at, reviewed_at,
                            status_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$23,$13,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,6,
               now(), now() - make_interval(hours => $24::int),
               CASE WHEN $23 IN ('approved','changes_requested') THEN now() END, $25)
       RETURNING id`,
      [
        v.name, v.category, v.location, v.price ?? 0, v.priceLabel ?? "Price on request", v.rating, v.reviewsCount, v.experience,
        v.tags, v.about, v.vendorType, districtId, phone, primaryId, v.legalName ?? null, v.years, v.team ?? null,
        v.languages ?? ["Malayalam", "English"], v.maxGuests ?? null, v.perDay ?? 1, v.fssai ?? null, !!v.travelOutside,
        v.status ?? "approved", v.submittedHoursAgo ?? 0, v.statusReason ?? null,
      ]
    );

    // Categories: primary + extras, plus any category an offering uses.
    const catIds = new Set([primaryId, ...(v.extraCategories ?? []).map((c) => need(cats, c, "category"))]);
    for (const o of v.offerings) catIds.add(need(cats, o.category, "category"));
    for (const c of catIds) {
      await client.query("INSERT INTO vendor_categories (vendor_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [vendorId, c]);
    }

    for (const [d, fee, note] of v.areas) {
      await client.query(
        "INSERT INTO vendor_service_areas (vendor_id, district_id, travel_fee, travel_note) VALUES ($1,$2,$3,$4)",
        [vendorId, need(districts, d, "district"), fee, note]
      );
    }

    // Offerings (units, then their add-ons), then packages built from them.
    const byKey = new Map();
    let sort = 0;
    const insertService = async (o, kind, parentId) => {
      const categoryId = need(cats, o.category, "category");
      const t = o.template && !o.asUnit ? need(templates, `${categoryId}:${o.template}`, `template (${o.category})`) : null;
      const unit = t && !t.allowed_price_units.includes(o.unit) ? t.default_price_unit : o.unit;
      const { rows: [s] } = await client.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit, sort_order, template_id,
                               custom_name, kind, sale_mode, fulfilment, parent_service_id, price_mode, unit_label, min_qty, inclusions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          vendorId, categoryId, o.title, o.description, o.price, unit, sort++, t?.id ?? null,
          t || o.asUnit ? null : o.title, kind, kind === "package" ? "separate" : o.saleMode ?? "separate",
          o.fulfilment ?? "in_house", parentId, o.mode ?? "from", o.unitLabel ?? null, o.minQty ?? null, o.inclusions ?? [],
        ]
      );
      offeringCount++;
      return s.id;
    };
    for (const o of v.offerings) {
      const id = await insertService(o, "unit", null);
      if (o.key) byKey.set(o.key, id);
      for (const a of o.addons ?? []) await insertService(a, "addon", id);
    }
    for (const p of v.packages ?? []) {
      const pkgId = await insertService({ ...p, category: v.category, unit: "package", template: null, asUnit: true }, "package", null);
      for (const [n, [key, qty]] of p.items.entries()) {
        await client.query("INSERT INTO package_items (package_id, item_id, qty, sort_order) VALUES ($1,$2,$3,$4)", [
          pkgId, need(byKey, key, "package item"), qty, n,
        ]);
      }
    }

    // Vendors outside /demo get their displayed price from the offerings, like a real listing.
    if (v.price === undefined) {
      const { rows: [best] } = await client.query(
        `SELECT price_from, price_unit, unit_label FROM services
          WHERE vendor_id = $1 AND kind IN ('unit','package') AND sale_mode = 'separate' AND price_from > 0
          ORDER BY price_from, id LIMIT 1`,
        [vendorId]
      );
      await client.query("UPDATE vendors SET price = $2, price_label = $3 WHERE id = $1", [
        vendorId, best?.price_from ?? 0, formatVendorPriceLabel(best ?? null),
      ]);
    }

    // Media: one album for the archetypes, then logo, cover and gallery.
    let albumId = null;
    if (v.album) {
      const { rows: [a] } = await client.query(
        "INSERT INTO media_albums (vendor_id, title, description, consent_confirmed_at) VALUES ($1,$2,$3,now()) RETURNING id",
        [vendorId, v.album.title, v.album.caption]
      );
      albumId = a.id;
    }
    const roles = {};
    let gallerySort = 0;
    for (const m of mediaPlan(v)) {
      const buf = readFileSync(path.join(FIXTURE_DIR, m.file));
      const uuid = randomUUID();
      const baseKey = `vendors/${vendorId}/${uuid}`;
      const processed = await processImage(buf, m.purpose);
      const variants = {};
      if (processed.fallback) {
        const key = `${baseKey}/full.jpg`;
        await storage.put(key, buf, { contentType: "image/jpeg" });
        variants.full = { key };
      } else {
        for (const pv of processed.variants) {
          const key = `${baseKey}/${pv.name}.webp`;
          await storage.put(key, pv.body, { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
          variants[pv.name] = { key, w: pv.width, h: pv.height };
        }
      }
      const gallery = m.purpose === "gallery";
      // The first two gallery photos of an archetype go in its album.
      const inAlbum = gallery && albumId && gallerySort < 2;
      const { rows: [row] } = await client.query(
        `INSERT INTO media_assets (uuid, vendor_id, album_id, purpose, kind, storage_driver, storage_key, variants, mime, bytes,
                                   width, height, sha256, placeholder_color, caption, alt_text, status, is_featured, sort_order)
         VALUES ($1,$2,$3,$4,'image',$5,$6,$7,'image/jpeg',$8,$9,$10,$11,$12,$13,$14,$17,$15,$16) RETURNING id`,
        [
          uuid, vendorId, inAlbum ? albumId : null, m.purpose, driver, baseKey, JSON.stringify(variants), buf.byteLength,
          processed.width || null, processed.height || null, createHash("sha256").update(buf).digest("hex"),
          processed.placeholderColor, m.caption, m.alt, gallery && gallerySort === 0, gallery ? gallerySort : 0,
          v.mediaStatus ?? "approved",
        ]
      );
      if (gallery) gallerySort++;
      else roles[m.purpose] = row.id;
      mediaCount++;
    }
    if (albumId) {
      await client.query(
        "UPDATE media_albums SET cover_media_id = (SELECT id FROM media_assets WHERE album_id = $1 ORDER BY sort_order LIMIT 1) WHERE id = $1",
        [albumId]
      );
    }
    if (v.videoLink) {
      const id = v.videoLink.match(/v=([A-Za-z0-9_-]{6,})/)?.[1] ?? null;
      await client.query(
        `INSERT INTO media_assets (vendor_id, purpose, kind, storage_driver, external_url, external_provider, external_id,
                                   caption, alt_text, status, sort_order)
         VALUES ($1,'gallery','video_link','url',$2,'youtube',$3,'Wedding highlights film','Wedding highlights film','approved',$4)`,
        [vendorId, v.videoLink, id, gallerySort++]
      );
      mediaCount++;
    }
    await client.query("UPDATE vendors SET logo_media_id = $2, cover_media_id = $3 WHERE id = $1", [
      vendorId, roles.logo ?? null, roles.cover ?? null,
    ]);

    for (const r of reviewsByVendor[v.name] ?? []) {
      await client.query("INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1,$2,$3,$4)", [
        vendorId, r.name, r.rating, r.body,
      ]);
    }
  }

  // ---- Admin queue fixtures (P1) ----------------------------------------
  const idOf = async (name) => (await client.query("SELECT id FROM vendors WHERE name = $1", [name])).rows[0].id;
  const { normaliseCustomName } = await tsImport("lib/offering-validation.ts");

  // Status history for the non-approved listings (vendor-visible timeline).
  for (const v of vendors.filter((x) => x.status && x.status !== "approved")) {
    const id = await idOf(v.name);
    await client.query(
      `INSERT INTO vendor_status_events (vendor_id, from_status, to_status, reason, created_at)
       VALUES ($1, 'draft', 'pending', NULL, now() - make_interval(hours => $2::int))`,
      [id, v.submittedHoursAgo ?? 0]
    );
    if (v.status === "changes_requested") {
      await client.query(
        "INSERT INTO vendor_status_events (vendor_id, from_status, to_status, reason) VALUES ($1, 'pending', 'changes_requested', $2)",
        [id, v.statusReason ?? null]
      );
    }
  }

  // Three vendors typed the same "Other" offering (P1-8 promote AC).
  const artsId = need(cats, "Traditional & Live Arts", "category");
  for (const k of kolkaliOfferings) {
    const vendorId = await idOf(k.vendor);
    const { rows: [svc] } = await client.query(
      `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit, sort_order, custom_name, kind)
       VALUES ($1, $2, $3, 'Kolkali troupe (12 dancers) for wedding eve and cultural programmes.', $4, 'event', 50, $3, 'unit')
       RETURNING id`,
      [vendorId, artsId, k.title, k.price]
    );
    await client.query("INSERT INTO vendor_categories (vendor_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [vendorId, artsId]);
    await client.query(
      `INSERT INTO custom_offering_requests (service_id, vendor_id, category_id, raw_name, normalised_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [svc.id, vendorId, artsId, k.title, normaliseCustomName(k.title)]
    );
    offeringCount++;
  }

  // Open review reports (anonymous reporters, so no users are needed).
  const reviewReports = [
    ["Rahul P.", "This review mentions a delay that never happened. I think it is from a competitor."],
    ["Kiran J.", "Reviewer was not a customer of this venue."],
  ];
  for (const [reviewer, reason] of reviewReports) {
    await client.query(
      `INSERT INTO review_reports (review_id, reason, created_at)
       SELECT id, $2, now() - interval '3 hours' FROM vendor_reviews WHERE reviewer_name = $1 LIMIT 1`,
      [reviewer, reason]
    );
  }

  // Two reported photos (one report each: still approved, in the Reported tab).
  const reportedMedia = await client.query(
    `SELECT m.id FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
      WHERE v.name IN ('Glow Bridal Studio', 'DJ Rhythm Kerala') AND m.purpose = 'gallery' AND m.status = 'approved'
      ORDER BY v.name, m.sort_order LIMIT 2`
  );
  const mediaReasons = ["Looks like a stock photo, not their own work.", "Shows a guest's face without consent."];
  for (const [i, row] of reportedMedia.rows.entries()) {
    await client.query("INSERT INTO media_reports (media_id, reason) VALUES ($1, $2)", [row.id, mediaReasons[i]]);
    await client.query("UPDATE media_assets SET report_count = report_count + 1 WHERE id = $1", [row.id]);
  }

  // An approved vendor renamed itself: shows in the re-review list.
  await client.query(
    `UPDATE vendors SET rereview_required = true, rereview_fields = ARRAY['name'],
            rereview_requested_at = now() - interval '20 hours' WHERE name = 'Henna Dreams'`
  );

  // Sample enquiries ([seed] messages): a few ordinary ones and a spam burst
  // (one phone to 11 approved vendors within 30 minutes, P1-13 flag).
  const approved = (await client.query("SELECT id FROM vendors WHERE status = 'approved' ORDER BY id")).rows.map((r) => r.id);
  const ordinary = [
    ["Anjali Menon", "+919847100201", "[seed] Wedding on 14 Feb, about 600 guests. Is the date free?", 26],
    ["Rahul Nair", "+919847100202", "[seed] Need a quote for a reception for 300 guests.", 9],
    ["Fathima K.", "+919847100203", "[seed] Mehendi for 15 guests the evening before the nikah.", 2],
  ];
  for (const [i, [name, phone, message, hoursAgo]] of ordinary.entries()) {
    await client.query(
      `INSERT INTO quote_requests (vendor_id, name, phone, message, created_at)
       VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5::int))`,
      [approved[i % approved.length], name, phone, message, hoursAgo]
    );
  }
  const burst = approved.slice(0, 11);
  for (const [i, vendorId] of burst.entries()) {
    await client.query(
      `INSERT INTO quote_requests (vendor_id, name, phone, message, created_at)
       VALUES ($1, 'Best Price Deals', '+919800000999', '[seed] Cheapest package? Call now for bulk offers.',
               now() - make_interval(mins => $2::int))`,
      [vendorId, 30 - i * 3]
    );
  }

  // Seed baseline (migration 003): the part of rating/reviews_count not backed
  // by vendor_reviews rows, so the first real review adds to it.
  await client.query(
    `UPDATE vendors v SET
       seed_reviews_count = GREATEST(v.reviews_count - r.n, 0),
       seed_rating = CASE WHEN v.reviews_count - r.n > 0
         THEN LEAST(5, GREATEST(0, (v.rating * v.reviews_count - r.total) / (v.reviews_count - r.n)))
         ELSE 0 END
     FROM (SELECT v2.id, count(rv.id)::int AS n, COALESCE(sum(rv.rating), 0) AS total
           FROM vendors v2 LEFT JOIN vendor_reviews rv ON rv.vendor_id = v2.id GROUP BY v2.id) r
     WHERE r.id = v.id`
  );

  await client.query("COMMIT");
  console.log(
    `✓ Seeded ${vendors.length} vendors with ${offeringCount} offerings/packages/add-ons, ${mediaCount} media items (${driver} storage) and reviews.`
  );
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("✗ Seed failed:", err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
