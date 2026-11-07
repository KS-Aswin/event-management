// QA round 2 admin fixes (fix2 group "adm"):
// QA-039 (request changes on a live listing says it goes offline),
// QA-048 (renaming a category / event type to a name in use is refused),
// QA-049 (reorder categories, templates and event types from /admin/taxonomy),
// QA-050 (reinstating an account whose listing is suspended; listing
//         suspensions in the user's admin history),
// QA-051 (reset-link note label), QA-052 (admin 404 inside the admin shell).
// Run: BASE_URL=http://localhost:<port> node --env-file-if-exists=.env.local --test tests/qa2-adm.test.mjs
// Test users are qa2fix-adm-<digits>@example.com; they, their listings and the
// test categories / event types are removed in after().

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { RUN_ID, TEST_PASSWORD, request, signup, login, createListing, db, closeDb } from "./admin-helpers.mjs";

const EMAIL_RE = "^qa2fix-adm-[0-9]+@example\\.com$";
const TAG = `QA2fix adm ${RUN_ID}`;
let seq = 0;
const email = () => `qa2fix-adm-${RUN_ID}${String(++seq).padStart(3, "0")}@example.com`;

async function makeUser(role, name) {
  const s = await signup({ role, name, email: email() });
  if (!s.cookie) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.data)}`);
  return { cookie: s.cookie, userId: s.userId, email: s.email };
}

async function makeAdmin() {
  const u = await makeUser("customer", "QA2fix Admin");
  await db().query("UPDATE users SET role = 'admin' WHERE id = $1", [u.userId]);
  const l = await login(u.email, TEST_PASSWORD);
  if (!l.cookie) throw new Error("admin login failed");
  return { ...u, cookie: l.cookie };
}

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

after(async () => {
  const q = db();
  try {
    const ids = (await q.query("SELECT id FROM users WHERE email ~ $1", [EMAIL_RE])).rows.map((r) => r.id);
    if (ids.length) {
      await q.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
      await q.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    }
    await q.query("DELETE FROM event_types WHERE name LIKE $1", [`${TAG}%`]);
    const cats = (await q.query("SELECT id FROM categories WHERE name LIKE $1", [`${TAG}%`])).rows.map((r) => r.id);
    if (cats.length) {
      await q.query("DELETE FROM offering_templates WHERE category_id = ANY($1::int[])", [cats]);
      await q.query("DELETE FROM categories WHERE id = ANY($1::int[])", [cats]);
    }
  } finally {
    await closeDb();
  }
});

let admin, vendor, customer;

test("setup", async () => {
  admin = await makeAdmin();
  vendor = await makeUser("vendor", "QA2fix Vendor");
  customer = await makeUser("customer", "QA2fix Customer");
});

// ---------------------------------------------------------------------------
// QA-048
// ---------------------------------------------------------------------------

let catA, catB, evA, evB;

test("QA-048: a category can't be renamed to another category's name (any case); its own name is fine", async () => {
  const a = await request("/api/admin/categories", { method: "POST", cookie: admin.cookie, body: { displayName: `${TAG} Alpha` } });
  const b = await request("/api/admin/categories", { method: "POST", cookie: admin.cookie, body: { displayName: `${TAG} Beta` } });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(b.status, 201, JSON.stringify(b.data));
  catA = a.data.category;
  catB = b.data.category;

  const dup = await request(`/api/admin/categories/${catA.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { displayName: catB.display_name },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error, "A category with that name or slug already exists.");
  assert.equal(dup.data.code, "DUPLICATE");

  const dupCase = await request(`/api/admin/categories/${catA.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { displayName: catB.display_name.toUpperCase() },
  });
  assert.equal(dupCase.status, 409, "case-insensitive");

  // A seeded category's display name is refused too (the reported Mehendi -> Makeup case).
  const seeded = (await db().query("SELECT display_name FROM categories WHERE active AND name NOT LIKE $1 LIMIT 1", [`${TAG}%`])).rows[0];
  const dupSeed = await request(`/api/admin/categories/${catA.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { displayName: seeded.display_name },
  });
  assert.equal(dupSeed.status, 409);

  const self = await request(`/api/admin/categories/${catA.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { displayName: `${TAG} ALPHA` },
  });
  assert.equal(self.status, 200, "renaming to its own name in another case is allowed");
  const row = (await db().query("SELECT display_name FROM categories WHERE id = $1", [catA.id])).rows[0];
  assert.equal(row.display_name, `${TAG} ALPHA`);
});

test("QA-048: creating a category with a display name already in use is refused", async () => {
  const r = await request("/api/admin/categories", {
    method: "POST",
    cookie: admin.cookie,
    body: { name: `${TAG} Gamma internal`, displayName: catB.display_name },
  });
  assert.equal(r.status, 409);
});

test("QA-048: event types refuse a duplicate name on create and edit", async () => {
  const a = await request("/api/admin/event-types", { method: "POST", cookie: admin.cookie, body: { name: `${TAG} Event A` } });
  const b = await request("/api/admin/event-types", { method: "POST", cookie: admin.cookie, body: { name: `${TAG} Event B` } });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(b.status, 201, JSON.stringify(b.data));
  evA = a.data.eventType;
  evB = b.data.eventType;
  const dup = await request(`/api/admin/event-types/${evA.id}`, { method: "PATCH", cookie: admin.cookie, body: { name: evB.name.toLowerCase() } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error, "An event type with that name already exists.");
  const ok = await request(`/api/admin/event-types/${evA.id}`, { method: "PATCH", cookie: admin.cookie, body: { name: `${TAG} Event A2` } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test("QA-048: templates in one category still refuse a duplicate name", async () => {
  const t1 = await request("/api/admin/templates", { method: "POST", cookie: admin.cookie, body: { categoryId: catA.id, name: "Thing one" } });
  const t2 = await request("/api/admin/templates", { method: "POST", cookie: admin.cookie, body: { categoryId: catA.id, name: "Thing two" } });
  assert.equal(t1.status, 201, JSON.stringify(t1.data));
  assert.equal(t2.status, 201, JSON.stringify(t2.data));
  const dup = await request(`/api/admin/templates/${t2.data.template.id}`, { method: "PATCH", cookie: admin.cookie, body: { name: "thing ONE" } });
  assert.equal(dup.status, 409);
});

// ---------------------------------------------------------------------------
// QA-049
// ---------------------------------------------------------------------------

async function categoryOrder() {
  const r = await request("/api/admin/categories", { cookie: admin.cookie });
  return r.data.categories.map((c) => c.id);
}

test("QA-049: categories can be reordered; the new order shows in the admin list and /api/meta", async () => {
  const ids = await categoryOrder();
  const ia = ids.indexOf(catA.id);
  const ib = ids.indexOf(catB.id);
  assert.ok(ia >= 0 && ib >= 0);
  const next = [...ids];
  [next[ia], next[ib]] = [next[ib], next[ia]];
  const r = await request("/api/admin/taxonomy/reorder", { method: "POST", cookie: admin.cookie, body: { kind: "categories", ids: next } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = await categoryOrder();
  assert.ok(after.indexOf(catB.id) < after.indexOf(catA.id), "B now comes before A");
  // Everything else keeps its relative order.
  assert.deepEqual(
    after.filter((i) => i !== catA.id && i !== catB.id),
    ids.filter((i) => i !== catA.id && i !== catB.id)
  );
  const audit = await db().query(
    "SELECT 1 FROM admin_audit_log WHERE action = 'category.reorder' AND actor_id = $1",
    [admin.userId]
  );
  assert.equal(audit.rowCount, 1, "one audit row per reorder");

  const meta = await request("/api/meta");
  if (meta.status === 200 && Array.isArray(meta.data?.categories)) {
    // /api/meta lists the internal names (set at create, unchanged by renames).
    const names = meta.data.categories.map(String);
    const pa = names.indexOf(`${TAG} Alpha`);
    const pb = names.indexOf(`${TAG} Beta`);
    assert.ok(pa >= 0 && pb >= 0, "both test categories are in /api/meta");
    assert.ok(pb < pa, "/api/meta follows the new order");
  }
});

test("QA-049: a stale or malformed reorder is refused", async () => {
  const ids = await categoryOrder();
  const stale = await request("/api/admin/taxonomy/reorder", {
    method: "POST",
    cookie: admin.cookie,
    body: { kind: "categories", ids: ids.slice(1) },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "STALE");
  const dupIds = await request("/api/admin/taxonomy/reorder", {
    method: "POST",
    cookie: admin.cookie,
    body: { kind: "categories", ids: [ids[0], ids[0]] },
  });
  assert.equal(dupIds.status, 400);
  const badKind = await request("/api/admin/taxonomy/reorder", { method: "POST", cookie: admin.cookie, body: { kind: "users", ids: [1] } });
  assert.equal(badKind.status, 400);
  const noCat = await request("/api/admin/taxonomy/reorder", { method: "POST", cookie: admin.cookie, body: { kind: "templates", ids: [1] } });
  assert.equal(noCat.status, 400);
});

test("QA-049: templates (within a category) and event types can be reordered", async () => {
  const t = await request(`/api/admin/templates?categoryId=${catA.id}`, { cookie: admin.cookie });
  const tpl = t.data.templates.filter((x) => x.category_id === catA.id).map((x) => x.id);
  assert.equal(tpl.length, 2);
  const r = await request("/api/admin/taxonomy/reorder", {
    method: "POST",
    cookie: admin.cookie,
    body: { kind: "templates", categoryId: catA.id, ids: [...tpl].reverse() },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t2 = await request(`/api/admin/templates?categoryId=${catA.id}`, { cookie: admin.cookie });
  assert.deepEqual(
    t2.data.templates.filter((x) => x.category_id === catA.id).map((x) => x.id),
    [...tpl].reverse()
  );

  const e = await request("/api/admin/event-types", { cookie: admin.cookie });
  const ids = e.data.eventTypes.map((x) => x.id);
  const ia = ids.indexOf(evA.id);
  const ib = ids.indexOf(evB.id);
  const next = [...ids];
  [next[ia], next[ib]] = [next[ib], next[ia]];
  const r2 = await request("/api/admin/taxonomy/reorder", { method: "POST", cookie: admin.cookie, body: { kind: "event-types", ids: next } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const e2 = await request("/api/admin/event-types", { cookie: admin.cookie });
  const after = e2.data.eventTypes.map((x) => x.id);
  assert.ok(after.indexOf(evB.id) < after.indexOf(evA.id));
});

test("QA-049: only admins can reorder; the taxonomy page has move up / move down buttons", async () => {
  const r = await request("/api/admin/taxonomy/reorder", { method: "POST", cookie: customer.cookie, body: { kind: "categories", ids: [1] } });
  assert.equal(r.status, 403);
  const page = await request("/admin/taxonomy", { cookie: admin.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /aria-label="Move up: [^"]+"/);
  assert.match(page.text, /aria-label="Move down: [^"]+"/);
  assert.match(page.text, /min-h-11 min-w-11/, "44px tap targets");
});

// ---------------------------------------------------------------------------
// QA-039
// ---------------------------------------------------------------------------

test("QA-039: request changes on a live listing tells the vendor it is hidden", async () => {
  const owner = await makeUser("vendor", "QA2fix Live Vendor");
  const listing = await createListing(owner.userId, { status: "approved", name: `${TAG} Live listing` });
  const r = await request(`/api/admin/vendors/${listing.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "request_changes", reason: "Please fix the photos", expectedStatus: "approved" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.vendor.status, "changes_requested");
  const n = await db().query(
    "SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'vendor.changes_requested' ORDER BY id DESC LIMIT 1",
    [owner.userId]
  );
  assert.match(n.rows[0].payload.body, /hidden from customers until you make these changes/);
  assert.doesNotMatch(n.rows[0].payload.body, /before your listing goes live/);
});

// ---------------------------------------------------------------------------
// QA-050
// ---------------------------------------------------------------------------

test("QA-050: an owner suspended through the listing can't be reinstated alone; the listing's Unsuspend restores both", async () => {
  const listing = await createListing(vendor.userId, { status: "approved", name: `${TAG} Suspended listing` });
  const s = await request(`/api/admin/vendors/${listing.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "suspend", reason: "Fake reviews found", expectedStatus: "approved" },
  });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.ownerSuspended, true);

  const detail = await request(`/api/admin/users/${vendor.userId}`, { cookie: admin.cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.user.status, "suspended");
  assert.equal(detail.data.user.reinstate_blocked_by_listing, true);
  assert.ok(
    detail.data.user.audit.some((a) => a.action === "vendor.suspend" && a.entity_id === String(listing.id)),
    "the listing suspension is in the user's admin history"
  );

  const page = await request(`/admin/users/${vendor.userId}`, { cookie: admin.cookie });
  const text = textOf(page.text);
  assert.match(text, /The listing is suspended/);
  assert.doesNotMatch(text, /Reinstate account/);
  assert.doesNotMatch(text, /No admin actions on this account yet/);
  assert.match(page.text, new RegExp(`href="/admin/vendors/${listing.id}"`));

  const re = await request(`/api/admin/users/${vendor.userId}`, { method: "PATCH", cookie: admin.cookie, body: { action: "unsuspend" } });
  assert.equal(re.status, 409);
  assert.equal(re.data.code, "LISTING_SUSPENDED");
  const blocked = await login(vendor.email, TEST_PASSWORD);
  assert.notEqual(blocked.status, 200, "owner still can't sign in");

  const un = await request(`/api/admin/vendors/${listing.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "unsuspend", expectedStatus: "suspended" },
  });
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.equal(un.data.ownerRestored, true);
  const ok = await login(vendor.email, TEST_PASSWORD);
  assert.equal(ok.status, 200);
  const d2 = await request(`/api/admin/users/${vendor.userId}`, { cookie: admin.cookie });
  assert.equal(d2.data.user.status, "active");
  assert.equal(d2.data.user.reinstate_blocked_by_listing, false);
  assert.ok(d2.data.user.audit.some((a) => a.action === "vendor.unsuspend"));
});

test("QA-050: an account suspended from the Users page is still reinstated with its listing", async () => {
  const owner = await makeUser("vendor", "QA2fix Vendor Two");
  const listing = await createListing(owner.userId, { status: "approved", name: `${TAG} Account listing` });
  const s = await request(`/api/admin/users/${owner.userId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { action: "suspend", reason: "Abusive messages" },
  });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const d = await request(`/api/admin/users/${owner.userId}`, { cookie: admin.cookie });
  assert.equal(d.data.user.listing_status, "suspended");
  assert.equal(d.data.user.reinstate_blocked_by_listing, false);
  const page = await request(`/admin/users/${owner.userId}`, { cookie: admin.cookie });
  assert.match(textOf(page.text), /Reinstate account/);
  const re = await request(`/api/admin/users/${owner.userId}`, { method: "PATCH", cookie: admin.cookie, body: { action: "unsuspend" } });
  assert.equal(re.status, 200, JSON.stringify(re.data));
  const v = (await db().query("SELECT status FROM vendors WHERE id = $1", [listing.id])).rows[0];
  assert.equal(v.status, "approved");
});

// ---------------------------------------------------------------------------
// QA-051
// ---------------------------------------------------------------------------

test("QA-051: the reset-link note label says (optional) once", async () => {
  const page = await request(`/admin/users/${customer.userId}`, { cookie: admin.cookie });
  assert.equal(page.status, 200);
  const text = textOf(page.text);
  assert.match(text, /Create a password reset link\?/);
  assert.match(text, /Note \(optional\)/);
  assert.doesNotMatch(text, /\(optional\) \(optional\)/);
});

// ---------------------------------------------------------------------------
// QA-052
// ---------------------------------------------------------------------------

for (const p of ["/admin/vendors/2147483000", "/admin/users/2147483000", "/admin/vendors/abc", "/admin/users/0"]) {
  test(`QA-052: ${p} is a real 404 inside the admin shell`, async () => {
    const r = await request(p, { cookie: admin.cookie });
    assert.equal(r.status, 404);
    // The admin not-found UI streams in the RSC payload after the root
    // loading.tsx fallback (e2e/qa2fix-adm.spec.ts checks what a browser shows).
    assert.match(r.text, /This record doesn't exist/);
    assert.match(r.text, /Old links in the audit/);
    assert.match(r.text, /href="\/admin\/vendors"/, "admin navigation is there");
    assert.match(r.text, /href="\/admin\/users"/);
  });
}

test("QA-052: existing records still load; non-admins still get the plain 404", async () => {
  assert.equal((await request(`/admin/users/${customer.userId}`, { cookie: admin.cookie })).status, 200);
  const r = await request("/admin/users/2147483000", { cookie: customer.cookie });
  assert.equal(r.status, 404);
  assert.doesNotMatch(textOf(r.text), /This record doesn't exist/);
});
