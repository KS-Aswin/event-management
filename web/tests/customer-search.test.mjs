// Search v2 and browse pages (PRODUCT_PLAN P2-7, P2-8).
//
//   BASE_URL=http://localhost:3153 node --env-file-if-exists=.env.local --test tests/customer-search.test.mjs
//
// Builds its own fixture vendors straight in the LOCAL database (owners are
// custtest-search-<digits>@example.com users; every fixture name carries a
// per-run tag, and queries add q=<tag> so other data never interferes), then
// checks the API and pages. Everything it creates is deleted again (and
// leftovers from an interrupted run are removed first).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, db, closeDb, RUN_ID } from "./admin-helpers.mjs";

const TAG = `srch${RUN_ID.toString(36)}`;
const EMAIL_RE = "^custtest-search-[0-9]+@example\\.com$";

function istDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}
const DATE = istDate(30);

async function cleanup() {
  const pool = db();
  const users = await pool.query("SELECT id FROM users WHERE email ~ $1", [EMAIL_RE]);
  const ids = users.rows.map((r) => r.id);
  if (!ids.length) return;
  await pool.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

const F = {}; // fixture key -> { id, services: { key: id } }
let seq = 0;

async function lookup(table, col, value) {
  const r = await db().query(`SELECT id FROM ${table} WHERE ${col} = $1`, [value]);
  assert.ok(r.rows[0], `${table}.${col} = ${value} exists (run npm run db:migrate)`);
  return r.rows[0].id;
}

async function template(code) {
  return lookup("offering_templates", "code", code);
}

async function makeVendor(key, v) {
  const pool = db();
  seq += 1;
  const email = `custtest-search-${RUN_ID}${String(seq).padStart(3, "0")}@example.com`;
  const u = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, 'x', 'vendor') RETURNING id",
    [`Search ${key}`, email]
  );
  const categoryId = await lookup("categories", "name", v.category);
  const districtId = await lookup("districts", "name", v.district);
  const r = await pool.query(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, district_id,
                         status, published, primary_category_id, rating, reviews_count, verified_at, featured_until,
                         rank_boost, max_guests)
     VALUES ($1, $2, $3, $4, $5, 'From test', '5 years', 'Fixture vendor for the search tests.', $6, $7, true, $8,
             $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      u.rows[0].id, `${TAG} ${v.name}`, v.category, v.district, v.price ?? 10000, districtId, v.status ?? "approved",
      categoryId, v.rating ?? 4.5, v.reviews ?? 10, v.verified ? new Date() : null,
      v.featured ? new Date(Date.now() + 7 * 86_400_000) : null, v.boost ?? 0, v.maxGuests ?? null,
    ]
  );
  const vendorId = r.rows[0].id;
  F[key] = { id: vendorId, name: `${TAG} ${v.name}`, services: {} };
  for (const d of v.serves ?? []) {
    await pool.query("INSERT INTO vendor_service_areas (vendor_id, district_id) VALUES ($1, $2)", [
      vendorId, await lookup("districts", "name", d),
    ]);
  }
  for (const s of v.services ?? []) {
    const cat = await lookup("categories", "name", s.category ?? v.category);
    const res = await pool.query(
      `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit, template_id, kind,
                             sale_mode, active, price_mode)
       VALUES ($1, $2, $3, '', $4, $5, $6, 'unit', $7, $8, 'from') RETURNING id`,
      [vendorId, cat, `${TAG} ${s.title}`, s.price, s.unit, s.template ? await template(s.template) : null,
       s.saleMode ?? "separate", s.active ?? true]
    );
    F[key].services[s.key] = res.rows[0].id;
  }
  for (const a of v.availability ?? []) {
    await pool.query(
      `INSERT INTO vendor_availability (vendor_id, date, slot, status, capacity_total, capacity_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [vendorId, DATE, a.slot, a.status, a.total ?? 1, a.used ?? 0]
    );
  }
}

before(async () => {
  await cleanup();
  // A Thrissur photographer that travels to Ernakulam (verified).
  await makeVendor("lens", {
    name: "Lens and Light", category: "Photography", district: "Thrissur", serves: ["Ernakulam"], verified: true,
    rating: 4.6, reviews: 40,
    services: [
      { key: "candid", title: "Candid photography", template: "candid-photography", price: 45000, unit: "event" },
      { key: "off", title: "Retired album offer", template: "album-printing", price: 5000, unit: "item", active: false },
    ],
  });
  // An Ernakulam event company: one separately sellable photo unit, one package-only.
  await makeVendor("eventco", {
    name: "Event Company", category: "Event Management", district: "Ernakulam", rating: 4.2, reviews: 5,
    services: [
      { key: "separate", title: "Candid coverage", category: "Photography", template: "candid-photography", price: 40000, unit: "event" },
      { key: "pkgonly", title: "Partner photography", category: "Photography", template: "wedding-photography", price: 30000, unit: "event", saleMode: "package_only" },
    ],
  });
  // An Ernakulam caterer priced per plate, up to 800 guests.
  await makeVendor("spice", {
    name: "Spice Caterers", category: "Catering", district: "Ernakulam", maxGuests: 800, rating: 4.4, reviews: 12,
    services: [{ key: "sadya", title: "Kerala sadya", template: "kerala-sadhya", price: 600, unit: "plate" }],
  });
  // A Kottayam photographer that does not travel (featured).
  await makeVendor("home", {
    name: "Kottayam Frames", category: "Photography", district: "Kottayam", featured: true, rating: 3.9, reviews: 2,
    services: [{ key: "photo", title: "Wedding photos", template: "wedding-photography", price: 30000, unit: "event" }],
  });
  // Ernakulam photographers with calendar entries on DATE.
  await makeVendor("blocked", {
    name: "Blocked Studio", category: "Photography", district: "Ernakulam", availability: [{ slot: "full", status: "blocked" }],
    services: [{ key: "photo", title: "Photos", template: "wedding-photography", price: 25000, unit: "event" }],
  });
  await makeVendor("halfbooked", {
    name: "Booked Twice Studio", category: "Photography", district: "Ernakulam",
    availability: [{ slot: "morning", status: "booked", used: 1 }, { slot: "evening", status: "booked", used: 1 }],
    services: [{ key: "photo", title: "Photos", template: "wedding-photography", price: 25000, unit: "event" }],
  });
  await makeVendor("limited", {
    name: "Limited Studio", category: "Photography", district: "Ernakulam", boost: 5, rating: 4.0, reviews: 1,
    availability: [{ slot: "full", status: "limited", total: 2, used: 1 }],
    services: [{ key: "photo", title: "Photos", template: "wedding-photography", price: 25000, unit: "event" }],
  });
  // Not approved: never in search.
  await makeVendor("pending", {
    name: "Pending Studio", category: "Photography", district: "Ernakulam", status: "pending",
    services: [{ key: "photo", title: "Pending photos", template: "candid-photography", price: 20000, unit: "event" }],
  });
});

after(async () => {
  await cleanup();
  await closeDb();
});

const q = (params) => `/api/vendors?${new URLSearchParams({ q: TAG, ...params }).toString()}`;
const names = (r) => (r.data?.vendors ?? []).map((v) => v.name);
const has = (r, key) => names(r).includes(F[key].name);

test("invalid search params are a 400 naming the field", async () => {
  const cases = [
    [{ view: "maps" }, "view"],
    [{ date: "2020-01-01" }, "date"],
    [{ date: "2026-02-30" }, "date"],
    [{ date: "tomorrow" }, "date"],
    [{ budgetMax: "abc" }, "budgetMax"],
    [{ budgetMax: "-5" }, "budgetMax"],
    [{ priceUnit: "bucket" }, "priceUnit"],
    [{ guests: "0" }, "guests"],
    [{ guests: "1.5" }, "guests"],
    [{ district: "Atlantis" }, "district"],
    [{ page: "0" }, "page"],
    [{ sort: "random" }, "sort"],
    [{ offering: "<script>" }, "offering"],
    [{ eventType: "../etc" }, "eventType"],
    [{ minRating: "9" }, "minRating"],
  ];
  for (const [params, field] of cases) {
    const r = await request(q(params));
    assert.equal(r.status, 400, `${JSON.stringify(params)} -> 400`);
    assert.equal(r.data?.field, field, `${JSON.stringify(params)} names ${field}`);
  }
});

test("offerings view: Photography in Ernakulam shows separately sellable units only", async () => {
  const r = await request(q({ view: "offerings", category: "Photography", district: "Ernakulam", limit: "100" }));
  assert.equal(r.status, 200);
  assert.equal(r.data.view, "offerings");
  const ids = r.data.offerings.map((o) => o.id);
  assert.ok(ids.includes(F.eventco.services.separate), "event company's separate photography unit");
  assert.ok(!ids.includes(F.eventco.services.pkgonly), "never its package-only unit");
  assert.ok(ids.includes(F.lens.services.candid), "Thrissur vendor serving Ernakulam");
  assert.ok(!ids.includes(F.lens.services.off), "inactive offering hidden");
  assert.ok(!ids.includes(F.home.services.photo), "Kottayam vendor that doesn't travel is excluded");
  assert.ok(!r.data.offerings.some((o) => o.vendor.id === F.pending.id), "unapproved vendor never listed");
  assert.ok(r.data.offerings.every((o) => o.category === "Photography" && ["unit", "package"].includes(o.kind)));
  const card = r.data.offerings.find((o) => o.id === F.lens.services.candid);
  assert.equal(card.priceLabel, "From ₹45,000 / event");
  assert.equal(card.vendor.name, F.lens.name);
  assert.equal(card.vendor.location, "Thrissur");
  assert.equal(card.vendor.verified, true);
  assert.equal(r.data.total, r.data.offerings.length);
});

test("vendors view: served districts match unless homeOnly", async () => {
  const served = await request(q({ district: "Ernakulam" }));
  assert.equal(served.status, 200);
  assert.ok(has(served, "lens"), "Thrissur vendor serving Ernakulam appears");
  assert.ok(has(served, "spice") && has(served, "eventco"));
  assert.ok(!has(served, "home") && !has(served, "pending"));
  const byId = await request(q({ district: String(await lookup("districts", "name", "Ernakulam")) }));
  assert.deepEqual(names(byId), names(served), "district by id and by name agree");
  const homeOnly = await request(q({ district: "Ernakulam", homeOnly: "1" }));
  assert.ok(!has(homeOnly, "lens") && has(homeOnly, "spice"));
  // Old city names resolve to the district.
  const kochi = await request(q({ district: "Kochi" }));
  assert.deepEqual(names(kochi), names(served));
});

test("date filter hides vendors whose whole day is blocked or full", async () => {
  const all = await request(q({ category: "Photography", district: "Ernakulam" }));
  assert.ok(has(all, "blocked") && has(all, "halfbooked") && has(all, "limited"));
  const onDate = await request(q({ category: "Photography", district: "Ernakulam", date: DATE }));
  assert.equal(onDate.status, 200);
  assert.ok(!has(onDate, "blocked"), "full-day block hides the vendor");
  assert.ok(!has(onDate, "halfbooked"), "morning and evening both booked hides the vendor");
  assert.ok(has(onDate, "limited"), "limited (1 of 2) still shows");
  assert.ok(has(onDate, "lens"), "no calendar entry still shows");
  const otherDay = await request(q({ category: "Photography", district: "Ernakulam", date: istDate(31) }));
  assert.ok(has(otherDay, "blocked"), "other dates unaffected");
});

test("budget compares like units (per plate versus per event)", async () => {
  const perPlate = await request(q({ budgetMax: "700", priceUnit: "plate" }));
  assert.deepEqual(names(perPlate), [F.spice.name], "only the per-plate caterer");
  const perEventSmall = await request(q({ budgetMax: "700", priceUnit: "event" }));
  assert.equal(perEventSmall.data.total, 0, "₹600/plate is not under ₹700 per event");
  const perEvent = await request(q({ budgetMax: "42000", priceUnit: "event" }));
  assert.ok(has(perEvent, "eventco"), "₹40,000 separate unit fits");
  assert.ok(!has(perEvent, "lens"), "₹45,000 does not");
  assert.ok(!has(perEvent, "spice"), "per-plate prices are not compared with per-event budgets");
  // A package-only unit never satisfies the budget on its own.
  const pkgOnly = await request(q({ budgetMax: "35000", priceUnit: "event", category: "Event Management" }));
  assert.ok(!has(pkgOnly, "eventco"));
  // Without priceUnit, a single category uses its default unit (catering: per plate).
  const offerings = await request(q({ view: "offerings", category: "Catering", budgetMax: "700" }));
  assert.deepEqual(offerings.data.offerings.map((o) => o.id), [F.spice.services.sadya]);
  const tooLow = await request(q({ view: "offerings", category: "Catering", budgetMax: "500" }));
  assert.equal(tooLow.data.total, 0);
});

test("guests, verified, offering and event type filters", async () => {
  assert.ok(!has(await request(q({ guests: "1000" })), "spice"), "800-guest caterer hidden for 1000 guests");
  assert.ok(has(await request(q({ guests: "500" })), "spice"));
  assert.deepEqual(names(await request(q({ verified: "1" }))), [F.lens.name]);
  const sadya = await request(q({ view: "offerings", offering: "kerala-sadhya" }));
  assert.deepEqual(sadya.data.offerings.map((o) => o.id), [F.spice.services.sadya]);
  const candidVendors = await request(q({ offering: "candid-photography" }));
  assert.deepEqual(names(candidVendors).sort(), [F.eventco.name, F.lens.name].sort());

  // An event type whose bundle has Photography but not Catering.
  const et = await db().query(
    `SELECT et.slug FROM event_types et WHERE et.active
       AND EXISTS (SELECT 1 FROM event_type_categories ec JOIN categories c ON c.id = ec.category_id
                    WHERE ec.event_type_id = et.id AND c.name = 'Photography')
       AND NOT EXISTS (SELECT 1 FROM event_type_categories ec JOIN categories c ON c.id = ec.category_id
                        WHERE ec.event_type_id = et.id AND c.name = 'Catering')
     LIMIT 1`
  );
  const nikah = await request(q({ eventType: "nikah" }));
  assert.equal(nikah.status, 200);
  assert.ok(has(nikah, "spice") && has(nikah, "lens"), "nikah needs catering and photography");
  if (et.rows[0]) {
    const r = await request(q({ eventType: et.rows[0].slug }));
    assert.ok(!has(r, "spice") && has(r, "lens"));
  }
  const unknown = await request(q({ eventType: "no-such-occasion" }));
  assert.equal(unknown.data.total, 0);
});

test("ranking is featured, then boost, then rating; paging is stable", async () => {
  const r = await request(q({ page: "1", limit: "100" }));
  const list = names(r);
  assert.equal(list[0], F.home.name, "featured first");
  assert.equal(list[1], F.limited.name, "rank boost second");
  // The rest follow the Bayesian rating: lens (4.6 x 40) ahead of spice (4.4 x 12).
  assert.ok(list.indexOf(F.lens.name) < list.indexOf(F.spice.name));
  assert.ok(r.data.vendors[0].featured === true);

  const pages = [];
  for (let p = 1; p <= 4; p++) {
    const page = await request(q({ page: String(p), limit: "2" }));
    assert.equal(page.data.total, list.length);
    assert.equal(page.data.page, p);
    assert.equal(page.data.pageSize, 2);
    pages.push(...names(page));
  }
  assert.deepEqual(pages, list, "pages concatenate to the full ordered list, no repeats or gaps");
  assert.deepEqual(names(await request(q({ page: "1", limit: "100" }))), list, "same order on repeat");

  const offerings = await request(q({ view: "offerings", limit: "3" }));
  assert.equal(offerings.data.offerings.length, 3);
  assert.equal(offerings.data.pageSize, 3);
  const next = await request(q({ view: "offerings", limit: "3", page: "2" }));
  const firstIds = offerings.data.offerings.map((o) => o.id);
  assert.ok(next.data.offerings.every((o) => !firstIds.includes(o.id)));
  const defaultSize = await request(q({ view: "offerings" }));
  assert.equal(defaultSize.data.pageSize, 20);
});

test("legacy requests keep their shape and meaning", async () => {
  const r = await request("/api/vendors?sort=priceLow");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.vendors) && typeof r.data.total === "number");
  assert.equal(r.data.vendors.length, r.data.total, "no paging without page/limit");
  const prices = r.data.vendors.map((v) => v.price);
  // Priced vendors low to high, then "Price on request" (0) last (QA-042).
  const rank = (p) => (Number(p) > 0 ? Number(p) : Infinity);
  assert.ok(prices.every((p, i) => i === 0 || rank(p) >= rank(prices[i - 1])));
  assert.ok(r.data.vendors.every((v) => !("owner_id" in v) && !("phone" in v)), "public fields only");
  // Legacy location stays home-only: the Thrissur vendor is not "in" Ernakulam.
  const loc = await request(q({ location: "Ernakulam" }));
  assert.ok(!has(loc, "lens") && has(loc, "spice"));
});

test("search page: services view, offering cards and nearby districts", async () => {
  const r = await request(`/search?${new URLSearchParams({ q: TAG, view: "offerings", category: "Photography", location: "Ernakulam" })}`);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(`${TAG} Candid coverage`), "separate unit card");
  assert.ok(!r.text.includes(`${TAG} Partner photography`), "no package-only card");
  assert.ok(r.text.includes("From ₹45,000 / event"));
  assert.ok(r.text.includes(`#offering-${F.lens.services.candid}`), "card links to the offering on the profile");

  const empty = await request(`/search?${new URLSearchParams({ q: TAG, category: "Catering", location: "Thrissur", homeOnly: "1" })}`);
  assert.equal(empty.status, 200);
  assert.ok(empty.text.includes("Try a nearby district"), "empty state suggests nearby districts");
  assert.ok(empty.text.includes("location=Ernakulam"), "links to the nearby district with results");

  // Bad values in a link are ignored on the page (not an error).
  const lenient = await request(`/search?date=2020-01-01&guests=abc&page=999&view=maps`);
  assert.equal(lenient.status, 200);
});

test("browse pages: /e and /c with unique metadata, unknown slugs not found", async () => {
  const nikah = await request("/e/nikah");
  assert.equal(nikah.status, 200);
  const bundle = await db().query(
    `SELECT c.display_name FROM event_type_categories ec JOIN event_types et ON et.id = ec.event_type_id
       JOIN categories c ON c.id = ec.category_id AND c.active WHERE et.slug = 'nikah'`
  );
  assert.ok(bundle.rows.length > 0);
  const html = nikah.text.replace(/&amp;/g, "&");
  for (const row of bundle.rows) assert.ok(html.includes(row.display_name), `nikah lists ${row.display_name}`);

  const title = (t) => t.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = (t) => t.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const pages = await Promise.all(["/e/nikah", "/e/baptism", "/c/photography", "/c/catering"].map((p) => request(p)));
  for (const p of pages) assert.equal(p.status, 200);
  const titles = pages.map((p) => title(p.text));
  const descs = pages.map((p) => desc(p.text));
  assert.equal(new Set(titles).size, 4, `unique titles: ${titles.join(" | ")}`);
  assert.equal(new Set(descs).size, 4, "unique descriptions");
  assert.ok(titles[0].includes("Nikah"));

  for (const path of ["/e/no-such-occasion", "/c/no-such-category", "/e/BAD%20slug"]) {
    const r = await request(path);
    // The root loading.tsx streams first, so Next.js may answer 200 with the
    // not-found UI and a noindex tag (same as /vendors/<missing>).
    assert.ok([200, 404].includes(r.status), `${path} status ${r.status}`);
    assert.ok(/couldn.t find that page/i.test(r.text), `${path} renders not-found`);
    assert.ok(/<meta name="robots" content="noindex/.test(r.text), `${path} is noindex`);
  }

  const sitemap = await request("/sitemap.xml");
  assert.ok(sitemap.text.includes("/e/nikah</loc>") && sitemap.text.includes("/c/photography</loc>"));
});
