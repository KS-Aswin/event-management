// QA round 1, customer group fixes:
//   QA-008  an admin's category rename reaches /api/meta, the /search filter
//           list, chips and result cards (filter values stay the stable
//           internal name; slugs and display names in links also resolve).
//   QA-029  the "Send enquiry to N" sheet on /my/shortlist starts from the
//           customer's details: phone and contact preference from their latest
//           enquiry, event details from their next upcoming event.
// (QA-012, the /my/compare page overflow at 390px, is a layout bug: see
// e2e/qa1-customer.spec.ts.)
//
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3154 node --env-file-if-exists=.env.local --test tests/qa1-customer.test.mjs
//
// Test users are qa1fix-customer-<digits>@example.com; they, what they own and
// the test category are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, login, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^qa1fix-customer-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `qa1fix-customer-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
const CAT_BEFORE = `Qafix Fireworks ${RUN_ID}`;
const CAT_AFTER = `Qafix Sparklers ${RUN_ID}`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (ids.length) {
    await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
    await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
    await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  }
  await db().query("DELETE FROM categories WHERE name ~ '^Qafix (Fireworks|Sparklers) [0-9]+$'");
}

const F = {};

async function account(role, name) {
  const s = await signup({ role, name, email: email(), password: TEST_PASSWORD });
  assert.equal(s.status, 201, `signup ${role}: ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId, email: s.email };
}

/** Days from today in India as YYYY-MM-DD. */
function isoDay(offset) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** The RSC payload in a page's HTML, with the JS-string escaping undone. */
const flight = (html) => html.replace(/\\"/g, '"');

before(async () => {
  await cleanup();
  const a = await account("customer", "Qafix Admin");
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.userId]);
  const l = await login(a.email, TEST_PASSWORD);
  assert.equal(l.status, 200);
  F.admin = { ...a, cookie: l.cookie };
  F.customer = await account("customer", "Qafix Meera");
  F.fresh = await account("customer", "Qafix Fresh");
  const owner = await db().query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Qafix Owner', $1, 'x', 'vendor') RETURNING id",
    [email()]
  );
  F.ownerId = owner.rows[0].id;
  F.vendor = await createListing(F.ownerId, { name: `Qafix Caterer ${RUN_ID}`, status: "approved", category: "Catering" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [F.vendor.id]);
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// QA-008: category rename reaches customers
// ---------------------------------------------------------------------------

test("QA-008: a renamed category shows its new name in /api/meta and /search; links keep working", async () => {
  const created = await request("/api/admin/categories", {
    method: "POST",
    cookie: F.admin.cookie,
    body: { displayName: CAT_BEFORE, allowedPriceUnits: ["event"], defaultPriceUnit: "event" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const cat = (await db().query("SELECT id, name, slug FROM categories WHERE name = $1", [CAT_BEFORE])).rows[0];
  assert.ok(cat, "category row exists");

  // A listing in it, so the result card's category line is covered too.
  const owner2 = await db().query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Qafix Owner', $1, 'x', 'vendor') RETURNING id",
    [email()]
  );
  const listing = await createListing(owner2.rows[0].id, { name: `Qafix Pyro ${RUN_ID}`, status: "approved", category: CAT_BEFORE });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [listing.id]);

  const renamed = await request(`/api/admin/categories/${cat.id}`, {
    method: "PATCH",
    cookie: F.admin.cookie,
    body: { displayName: CAT_AFTER },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));

  // /api/meta: the stable value is unchanged, the label is the new name.
  const meta = await request("/api/meta");
  assert.equal(meta.status, 200);
  assert.ok(meta.data.categories.includes(CAT_BEFORE), "internal name kept as the value");
  const opt = meta.data.categoryOptions.find((o) => o.value === CAT_BEFORE);
  assert.deepEqual(opt, { value: CAT_BEFORE, slug: cat.slug, label: CAT_AFTER });

  // /search filter list: the new name, never the old one.
  const search = await request("/search");
  assert.equal(search.status, 200);
  assert.ok(search.text.includes(CAT_AFTER), "renamed category in the filter list");
  // (The internal name may still travel in the RSC payload as a filter value; it is never rendered.)
  const visible = (t) => t.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(!visible(search.text).includes(CAT_BEFORE), "old name is not shown anywhere on /search");

  // Old links (internal name), slugs and the new display name all filter by it,
  // and the chip and the result card show the new name.
  for (const value of [CAT_BEFORE, cat.slug, CAT_AFTER]) {
    const r = await request(`/search?category=${encodeURIComponent(value)}`);
    assert.equal(r.status, 200, value);
    assert.ok(r.text.includes(`Qafix Pyro ${RUN_ID}`), `listing found via ?category=${value}`);
    assert.ok(!r.text.includes(`Qafix Caterer ${RUN_ID}`), `other categories filtered out via ?category=${value}`);
    assert.ok(!visible(r.text).includes(CAT_BEFORE), `old name not rendered via ?category=${value}`);
  }
  // An unknown category is ignored, not an error.
  assert.equal((await request("/search?category=does-not-exist-xyz")).status, 200);
});

// ---------------------------------------------------------------------------
// QA-029: multi-vendor enquiry defaults
// ---------------------------------------------------------------------------

test("QA-029: the shortlist send sheet is prefilled from the customer's enquiries", async () => {
  const et = (await db().query("SELECT id FROM event_types WHERE active AND slug <> 'other' ORDER BY id LIMIT 1")).rows[0];
  const district = (await db().query("SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala'")).rows[0];
  const upcoming = isoDay(120);
  // A past event (different details) and a later one must not win over the next upcoming event.
  const rows = [
    { date: isoDay(-30), guests: 40, phone: "+919800000001", contact: "whatsapp", created: "now() - interval '3 days'" },
    { date: isoDay(200), guests: 999, phone: "+919800000002", contact: "whatsapp", created: "now() - interval '2 days'" },
    { date: upcoming, guests: 300, phone: "+919800000003", contact: "whatsapp", created: "now() - interval '1 day'" },
    // Latest enquiry: its phone and contact preference are the defaults.
    { date: isoDay(200), guests: 999, phone: "+919847012345", contact: "call", created: "now()" },
  ];
  for (const r of rows) {
    await db().query(
      `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, status, event_type_id, district_id,
                                   guest_count, budget_min, budget_max, preferred_contact, created_at)
       VALUES ($1, $2, 'Qafix Meera', $3, $4, 'pending', $5, $6, $7, 300000, 500000, $8, ${r.created})`,
      [F.vendor.id, F.customer.userId, r.phone, r.date, et.id, district.id, r.guests, r.contact]
    );
  }
  await request("/api/my/shortlist", { method: "POST", cookie: F.customer.cookie, body: { vendorId: F.vendor.id } });

  const page = await request("/my/shortlist", { cookie: F.customer.cookie });
  assert.equal(page.status, 200);
  const data = flight(page.text);
  const m = data.match(/"defaults":(\{[^{}]*\})/);
  assert.ok(m, "defaults passed to the shortlist board");
  const d = JSON.parse(m[1]);
  assert.equal(d.name, "Qafix Meera");
  assert.equal(d.phone, "+919847012345");
  assert.equal(d.preferredContact, "call");
  assert.equal(d.eventDate, upcoming, "next upcoming event, not a past or later one");
  assert.equal(d.eventTypeId, et.id);
  assert.equal(d.districtId, district.id);
  assert.equal(d.guestCount, 300);
  assert.equal(d.budgetMin, 300000);
  assert.equal(d.budgetMax, 500000);
  assert.ok(d.source, "names the occasion for the 'Filled in from' hint");

  // Sending with nothing retyped goes through (the sheet posts these values as they are).
  const sent = await request("/api/enquiries/multi", {
    method: "POST",
    cookie: F.customer.cookie,
    body: {
      vendorIds: [F.vendor.id],
      name: d.name,
      phone: d.phone,
      eventDate: d.eventDate,
      eventTypeId: d.eventTypeId,
      districtId: d.districtId,
      guestCount: d.guestCount,
      budgetMin: d.budgetMin,
      budgetMax: d.budgetMax,
      preferredContact: d.preferredContact,
      message: null,
    },
  });
  assert.ok([201, 409].includes(sent.status), `send with defaults: ${sent.status} ${JSON.stringify(sent.data)}`);
  assert.ok(Array.isArray(sent.data?.results), "per-vendor results");

  // A customer with no enquiries starts blank (apart from their name).
  const fresh = await request("/my/shortlist", { cookie: F.fresh.cookie });
  const fd = JSON.parse(flight(fresh.text).match(/"defaults":(\{[^{}]*\})/)[1]);
  assert.equal(fd.name, "Qafix Fresh");
  assert.equal(fd.phone, "");
  assert.equal(fd.eventDate, null);
  assert.equal(fd.guestCount, null);
  assert.equal(fd.preferredContact, "whatsapp");
});
