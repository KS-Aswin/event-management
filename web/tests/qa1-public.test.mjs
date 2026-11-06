// QA1 fix round, public pages: QA-010 (rating vs reviews), QA-015 (heading
// outline), QA-023 (one "from" price everywhere), QA-024 ("1 review").
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3153 node --env-file-if-exists=.env.local --test tests/qa1-public.test.mjs
//
// Test users are qa1fix-public-<digits>@example.com; they and the listings,
// offerings and reviews they own are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^qa1fix-public-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa1fix-public-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  const vendorIds = (await db().query("SELECT id FROM vendors WHERE owner_id = ANY($1::int[])", [ids])).rows.map((r) => r.id);
  await db().query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[]) OR vendor_id = ANY($2::int[])", [ids, vendorIds]);
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

const F = {};

/** Plain text of an HTML page (tags stripped, entities that matter decoded). */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/** Heading levels in document order, e.g. [1, 2, 2, 3]. */
function headingLevels(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<template[\s\S]*?<\/template>/gi, "");
  return [...body.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
}

async function customer(name) {
  const u = await db().query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'customer') RETURNING id", [
    name,
    email(),
  ]);
  return u.rows[0].id;
}

async function review(vendorId, customerId, rating, body) {
  await db().query(
    "INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body) VALUES ($1, $2, 'Qa1fix Reviewer', $3, $4)",
    [vendorId, customerId, rating, body]
  );
}

before(async () => {
  await cleanup();
  // A signed-in vendor, so offerings go through the real API (which keeps the
  // vendors.price / price_label cache up to date).
  const s = await signup({ role: "vendor", name: "Qa1fix Venue Owner", email: email(), password: TEST_PASSWORD });
  assert.equal(s.status, 201, `vendor signup: ${JSON.stringify(s.data)}`);
  F.vendor = s;
  const venue = await createListing(s.userId, { name: `Qa1fix Lakeside Venue ${RUN_ID}`, category: "Venue", status: "approved" });
  // Featured and boosted, so it ranks first in Venue on /e/hindu-wedding.
  await db().query("UPDATE vendors SET published = true, featured_until = now() + interval '1 day', rank_boost = 100 WHERE id = $1", [venue.id]);
  F.venue = venue.id;

  // Owners straight in the DB for the review fixtures (no sign-up rate limit).
  const owner = async () =>
    (await db().query("INSERT INTO users (name, email, password_hash, role) VALUES ('Qa1fix Owner', $1, 'x', 'vendor') RETURNING id", [email()]))
      .rows[0].id;
  const one = await createListing(await owner(), { name: `Qa1fix Onereview Makeup ${RUN_ID}`, category: "Makeup", status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [one.id]);
  F.oneReview = one.id;
  const imported = await createListing(await owner(), { name: `Qa1fix Imported Photo ${RUN_ID}`, category: "Photography", status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [imported.id]);
  F.imported = imported.id;
  F.customers = [await customer("Qa1fix Asha"), await customer("Qa1fix Biju")];
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-023: one "from" price per vendor
// ---------------------------------------------------------------------------

test("QA-023: a venue's from-price is its cheapest VENUE offering, not a per-plate add-on in another category", async () => {
  const tax = (await request("/api/meta/taxonomy")).data;
  const cat = (slug) => tax.categories.find((c) => c.slug === slug);
  const unitTpl = (slug) => tax.templates.find((t) => t.kind === "unit" && t.category_id === cat(slug)?.id);
  const venueTpl = unitTpl("venue");
  const cateringTpl = unitTpl("catering");
  assert.ok(venueTpl && cateringTpl, "taxonomy has venue and catering unit templates");

  const add = async (tpl, priceFrom, priceUnit) => {
    const r = await request("/api/vendor/offerings", {
      method: "POST",
      cookie: F.vendor.cookie,
      body: { templateId: tpl.id, priceMode: "from", priceFrom, priceUnit, saleMode: "separate" },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  };
  await add(cateringTpl, 600, "plate");
  await add(venueTpl, 150000, venueTpl.default_price_unit ?? "slot");

  const v = (await db().query("SELECT price, price_label FROM vendors WHERE id = $1", [F.venue])).rows[0];
  assert.equal(v.price, 150000, "the main-category (venue) offering sets the price");
  assert.match(v.price_label, /^₹1,50,000 /);
  F.label = v.price_label;
});

test("QA-023: profile, search and the /e card all show that same price", async () => {
  assert.ok(F.label, "previous test set the label");
  const profile = await request(`/vendors/${F.venue}`);
  assert.equal(profile.status, 200);
  const pText = textOf(profile.text);
  assert.ok(pText.includes(`Starting from ${F.label}`), "profile headline uses the cached from-price");

  const search = await request(`/search?q=${encodeURIComponent(`Lakeside Venue ${RUN_ID}`)}`);
  assert.equal(search.status, 200);
  const sText = textOf(search.text);
  assert.ok(sText.includes(`Qa1fix Lakeside Venue ${RUN_ID}`), "search finds the fixture");
  assert.ok(sText.includes(F.label), "search card shows the same from-price");
  assert.ok(!sText.includes("₹600 per plate"), "search card doesn't show the catering add-on as the from-price");

  const e = await request("/e/hindu-wedding");
  assert.equal(e.status, 200);
  const eText = textOf(e.text);
  const i = eText.indexOf(`Qa1fix Lakeside Venue ${RUN_ID}`);
  assert.ok(i >= 0, "the boosted venue is on the event page");
  const card = eText.slice(i, i + 200);
  assert.ok(card.includes(F.label), `the /e card shows the same from-price (${card})`);
});

// ---------------------------------------------------------------------------
// QA-010 / QA-024: review counts agree with the reviews
// ---------------------------------------------------------------------------

test("QA-010: no vendor stores an invented review baseline; counts match visible reviews", async () => {
  const r = await db().query(
    `SELECT v.id, v.name, v.reviews_count,
            (SELECT count(*)::int FROM vendor_reviews rv WHERE rv.vendor_id = v.id AND rv.hidden_at IS NULL) AS n
       FROM vendors v
      WHERE v.seed_reviews_count = 0 AND v.reviews_count <> (SELECT count(*) FROM vendor_reviews rv WHERE rv.vendor_id = v.id AND rv.hidden_at IS NULL)
        AND v.name NOT LIKE 'Qa1fix%'
        -- other suites' fixtures (customer-search etc.) set aggregates by hand
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.owner_id AND u.email ~ '@example\\.com$')`
  );
  assert.deepEqual(r.rows, [], "every real/demo vendor's count equals its visible reviews");
  const seeded = await db().query(
    "SELECT count(*)::int AS n FROM vendors v WHERE v.seed_reviews_count > 0 AND v.owner_id IS NULL"
  );
  assert.equal(seeded.rows[0].n, 0, "seeded vendors have no invented baseline after migration 016");
});

test("QA-010 + QA-024: one review reads '1 review' and the breakdown adds up to the count", async () => {
  await review(F.oneReview, F.customers[0], 5, "Lovely work on the day, very calm and on time.");
  // What recomputeVendorRating stores for one 5-star review.
  await db().query("UPDATE vendors SET rating = 5.0, reviews_count = 1 WHERE id = $1", [F.oneReview]);

  const page = await request(`/vendors/${F.oneReview}`);
  assert.equal(page.status, 200);
  const t = textOf(page.text);
  assert.ok(t.includes("(1 review)"), "header says (1 review)");
  assert.ok(!/\b1 reviews\b/.test(t), "never '1 reviews'");
  const summary = page.text.match(/data-testid="rating-summary"[\s\S]*?<\/ul>/)?.[0] ?? "";
  assert.ok(summary, "rating summary rendered");
  const counts = [...textOf(summary).matchAll(/(\d) ★ (\d+)/g)].map((m) => Number(m[2]));
  assert.equal(counts.length, 5);
  assert.equal(counts.reduce((a, b) => a + b, 0), 1, "breakdown sums to the review count");

  const search = await request(`/search?q=${encodeURIComponent(`Onereview Makeup ${RUN_ID}`)}`);
  const s = textOf(search.text);
  assert.ok(s.includes("(1 review)"), "search card says (1 review)");
  assert.ok(!s.includes("(1 reviews)"));
});

test("QA-010: imported ratings outside Vela are explained, not mixed into the breakdown", async () => {
  // A verifiable import of 10 earlier ratings (the baseline mechanism), plus 2 on Vela.
  await review(F.imported, F.customers[0], 5, "Beautiful candid photos, would book again.");
  await review(F.imported, F.customers[1], 4, "Good photos, album took a few weeks longer.");
  await db().query(
    "UPDATE vendors SET seed_rating = 4.0, seed_reviews_count = 10, rating = 4.1, reviews_count = 12 WHERE id = $1",
    [F.imported]
  );
  const page = await request(`/vendors/${F.imported}`);
  const t = textOf(page.text);
  assert.ok(t.includes("(12 reviews)"));
  assert.ok(t.includes("10 reviews collected before this business joined Vela"), "the gap is explained");
  assert.ok(t.includes("show the 2 reviews written on Vela"));
  const summary = page.text.match(/data-testid="rating-summary"[\s\S]*?<\/ul>/)?.[0] ?? "";
  const counts = [...textOf(summary).matchAll(/(\d) ★ (\d+)/g)].map((m) => Number(m[2]));
  assert.equal(counts.reduce((a, b) => a + b, 0), 2, "breakdown counts the reviews on Vela");
});

test("QA-010: a vendor with no reviews says so instead of '0 (0 reviews)'", async () => {
  const fresh = await createListing(
    (await db().query("INSERT INTO users (name, email, password_hash, role) VALUES ('Qa1fix Owner', $1, 'x', 'vendor') RETURNING id", [email()]))
      .rows[0].id,
    { name: `Qa1fix Fresh Decor ${RUN_ID}`, category: "Decoration", status: "approved" }
  );
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [fresh.id]);
  const t = textOf((await request(`/vendors/${fresh.id}`)).text);
  assert.ok(t.includes("New on Vela · no reviews yet"));
  assert.ok(!t.includes("(0 reviews)"));
});

// ---------------------------------------------------------------------------
// QA-015: heading outline
// ---------------------------------------------------------------------------

function assertNoSkippedLevels(levels, where) {
  assert.ok(levels.length > 0, `${where}: has headings`);
  assert.equal(levels.filter((l) => l === 1).length, 1, `${where}: exactly one h1 (${levels.join(",")})`);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1] + 1, `${where}: h${levels[i - 1]} is followed by h${levels[i]} (${levels.join(",")})`);
  }
}

test("QA-015: /search has one h1 and no skipped heading levels", async () => {
  for (const path of ["/search", "/search?category=Makeup", "/search?view=offerings"]) {
    const r = await request(path);
    assert.equal(r.status, 200, path);
    assertNoSkippedLevels(headingLevels(r.text), path);
  }
  const r = await request("/search?category=Makeup&location=Ernakulam");
  assert.match(textOf(r.text), /Makeup in Ernakulam/, "the h1 names the search");
});

test("QA-015: vendor profiles (one category and several) don't skip heading levels", async () => {
  // F.venue has venue + catering offerings (category h3 then h4 per offering).
  const multi = await request(`/vendors/${F.venue}`);
  assertNoSkippedLevels(headingLevels(multi.text), "multi-category profile");
  // A single-category vendor: offering titles sit straight under the h2.
  const tax = (await request("/api/meta/taxonomy")).data;
  const venueTpl = tax.templates.find((t) => t.kind === "unit" && t.category_id === tax.categories.find((c) => c.slug === "venue")?.id);
  await db().query(
    `INSERT INTO services (vendor_id, category_id, template_id, title, price_from, price_unit, kind, sale_mode, active)
     VALUES ($1, $2, $3, 'Qa1fix lawn', 50000, 'slot', 'unit', 'separate', true)`,
    [F.oneReview, venueTpl.category_id, venueTpl.id]
  );
  const single = await request(`/vendors/${F.oneReview}`);
  assert.ok(textOf(single.text).includes("Qa1fix lawn"), "the offering is listed");
  assertNoSkippedLevels(headingLevels(single.text), "single-category profile");
});
