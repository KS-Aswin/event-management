// Customer area (PRODUCT_PLAN P2-1, P2-9, P2-10, /my/reviews, 2.6 landing):
// shortlist API with notes and guest merge, header counts, /my home,
// compare and reviews pages, and the multi-vendor send from the shortlist.
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3154 node --env-file-if-exists=.env.local --test tests/customer-my.test.mjs
//
// Test users are custtest-my-<digits>@example.com; they and everything they
// own (listings, enquiries, reviews, shortlist rows) are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request, signup, login, db, closeDb, createListing, RUN_ID, TEST_PASSWORD } from "./admin-helpers.mjs";

const PATTERN = "^custtest-my-[0-9]+@example\\.com$";
let seq = 0;
const email = () => `custtest-my-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;
// A phone of our own per run, so the 15-per-day cap never sees other suites' rows.
const PHONE = `+9197${String(RUN_ID).slice(-8)}`;

async function cleanup() {
  const ids = (await db().query("SELECT id FROM users WHERE email ~ $1", [PATTERN])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db().query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await db().query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

const F = {};

async function account(role, name) {
  const s = await signup({ role, name, email: email(), password: TEST_PASSWORD });
  assert.equal(s.status, 201, `signup ${role}: ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId, email: s.email };
}

before(async () => {
  await cleanup();
  F.a = await account("customer", "Custtest Asha");
  F.b = await account("customer", "Custtest Biju");
  F.vendorUser = await account("vendor", "Custtest Vendor");
  F.vendors = [];
  // One listing per account: the first belongs to the signed-in vendor, the
  // others to owner rows made straight in the DB (no sign-up rate limit).
  const owners = [F.vendorUser.userId];
  for (let i = 2; i <= 7; i++) {
    const u = await db().query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('Custtest Owner', $1, 'x', 'vendor') RETURNING id",
      [email()]
    );
    owners.push(u.rows[0].id);
  }
  for (let i = 1; i <= 6; i++) {
    const v = await createListing(owners[i - 1], {
      name: `Custtest My Photo ${RUN_ID}-${i}`,
      status: "approved",
      category: "Photography",
    });
    await db().query("UPDATE vendors SET published = true, years_experience = $2 WHERE id = $1", [v.id, i]);
    F.vendors.push(v.id);
  }
  const hidden = await createListing(owners[6], { name: `Custtest My Pending ${RUN_ID}`, status: "pending" });
  F.pending = hidden.id;
  const et = await db().query("SELECT id FROM event_types WHERE slug = 'hindu-wedding' AND active");
  F.eventTypeId = et.rows[0]?.id ?? null;
});

after(async () => {
  await cleanup();
  await closeDb();
});

// ---------------------------------------------------------------------------
// Landing and guards (2.6)
// ---------------------------------------------------------------------------

test("landing: a customer's login lands on /my; /dashboard redirects there", async () => {
  const l = await login(F.a.email);
  assert.equal(l.status, 200);
  assert.equal(l.data.redirectTo, "/my");
  const dash = await request("/dashboard", { cookie: F.a.cookie });
  assert.equal(dash.status, 307);
  assert.equal(new URL(dash.headers.location, "http://x").pathname, "/my");
});

test("guards: /my pages need a customer; vendors are sent to /vendor", async () => {
  const anon = await request("/my/shortlist");
  assert.equal(anon.status, 307);
  assert.match(anon.headers.location, /\/login\?next=%2Fmy%2Fshortlist/);
  for (const p of ["/my", "/my/shortlist", "/my/compare?ids=1,2", "/my/reviews"]) {
    const r = await request(p, { cookie: F.vendorUser.cookie });
    assert.equal(r.status, 307, p);
    assert.equal(new URL(r.headers.location, "http://x").pathname, "/vendor", p);
  }
});

// ---------------------------------------------------------------------------
// Shortlist API (P2-9)
// ---------------------------------------------------------------------------

test("shortlist API: 401 signed out, 403 for vendors", async () => {
  assert.equal((await request("/api/my/shortlist")).status, 401);
  assert.equal((await request("/api/my/shortlist", { method: "POST", body: { vendorId: F.vendors[0] } })).status, 401);
  assert.equal((await request("/api/my/shortlist", { cookie: F.vendorUser.cookie })).status, 403);
  assert.equal((await request("/api/my/nav", { cookie: F.vendorUser.cookie })).status, 403);
});

test("shortlist API: add (201, then 200), validation and hidden vendors", async () => {
  const add = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorId: F.vendors[0] } });
  assert.equal(add.status, 201);
  assert.equal(add.data.added, true);
  assert.equal(add.data.count, 1);
  const again = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorId: F.vendors[0] } });
  assert.equal(again.status, 200);
  assert.equal(again.data.added, false);

  const pending = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorId: F.pending } });
  assert.equal(pending.status, 404, "an unapproved vendor can't be saved");
  const bad = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorId: "abc" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.field, "vendorId");
  const long = await request("/api/my/shortlist", {
    method: "POST",
    cookie: F.a.cookie,
    body: { vendorId: F.vendors[1], note: "x".repeat(501) },
  });
  assert.equal(long.status, 400);
  assert.equal(long.data.field, "note");
  const notJson = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: [1, 2] });
  assert.equal(notJson.status, 400);
});

test("shortlist API: notes are private to their owner", async () => {
  const set = await request("/api/my/shortlist", {
    method: "PATCH",
    cookie: F.a.cookie,
    body: { vendorId: F.vendors[0], note: "  Asked about the Sunday rate  " },
  });
  assert.equal(set.status, 200);
  assert.equal(set.data.note, "Asked about the Sunday rate");

  const list = await request("/api/my/shortlist", { cookie: F.a.cookie });
  assert.equal(list.status, 200);
  const row = list.data.items.find((i) => i.vendorId === F.vendors[0]);
  assert.equal(row.note, "Asked about the Sunday rate");
  assert.equal(row.available, true);

  // Another customer sees nothing of it and can't edit it.
  const other = await request("/api/my/shortlist", { cookie: F.b.cookie });
  assert.equal(other.data.count, 0);
  const steal = await request("/api/my/shortlist", {
    method: "PATCH",
    cookie: F.b.cookie,
    body: { vendorId: F.vendors[0], note: "mine now" },
  });
  assert.equal(steal.status, 404);
  const stillMine = await request("/api/my/shortlist", { cookie: F.a.cookie });
  assert.equal(stillMine.data.items.find((i) => i.vendorId === F.vendors[0]).note, "Asked about the Sunday rate");

  const missingNote = await request("/api/my/shortlist", { method: "PATCH", cookie: F.a.cookie, body: { vendorId: F.vendors[0] } });
  assert.equal(missingNote.status, 400);
  const clear = await request("/api/my/shortlist", { method: "PATCH", cookie: F.a.cookie, body: { vendorId: F.vendors[0], note: "" } });
  assert.equal(clear.status, 200);
  assert.equal(clear.data.note, null);
});

test("shortlist API: delete is idempotent and scoped", async () => {
  await request("/api/my/shortlist", { method: "POST", cookie: F.b.cookie, body: { vendorId: F.vendors[5] } });
  // A deleting the same vendor doesn't touch B's row.
  const aDel = await request(`/api/my/shortlist?vendorId=${F.vendors[5]}`, { method: "DELETE", cookie: F.a.cookie });
  assert.equal(aDel.status, 200);
  assert.equal(aDel.data.removed, false);
  const bDel = await request(`/api/my/shortlist?vendorId=${F.vendors[5]}`, { method: "DELETE", cookie: F.b.cookie });
  assert.equal(bDel.data.removed, true);
  const bad = await request("/api/my/shortlist?vendorId=-3", { method: "DELETE", cookie: F.b.cookie });
  assert.equal(bad.status, 400);
});

test("shortlist API: guest localStorage merge after login", async () => {
  const merge = await request("/api/my/shortlist", {
    method: "POST",
    cookie: F.a.cookie,
    body: { vendorIds: [F.vendors[0], F.vendors[1], F.vendors[2], F.pending, 2147483000] },
  });
  assert.equal(merge.status, 200);
  assert.equal(merge.data.added, 2, "only new, public vendors are added");
  assert.equal(merge.data.count, 3);

  const tooMany = await request("/api/my/shortlist", {
    method: "POST",
    cookie: F.a.cookie,
    body: { vendorIds: Array.from({ length: 51 }, (_, i) => i + 1) },
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.data.field, "vendorIds");
  const junk = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorIds: [1, "two"] } });
  assert.equal(junk.status, 400);
  const empty = await request("/api/my/shortlist", { method: "POST", cookie: F.a.cookie, body: { vendorIds: [] } });
  assert.equal(empty.status, 400);
});

// ---------------------------------------------------------------------------
// Send to selected (P2-9 over POST /api/enquiries/multi), nav counts, /my
// ---------------------------------------------------------------------------

const eventDate = () => new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);

test("send to selected: 6 vendors is 400; a batch with a hidden vendor is a partial success", async () => {
  const base = { name: "Custtest Asha", phone: PHONE, eventDate: eventDate(), eventTypeId: F.eventTypeId, message: "From my shortlist" };
  const six = await request("/api/enquiries/multi", {
    method: "POST",
    cookie: F.a.cookie,
    body: { ...base, vendorIds: F.vendors.slice(0, 6) },
  });
  assert.equal(six.status, 400);
  assert.equal(six.data.field, "vendorIds");

  const send = await request("/api/enquiries/multi", {
    method: "POST",
    cookie: F.a.cookie,
    body: { ...base, vendorIds: [F.vendors[0], F.vendors[1], F.pending] },
  });
  assert.equal(send.status, 201, JSON.stringify(send.data));
  assert.equal(send.data.sent, 2);
  assert.equal(send.data.failed, 1);
  F.enquiryIds = send.data.results.filter((r) => r.ok).map((r) => r.enquiryId);
  assert.equal(F.enquiryIds.length, 2);
});

test("nav counts: unread vendor replies and shortlist size, per customer", async () => {
  const before = await request("/api/my/nav", { cookie: F.a.cookie });
  assert.equal(before.status, 200);
  assert.equal(before.data.shortlist, 3);
  const start = before.data.enquiries;

  const msg = await request(`/api/vendor/leads/${F.enquiryIds[0]}/messages`, {
    method: "POST",
    cookie: F.vendorUser.cookie,
    body: { body: "Thanks! We're free that day." },
  });
  assert.ok([200, 201].includes(msg.status), JSON.stringify(msg.data));
  const after = await request("/api/my/nav", { cookie: F.a.cookie });
  assert.equal(after.data.enquiries, start + 1);

  const other = await request("/api/my/nav", { cookie: F.b.cookie });
  assert.deepEqual(other.data, { enquiries: 0, shortlist: 0 });
});

test("/my home: next event, still-needed categories, waiting replies, shortlist; no vendor CTAs", async () => {
  const r = await request("/my", { cookie: F.a.cookie });
  assert.equal(r.status, 200);
  assert.match(r.text, /Next event/);
  assert.match(r.text, /Still needed/);
  assert.match(r.text, /Catering/, "a Hindu wedding still needs catering");
  assert.match(r.text, /Waiting for you/);
  assert.match(r.text, new RegExp(`Custtest My Photo ${RUN_ID}-1`));
  assert.doesNotMatch(r.text, /List your business/);

  // A brand-new customer gets the discovery empty state.
  const empty = await request("/my", { cookie: F.b.cookie });
  assert.equal(empty.status, 200);
  assert.match(empty.text, /What are you planning\?/);
  assert.match(empty.text, /href="\/e\/hindu-wedding"/);
});

// ---------------------------------------------------------------------------
// Compare (P2-10) and reviews
// ---------------------------------------------------------------------------

test("compare: 2-4 vendors side by side; other counts get a helpful message", async () => {
  const ok = await request(`/my/compare?ids=${F.vendors[0]},${F.vendors[1]},${F.vendors[2]}`, { cookie: F.a.cookie });
  assert.equal(ok.status, 200);
  for (const i of [1, 2, 3]) assert.match(ok.text, new RegExp(`Custtest My Photo ${RUN_ID}-${i}`));
  assert.match(ok.text, /Usually replies/);
  assert.match(ok.text, /Experience/);
  assert.match(ok.text, /3 years/);

  const one = await request(`/my/compare?ids=${F.vendors[0]}`, { cookie: F.a.cookie });
  assert.match(one.text, /Choose at least 2 vendors/);
  const five = await request(`/my/compare?ids=${F.vendors.slice(0, 5).join(",")}`, { cookie: F.a.cookie });
  assert.match(five.text, /up to 4 vendors/);
  const hidden = await request(`/my/compare?ids=${F.vendors[0]},${F.pending}`, { cookie: F.a.cookie });
  assert.match(hidden.text, /Not enough vendors to compare/);
  assert.doesNotMatch(hidden.text, /Custtest My Pending/);
});

test("reviews: past booked enquiries prompt a review until one is written", async () => {
  await db().query(
    "UPDATE quote_requests SET status = 'booked', event_date = CURRENT_DATE - 3 WHERE id = $1 AND customer_id = $2",
    [F.enquiryIds[0], F.a.userId]
  );
  const page = await request("/my/reviews", { cookie: F.a.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Write a review/);
  assert.match(page.text, new RegExp(`Custtest My Photo ${RUN_ID}-1`));

  await db().query(
    `INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body, customer_id, verified, quote_request_id)
     VALUES ($1, 'Custtest Asha', 5, 'Lovely photos, on time.', $2, true, $3)`,
    [F.vendors[0], F.a.userId, F.enquiryIds[0]]
  );
  const afterReview = await request("/my/reviews", { cookie: F.a.cookie });
  assert.match(afterReview.text, /Lovely photos, on time\./);
  assert.match(afterReview.text, /Verified booking/);
  assert.doesNotMatch(afterReview.text, /Write a review/);
});
