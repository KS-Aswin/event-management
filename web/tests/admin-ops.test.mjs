// P1-4 Today, P1-9 users, P1-13 enquiries / blocked contacts, P1-2 audit viewer.
// Run: BASE_URL=http://localhost:3154 node --env-file-if-exists=.env.local --test tests/admin-ops.test.mjs
// (dev server on BASE_URL, local DB in .env.local)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_ID,
  request,
  login,
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

const P = "ops";
// A phone unique to this run (+91 9xxxxxxxxx).
const BLOCK_PHONE = `+919${String(RUN_ID).slice(-9)}`;
const BLOCK_EMAIL = `admtest-ops-blocked-${RUN_ID}@example.com`;

after(async () => {
  await db().query("DELETE FROM blocked_contacts WHERE value = ANY($1::text[])", [[BLOCK_PHONE, BLOCK_EMAIL]]);
  await db().query("DELETE FROM quote_requests WHERE phone = $1", [BLOCK_PHONE]);
  await cleanup(P);
  await closeDb();
});

let customer, vendor, listing, adminA, adminB, approvedVendorId;

test("setup: customer, vendor with an approved listing, two admins", async () => {
  customer = await makeCustomer(P, { name: "Ops Customer" });
  vendor = await makeVendor(P, { name: "Ops Vendor" });
  listing = await createListing(vendor.userId, { name: `Ops Listing ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = $1", [listing.id]);
  adminA = await createAdmin(P, { name: "Ops Admin A" });
  adminB = await createAdmin(P, { name: "Ops Admin B" });
  const { rows } = await db().query(
    "SELECT id FROM vendors WHERE status = 'approved' AND published AND owner_id IS NULL ORDER BY id LIMIT 1"
  );
  approvedVendorId = rows[0]?.id ?? listing.id;
  assert.ok(customer.cookie && vendor.cookie && adminA.cookie && adminB.cookie);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const ROUTES = () => [
  ["GET", "/api/admin/today"],
  ["GET", "/api/admin/users"],
  ["GET", `/api/admin/users/${customer.userId}`],
  ["PATCH", `/api/admin/users/${customer.userId}`, { action: "force_logout" }],
  ["GET", "/api/admin/enquiries"],
  ["GET", "/api/admin/blocked-contacts"],
  ["POST", "/api/admin/blocked-contacts", { value: BLOCK_PHONE, reason: "guard test" }],
  ["DELETE", "/api/admin/blocked-contacts/1"],
  ["GET", "/api/admin/audit"],
];

test("every ops route: 401 signed out, 403 for customer and vendor, never a write", async () => {
  const mark = await auditWatermark();
  for (const [method, path, body] of ROUTES()) {
    const anon = await request(path, { method, body });
    assert.equal(anon.status, 401, `${method} ${path} signed out`);
    for (const who of [customer, vendor]) {
      const r = await request(path, { method, body, cookie: who.cookie });
      assert.equal(r.status, 403, `${method} ${path} as non-admin`);
      assert.match(r.headers.cacheControl ?? "", /no-store/);
    }
  }
  // (Other admin test files may write audit rows in parallel, so count by entity.)
  assert.equal(await countAudit({ afterId: mark, entityType: "user", entityId: customer.userId }), 0, "no audit rows from refused calls");
  assert.equal(await countAudit({ afterId: mark, action: "contact.block" }), 0);
  const blocked = await db().query("SELECT 1 FROM blocked_contacts WHERE value = $1", [BLOCK_PHONE]);
  assert.equal(blocked.rowCount, 0);
});

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

async function dbCounts() {
  const { rows } = await db().query(`SELECT
    (SELECT count(*)::int FROM vendors WHERE status = 'pending') AS vendors_pending,
    (SELECT count(*)::int FROM vendors WHERE rereview_required) AS rereview,
    (SELECT count(*)::int FROM vendors WHERE status = 'changes_requested') AS changes_requested,
    (SELECT count(*)::int FROM review_reports WHERE status = 'open') AS review_reports,
    (SELECT count(*)::int FROM media_assets WHERE status = 'pending_review') AS media,
    (SELECT count(*)::int FROM custom_offering_requests WHERE status = 'pending') AS custom_offerings,
    (SELECT count(*)::int FROM vendor_documents WHERE status = 'pending') AS documents,
    (SELECT count(*)::int FROM quote_requests WHERE created_at > now() - interval '7 days') AS enquiries_7d,
    (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_7d,
    (SELECT count(*)::int FROM vendors WHERE status = 'approved') AS vendors_approved`);
  return rows[0];
}

test("Today: counts match the DB and every tile links to its queue", async () => {
  // Other test files may write in parallel: retry until a DB snapshot taken
  // before and after the API call agree.
  let ok = false;
  let last;
  for (let i = 0; i < 5 && !ok; i++) {
    const before = await dbCounts();
    const r = await request("/api/admin/today", { cookie: adminA.cookie });
    const afterC = await dbCounts();
    assert.equal(r.status, 200);
    last = { before, api: r.data.counts };
    if (JSON.stringify(before) !== JSON.stringify(afterC)) continue;
    ok = Object.entries(before).every(([k, v]) => r.data.counts[k] === v);
    if (ok) {
      assert.equal(r.data.tiles.length, 10);
      for (const t of r.data.tiles) {
        assert.ok(t.href.startsWith("/admin"), `${t.key} href`);
        if (t.count > 0 && t.itemLabel === "Oldest") assert.ok(t.item, `${t.key} has an oldest item`);
      }
      const pending = r.data.tiles.find((t) => t.key === "vendors_pending");
      assert.equal(pending.href, "/admin/vendors?status=pending");
    }
  }
  assert.ok(ok, `Today counts never matched the DB: ${JSON.stringify(last)}`);
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

test("users: search by email, filter by role, detail shows listing", async () => {
  const r = await request(`/api/admin/users?q=${encodeURIComponent(vendor.email)}`, { cookie: adminA.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 1);
  assert.equal(r.data.rows[0].id, vendor.userId);
  assert.equal(r.data.rows[0].listing_id, listing.id);

  const admins = await request(`/api/admin/users?role=admin&q=admtest-ops`, { cookie: adminA.cookie });
  assert.ok(admins.data.rows.every((u) => u.role === "admin"));
  assert.ok(admins.data.rows.some((u) => u.id === adminB.userId));

  const d = await request(`/api/admin/users/${vendor.userId}`, { cookie: adminA.cookie });
  assert.equal(d.status, 200);
  assert.equal(d.data.user.listing_name, listing.name);
  assert.equal(typeof d.data.user.enquiries_received, "number");

  assert.equal((await request("/api/admin/users/999999999", { cookie: adminA.cookie })).status, 404);
  assert.equal((await request("/api/admin/users/abc", { cookie: adminA.cookie })).status, 400);
});

test("users: bad action / missing reason are 400; self-action is 409 with no audit row", async () => {
  const mark = await auditWatermark();
  const path = `/api/admin/users/${customer.userId}`;
  assert.equal((await request(path, { method: "PATCH", body: { action: "delete" }, cookie: adminA.cookie })).status, 400);
  assert.equal((await request(path, { method: "PATCH", body: { action: "suspend" }, cookie: adminA.cookie })).status, 400);
  assert.equal(
    (await request(path, { method: "PATCH", body: { action: "suspend", reason: "x" }, cookie: adminA.cookie })).status,
    400
  );
  for (const action of ["suspend", "force_logout"]) {
    const self = await request(`/api/admin/users/${adminA.userId}`, {
      method: "PATCH",
      body: { action, reason: "testing self" },
      cookie: adminA.cookie,
    });
    assert.equal(self.status, 409, `self ${action}`);
    assert.equal(self.data.code, "SELF_ACTION");
  }
  assert.equal(await countAudit({ afterId: mark, actorId: adminA.userId }), 0);
});

test("suspend a vendor user: cookie and login refused, listing hidden, one audit row, notified", async () => {
  assert.equal((await request("/api/vendor/home", { cookie: vendor.cookie })).status, 200);
  assert.equal((await request(`/api/vendors/${listing.id}`)).status, 200);
  const mark = await auditWatermark();

  const r = await request(`/api/admin/users/${vendor.userId}`, {
    method: "PATCH",
    body: { action: "suspend", reason: "Fake listing reported by customers" },
    cookie: adminA.cookie,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.status, "suspended");
  assert.equal(await countAudit({ afterId: mark, actorId: adminA.userId }), 1, "exactly one audit row");
  assert.equal(await countAudit({ afterId: mark, action: "user.suspend", entityId: vendor.userId, actorId: adminA.userId }), 1);

  const v = await db().query("SELECT status FROM vendors WHERE id = $1", [listing.id]);
  assert.equal(v.rows[0].status, "suspended");
  assert.equal((await request(`/api/vendors/${listing.id}`)).status, 404, "listing hidden publicly");

  const old = await request("/api/vendor/home", { cookie: vendor.cookie });
  assert.equal(old.status, 403, "suspended cookie rejected");
  assert.equal((await login(vendor.email, vendor.password)).status, 403, "login refused");

  const n = await db().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'account.suspended'", [
    vendor.userId,
  ]);
  assert.equal(n.rows[0].n, 1);

  const again = await request(`/api/admin/users/${vendor.userId}`, {
    method: "PATCH",
    body: { action: "suspend", reason: "again" },
    cookie: adminA.cookie,
  });
  assert.equal(again.status, 409);
});

test("unsuspend restores the listing's previous status and login works", async () => {
  const mark = await auditWatermark();
  const r = await request(`/api/admin/users/${vendor.userId}`, {
    method: "PATCH",
    body: { action: "unsuspend" },
    cookie: adminA.cookie,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await countAudit({ afterId: mark, actorId: adminA.userId }), 1);
  assert.equal(await countAudit({ afterId: mark, action: "user.unsuspend", entityId: vendor.userId }), 1);
  const v = await db().query("SELECT status FROM vendors WHERE id = $1", [listing.id]);
  assert.equal(v.rows[0].status, "approved");
  assert.equal((await request(`/api/vendors/${listing.id}`)).status, 200);
  const l = await login(vendor.email, vendor.password);
  assert.equal(l.status, 200);
  vendor.cookie = l.cookie;
});

test("force logout invalidates the existing cookie (one audit row)", async () => {
  const before = await request("/api/vendor/home", { cookie: vendor.cookie });
  assert.equal(before.status, 200);
  const mark = await auditWatermark();
  const r = await request(`/api/admin/users/${vendor.userId}`, {
    method: "PATCH",
    body: { action: "force_logout", reason: "Shared password" },
    cookie: adminA.cookie,
  });
  assert.equal(r.status, 200);
  assert.equal(await countAudit({ afterId: mark, actorId: adminA.userId }), 1);
  assert.equal(await countAudit({ afterId: mark, action: "user.force_logout", entityId: vendor.userId }), 1);
  assert.equal((await request("/api/vendor/home", { cookie: vendor.cookie })).status, 401);
  const l = await login(vendor.email, vendor.password);
  assert.equal(l.status, 200, "can sign in again");
});

test("two admins suspending each other at once: one wins, the last-admin guard holds", async () => {
  const mark = await auditWatermark();
  const [ab, ba] = await Promise.all([
    request(`/api/admin/users/${adminB.userId}`, { method: "PATCH", body: { action: "suspend", reason: "race A" }, cookie: adminA.cookie }),
    request(`/api/admin/users/${adminA.userId}`, { method: "PATCH", body: { action: "suspend", reason: "race B" }, cookie: adminB.cookie }),
  ]);
  const statuses = [ab.status, ba.status].sort();
  assert.equal(statuses.filter((s) => s === 200).length, 1, `exactly one success: ${statuses}`);
  assert.ok(statuses.every((s) => s === 200 || s === 409 || s === 403), `${statuses}`);
  const raceRows =
    (await countAudit({ afterId: mark, actorId: adminA.userId })) + (await countAudit({ afterId: mark, actorId: adminB.userId }));
  assert.equal(raceRows, 1);
  const { rows } = await db().query("SELECT count(*)::int AS n FROM users WHERE id = ANY($1::int[]) AND status = 'active'", [
    [adminA.userId, adminB.userId],
  ]);
  assert.equal(rows[0].n, 1, "one of the two admins is still active");

  // The suspended admin's cookie no longer works on admin APIs.
  const loser = ab.status === 200 ? adminB : adminA;
  const winner = ab.status === 200 ? adminA : adminB;
  assert.equal((await request("/api/admin/today", { cookie: loser.cookie })).status, 403);
  // Reinstate so later tests keep two admins.
  const re = await request(`/api/admin/users/${loser.userId}`, { method: "PATCH", body: { action: "unsuspend" }, cookie: winner.cookie });
  assert.equal(re.status, 200);
  const l = await login(loser.email, loser.password);
  loser.cookie = l.cookie;
});

// ---------------------------------------------------------------------------
// Blocked contacts and enquiries
// ---------------------------------------------------------------------------

test("block a phone: 201 + one audit row, duplicate 409, enquiry gets a generic 403", async () => {
  const bad = await request("/api/admin/blocked-contacts", { method: "POST", body: { value: "12", reason: "spam" }, cookie: adminA.cookie });
  assert.equal(bad.status, 400);
  const noReason = await request("/api/admin/blocked-contacts", { method: "POST", body: { value: BLOCK_PHONE }, cookie: adminA.cookie });
  assert.equal(noReason.status, 400);

  const mark = await auditWatermark();
  const local = BLOCK_PHONE.slice(3); // 10 digits, normalised by the API
  const r = await request("/api/admin/blocked-contacts", {
    method: "POST",
    body: { value: local, reason: "Spam burst to many vendors" },
    cookie: adminA.cookie,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.contact.value, BLOCK_PHONE);
  assert.equal(await countAudit({ afterId: mark, actorId: adminA.userId }), 1);
  assert.equal(await countAudit({ afterId: mark, action: "contact.block", entityId: r.data.contact.id }), 1);

  const dup = await request("/api/admin/blocked-contacts", { method: "POST", body: { value: BLOCK_PHONE, reason: "again" }, cookie: adminA.cookie });
  assert.equal(dup.status, 409);

  const q = await request(`/api/vendors/${approvedVendorId}/quotes`, {
    method: "POST",
    body: { name: "Blocked Person", phone: local, message: "admtest blocked" },
    cookie: customer.cookie,
  });
  assert.equal(q.status, 403);
  assert.doesNotMatch(q.data.error, /block/i, "message does not reveal the block");

  const list = await request("/api/admin/blocked-contacts", { cookie: adminA.cookie });
  assert.ok(list.data.contacts.some((c) => c.value === BLOCK_PHONE));

  const um = await auditWatermark();
  const del = await request(`/api/admin/blocked-contacts/${r.data.contact.id}`, { method: "DELETE", body: {}, cookie: adminA.cookie });
  assert.equal(del.status, 200);
  assert.equal(await countAudit({ afterId: um, actorId: adminA.userId }), 1);
  assert.equal(await countAudit({ afterId: um, action: "contact.unblock" }), 1);
  assert.equal(
    (await request(`/api/admin/blocked-contacts/${r.data.contact.id}`, { method: "DELETE", body: {}, cookie: adminA.cookie })).status,
    404
  );

  const ok = await request(`/api/vendors/${approvedVendorId}/quotes`, {
    method: "POST",
    body: { name: "Unblocked Person", phone: local, message: "admtest unblocked" },
    cookie: customer.cookie,
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test("blocking a customer's email refuses their enquiries", async () => {
  const email = customer.email;
  const r = await request("/api/admin/blocked-contacts", { method: "POST", body: { value: email.toUpperCase(), reason: "Abusive" }, cookie: adminA.cookie });
  assert.equal(r.status, 201);
  try {
    const q = await request(`/api/vendors/${approvedVendorId}/quotes`, {
      method: "POST",
      body: { name: "Ops Customer", phone: "9847012399", message: "admtest" },
      cookie: customer.cookie,
    });
    assert.equal(q.status, 403);
  } finally {
    await request(`/api/admin/blocked-contacts/${r.data.contact.id}`, { method: "DELETE", body: {}, cookie: adminA.cookie });
  }
});

test("enquiry monitor: list, volume and the seeded spam burst flag", async () => {
  const r = await request("/api/admin/enquiries?range=all", { cookie: adminA.cookie });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.rows));
  assert.equal(typeof r.data.volume.d7, "number");
  assert.deepEqual(r.data.spamRule, { vendors: 10, window: "1 hour" });

  const burst = await db().query(
    `SELECT count(DISTINCT vendor_id)::int AS n FROM quote_requests
     WHERE phone = '+919800000999' AND created_at > now() - interval '30 days'`
  );
  if (burst.rows[0].n > 10) {
    assert.ok(r.data.spam.some((s) => s.phone === "+919800000999"), "seed burst flagged");
    const only = await request("/api/admin/enquiries?spam=1&range=all", { cookie: adminA.cookie });
    assert.ok(only.data.rows.length > 0);
    assert.ok(only.data.rows.every((q) => q.spam));
  }
  // An ordinary single enquiry is not spam.
  const mine = await request(`/api/admin/enquiries?range=all&q=${BLOCK_PHONE.slice(3)}`, { cookie: adminA.cookie });
  assert.ok(mine.data.rows.length >= 1);
  assert.ok(mine.data.rows.every((q) => !q.spam));
});

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

test("audit viewer: filters by action, entity and actor", async () => {
  const r = await request(`/api/admin/audit?entity=user&entityId=${vendor.userId}`, { cookie: adminA.cookie });
  assert.equal(r.status, 200);
  const actions = r.data.rows.map((a) => a.action);
  assert.ok(actions.includes("user.suspend") && actions.includes("user.unsuspend") && actions.includes("user.force_logout"));
  assert.ok(r.data.rows.every((a) => a.entity_type === "user" && a.entity_id === String(vendor.userId)));
  const s = r.data.rows.find((a) => a.action === "user.suspend");
  assert.equal(s.before.status, "active");
  assert.equal(s.after.status, "suspended");
  assert.equal(s.reason, "Fake listing reported by customers");

  const byAction = await request("/api/admin/audit?action=contact.block", { cookie: adminA.cookie });
  assert.ok(byAction.data.rows.length >= 1 && byAction.data.rows.every((a) => a.action === "contact.block"));

  const byActor = await request(`/api/admin/audit?actor=${encodeURIComponent(adminA.email)}`, { cookie: adminA.cookie });
  assert.ok(byActor.data.rows.length >= 1 && byActor.data.rows.every((a) => a.actor_id === adminA.userId));
  assert.equal(byActor.data.pageSize, 25);
});
