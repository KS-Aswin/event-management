// QA2 fix round, customer-facing display: QA-035 (category display names
// everywhere), QA-036 (shortlist / compare use the one "from" price),
// QA-042 ("Price: low to high" puts price-on-request last), QA-043 (contact
// details masked in About, specialities, captions and album titles).
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3153 node --env-file-if-exists=.env.local --test tests/qa2-disp.test.mjs
//
// Test users are qa2fix-disp-<digits>@example.com; they, their listings,
// enquiries, media and the test category are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, login, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^qa2fix-disp-[0-9]+@example\\.com$";
const CAT_NAME = `Qa2fixdisp${RUN_ID}`;
const CAT_LABEL = `Qa2 Disp Shown ${RUN_ID}`;
const PHONE = "9847012345";
let seq = 0;
const email = () => `qa2fix-disp-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (ids.length) {
    const vendorIds = (await db().query("SELECT id FROM vendors WHERE owner_id = ANY($1::int[])", [ids])).rows.map((r) => r.id);
    await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[]) OR vendor_id = ANY($2::int[])", [ids, vendorIds]);
    await db().query("DELETE FROM favorites WHERE customer_id = ANY($1::int[]) OR vendor_id = ANY($2::int[])", [ids, vendorIds]);
    await db().query("DELETE FROM media_assets WHERE vendor_id = ANY($1::int[])", [vendorIds]);
    await db().query("DELETE FROM media_albums WHERE vendor_id = ANY($1::int[])", [vendorIds]);
    await db().query("DELETE FROM services WHERE vendor_id = ANY($1::int[])", [vendorIds]);
    await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  }
  const cats = (await db().query("SELECT id FROM categories WHERE name ~ '^Qa2fixdisp[0-9]+$'")).rows.map((r) => r.id);
  if (cats.length) {
    await db().query("DELETE FROM event_type_categories WHERE category_id = ANY($1::int[])", [cats]);
    await db().query("DELETE FROM admin_audit_log WHERE target_type = 'category' AND target_id = ANY($1::text[])", [cats.map(String)]).catch(() => {});
    await db().query("DELETE FROM categories WHERE id = ANY($1::int[])", [cats]);
  }
  if (ids.length) {
    await db().query("DELETE FROM admin_audit_log WHERE actor_id = ANY($1::int[])", [ids]).catch(() => {});
    await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  }
}

/** Plain text of an HTML page (scripts and tags stripped). */
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

const owner = async () =>
  (await db().query("INSERT INTO users (name, email, password_hash, role) VALUES ('Qa2fix Owner', $1, 'x', 'vendor') RETURNING id", [email()]))
    .rows[0].id;

async function publicListing(name, category, extra = {}) {
  const v = await createListing(await owner(), { name, category, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [v.id]);
  if (extra.price !== undefined) {
    await db().query("UPDATE vendors SET price = $2, price_label = $3 WHERE id = $1", [v.id, extra.price, extra.priceLabel]);
  }
  return v.id;
}

async function signedIn(role, name) {
  const s = await signup({ role, name, email: email(), password: TEST_PASSWORD });
  assert.equal(s.status, 201, `${role} signup: ${JSON.stringify(s.data)}`);
  return s;
}

const F = {};

before(async () => {
  await cleanup();
  const a = await signedIn("customer", "Qa2fix Admin");
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.userId]);
  F.admin = (await login(a.email, a.password)).cookie;
  assert.ok(F.admin, "admin login");
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-035: the admin display name everywhere a category is shown
// ---------------------------------------------------------------------------

test("QA-035: a category whose display name differs from its internal name shows the display name", async () => {
  const c = await request("/api/admin/categories", {
    method: "POST",
    cookie: F.admin,
    body: { name: CAT_NAME, displayName: CAT_LABEL, slug: `qa2fixdisp-${RUN_ID}` },
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  F.catId = c.data.category.id;
  F.catVendor = await publicListing(`Qa2fix Disp Cat Vendor ${RUN_ID}`, CAT_NAME);

  // Home: the "Browse by category" chip.
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.ok(home.text.includes(`category=${encodeURIComponent(CAT_NAME)}`), "chip links with the internal name");
  const homeText = textOf(home.text);
  assert.ok(homeText.includes(CAT_LABEL), "home chip shows the display name");
  assert.ok(!homeText.includes(CAT_NAME), "home never shows the internal name");

  // Vendor profile header and <title>.
  const profile = await request(`/vendors/${F.catVendor}`);
  assert.equal(profile.status, 200);
  const pText = textOf(profile.text);
  assert.ok(pText.includes(`${CAT_LABEL} · `), "profile header shows the display name");
  assert.ok(!pText.includes(CAT_NAME), "profile never shows the internal name");

  // Home search suggestions: value = internal name, label = display name.
  const s = await request(`/api/suggest?q=${encodeURIComponent(CAT_LABEL)}`);
  assert.equal(s.status, 200);
  assert.ok(s.data.categories.includes(CAT_NAME), "suggestion value stays the internal name");
  assert.equal(s.data.categoryLabels?.[CAT_NAME], CAT_LABEL, "suggestion label is the display name");
});

test("QA-035: /my 'Still needed' shows the display name", async () => {
  assert.ok(F.catId, "previous test created the category");
  const et = (await db().query("SELECT id FROM event_types WHERE active AND slug <> 'other' ORDER BY sort_order, id LIMIT 1")).rows[0];
  assert.ok(et, "an active event type exists");
  await db().query("INSERT INTO event_type_categories (event_type_id, category_id, is_core, sort_order) VALUES ($1, $2, true, 0)", [et.id, F.catId]);
  // Any taxonomy edit refreshes the cached taxonomy (bundle included).
  const p = await request(`/api/admin/categories/${F.catId}`, { method: "PATCH", cookie: F.admin, body: { description: "Qa2fix test category." } });
  assert.equal(p.status, 200, JSON.stringify(p.data));

  const cust = await signedIn("customer", "Qa2fix Customer");
  const other = await publicListing(`Qa2fix Disp Other ${RUN_ID}`, "Photography");
  await db().query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, event_type_id, status, message)
     VALUES ($1, $2, 'Qa2fix Customer', '+919800000000', (now() AT TIME ZONE 'Asia/Kolkata')::date + 60, $3, 'pending', 'Qa2fix test enquiry')`,
    [other, cust.userId, et.id]
  );
  const my = await request("/my", { cookie: cust.cookie });
  assert.equal(my.status, 200);
  const list = my.text.match(/aria-label="Still needed"[\s\S]*?<\/ul>/)?.[0] ?? "";
  assert.ok(list, "Still needed list rendered");
  const t = textOf(list);
  assert.ok(t.includes(CAT_LABEL), `Still needed shows the display name (${t.slice(0, 200)})`);
  assert.ok(!t.includes(CAT_NAME), "Still needed never shows the internal name");
  assert.ok(list.includes(`category=${encodeURIComponent(CAT_NAME)}`), "the chip still searches by the internal name");
});

// ---------------------------------------------------------------------------
// QA-036: shortlist and compare show the vendor's one "from" price
// ---------------------------------------------------------------------------

test("QA-036: shortlist and compare use vendors.price_label, same as search and the profile", async () => {
  const vendor = await signedIn("vendor", "Qa2fix Venue Owner");
  const venue = await createListing(vendor.userId, { name: `Qa2fix Disp Venue ${RUN_ID}`, category: "Venue", status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [venue.id]);
  const tax = (await request("/api/meta/taxonomy")).data;
  const cat = (slug) => tax.categories.find((c) => c.slug === slug);
  const unitTpl = (slug) => tax.templates.find((t) => t.kind === "unit" && t.category_id === cat(slug)?.id);
  const add = async (tpl, priceFrom, priceUnit) => {
    const r = await request("/api/vendor/offerings", {
      method: "POST",
      cookie: vendor.cookie,
      body: { templateId: tpl.id, priceMode: "from", priceFrom, priceUnit, saleMode: "separate" },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  };
  // A cheap per-plate add-on in another category must not become the from-price.
  await add(unitTpl("catering"), 600, "plate");
  const venueTpl = unitTpl("venue");
  await add(venueTpl, 150000, venueTpl.default_price_unit ?? "slot");
  const label = (await db().query("SELECT price_label FROM vendors WHERE id = $1", [venue.id])).rows[0].price_label;
  assert.match(label, /^₹1,50,000 /);

  // A second vendor with no priced offering: "Price on request".
  const onRequest = await publicListing(`Qa2fix Disp OnRequest ${RUN_ID}`, "Photography");

  const cust = await signedIn("customer", "Qa2fix Shopper");
  for (const id of [venue.id, onRequest]) {
    const r = await request("/api/my/shortlist", { method: "POST", cookie: cust.cookie, body: { vendorId: id } });
    assert.ok([200, 201].includes(r.status), `shortlist add ${id}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  const api = await request("/api/my/shortlist", { cookie: cust.cookie });
  assert.equal(api.status, 200);
  const items = api.data.items ?? api.data.shortlist ?? [];
  const v = items.find((i) => i.vendorId === venue.id);
  const r = items.find((i) => i.vendorId === onRequest);
  assert.equal(v?.priceLabel, label, "shortlist API carries the shared label");
  assert.equal(v?.fromPrice, 150000);
  assert.equal(r?.priceLabel, null);
  assert.equal(r?.fromPrice, null);

  const board = textOf((await request("/my/shortlist", { cookie: cust.cookie })).text);
  assert.ok(board.includes(label), "/my/shortlist shows the same price as search");
  assert.ok(!board.includes("₹600"), "/my/shortlist doesn't show the catering add-on");

  const home = textOf((await request("/my", { cookie: cust.cookie })).text);
  assert.ok(home.includes(label), "/my shortlist preview shows the same price");

  const compare = textOf((await request(`/my/compare?ids=${venue.id},${onRequest}`, { cookie: cust.cookie })).text);
  assert.ok(compare.includes(label), "/my/compare shows the same price");
  assert.ok(compare.includes("Price on request"), "/my/compare says 'Price on request' like search");
  assert.ok(!compare.includes("₹600"), "/my/compare doesn't show the catering add-on");

  const search = textOf((await request(`/search?q=${encodeURIComponent(`Qa2fix Disp Venue ${RUN_ID}`)}`)).text);
  assert.ok(search.includes(label), "search shows that same price");
});

// ---------------------------------------------------------------------------
// QA-042: price-on-request sorts last
// ---------------------------------------------------------------------------

test("QA-042: 'Price: low to high' and 'high to low' list price-on-request vendors last", async () => {
  const cat = "Photography";
  const tag = `Qa2fixsort${RUN_ID}`;
  const free = await publicListing(`${tag} Onrequest`, cat);
  const cheap = await publicListing(`${tag} Cheap`, cat, { price: 5000, priceLabel: "₹5,000 per hour" });
  const dear = await publicListing(`${tag} Dear`, cat, { price: 90000, priceLabel: "₹90,000 onwards" });

  const order = async (sort) => {
    const r = await request(`/api/search?q=${encodeURIComponent(tag)}&sort=${sort}`);
    if (r.status === 200 && Array.isArray(r.data?.vendors)) return r.data.vendors.map((v) => v.id);
    // Fall back to the page when there is no JSON search route.
    const html = (await request(`/search?q=${encodeURIComponent(tag)}&sort=${sort}`)).text;
    return [...html.matchAll(/href="\/vendors\/(\d+)"/g)].map((m) => Number(m[1])).filter((id, i, a) => a.indexOf(id) === i);
  };
  const low = (await order("priceLow")).filter((id) => [free, cheap, dear].includes(id));
  assert.deepEqual(low, [cheap, dear, free], "low to high: priced vendors first, price on request last");
  const high = (await order("priceHigh")).filter((id) => [free, cheap, dear].includes(id));
  assert.deepEqual(high, [dear, cheap, free], "high to low: price on request still last");

  const legacy = await request(`/api/vendors?q=${encodeURIComponent(tag)}&sort=priceLow`);
  if (legacy.status === 200 && Array.isArray(legacy.data?.vendors)) {
    const ids = legacy.data.vendors.map((v) => v.id).filter((id) => [free, cheap, dear].includes(id));
    assert.deepEqual(ids, [cheap, dear, free], "legacy /api/vendors sort agrees");
  }
});

// ---------------------------------------------------------------------------
// QA-043: contact details masked in every vendor-typed text on the profile
// ---------------------------------------------------------------------------

test("QA-043: About, specialities, captions and album titles are masked on the public profile", async () => {
  const id = await publicListing(`Qa2fix Disp Mask ${RUN_ID}`, "Photography");
  // Raw contact details written straight to the DB (older rows, other write paths).
  await db().query("UPDATE vendors SET about = $2, tags = $3 WHERE id = $1", [
    id,
    `Candid wedding photography. WhatsApp ${PHONE} or mail qa2fix@example.com or visit www.qa2fix-studio.com.`,
    [`call ${PHONE}`, "Candid"],
  ]);
  const album = await db().query(
    "INSERT INTO media_albums (vendor_id, title, description, published) VALUES ($1, $2, $3, true) RETURNING id",
    [id, `Call ${PHONE} now`, `Book at ${PHONE}`]
  );
  await db().query(
    `INSERT INTO media_assets (vendor_id, kind, purpose, status, storage_driver, external_url, external_provider, caption, alt_text, album_id)
     VALUES ($1, 'video_link', 'gallery', 'approved', 'url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', $2, $3, $4)`,
    [id, `Highlights, call ${PHONE}`, `Wedding film ${PHONE}`, album.rows[0].id]
  );

  const page = await request(`/vendors/${id}`);
  assert.equal(page.status, 200);
  assert.ok(textOf(page.text).includes("Candid wedding photography."), "About is shown");
  assert.ok(!page.text.includes(PHONE), "the phone number appears nowhere in the page (text, alt, aria, data)");
  assert.ok(!page.text.includes("qa2fix@example.com"), "no email");
  assert.ok(!page.text.includes("qa2fix-studio.com"), "no link");
  assert.ok(textOf(page.text).includes("•••"), "masked text is shown instead");

  const search = await request(`/search?q=${encodeURIComponent(`Qa2fix Disp Mask ${RUN_ID}`)}`);
  assert.ok(!search.text.includes(PHONE), "search card specialities are masked");

  const api = await request(`/api/vendors/${id}`);
  assert.equal(api.status, 200);
  assert.ok(!JSON.stringify(api.data.vendor).includes(PHONE), "public vendor API masks About and tags");
});

test("QA-043: the vendor APIs mask contact details on save (profile, albums, captions)", async () => {
  const vendor = await signedIn("vendor", "Qa2fix Mask Owner");
  const v = await createListing(vendor.userId, { name: `Qa2fix Disp Save ${RUN_ID}`, category: "Photography", status: "approved" });

  const p = await request("/api/vendor/profile", {
    method: "PATCH",
    cookie: vendor.cookie,
    body: { about: `Candid wedding photography across Kerala. WhatsApp ${PHONE} or visit www.example.com.`, tags: [`call ${PHONE}`] },
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const row = (await db().query("SELECT about, tags FROM vendors WHERE id = $1", [v.id])).rows[0];
  assert.ok(!row.about.includes(PHONE) && !row.about.includes("www.example.com"), `About saved masked (${row.about})`);
  assert.ok(row.about.startsWith("Candid wedding photography across Kerala."), "the rest of About is kept");
  assert.ok(!row.tags.join(" ").includes(PHONE), "specialities saved masked");

  const a = await request("/api/vendor/albums", { method: "POST", cookie: vendor.cookie, body: { title: `Call ${PHONE} now` } });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.ok(!JSON.stringify(a.data.album).includes(PHONE), "album title saved masked");

  const asset = await db().query(
    `INSERT INTO media_assets (vendor_id, kind, purpose, status, storage_driver, external_url, external_provider)
     VALUES ($1, 'video_link', 'gallery', 'approved', 'url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube') RETURNING id`,
    [v.id]
  );
  const m = await request(`/api/vendor/media/${asset.rows[0].id}`, {
    method: "PATCH",
    cookie: vendor.cookie,
    body: { caption: `Highlights, call ${PHONE}`, altText: `Film ${PHONE}` },
  });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  const saved = (await db().query("SELECT caption, alt_text FROM media_assets WHERE id = $1", [asset.rows[0].id])).rows[0];
  assert.ok(!saved.caption.includes(PHONE) && saved.caption.startsWith("Highlights, call"), `caption saved masked (${saved.caption})`);
  assert.ok(!saved.alt_text.includes(PHONE), "alt text saved masked");
});
