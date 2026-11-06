// P1 review gaps: audit log is append-only (P1-2), taxonomy changes reach the
// wizard/filters without a deploy (P1-7), custom offering promote / reject
// (P1-8), vendor in-app notifications (/api/notifications + vendor home),
// public "Report review" and the vendor's media rejection reason.
// Run: BASE_URL=http://localhost:3154 node --env-file-if-exists=.env.local --test tests/admin-review.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_ID,
  request,
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

const P = "rvw";
const CUSTOM = `Kolkali ${RUN_ID}`;
const CUSTOM_NORM = CUSTOM.toLowerCase();
const REJECT_NAME = `Fireworks ${RUN_ID}`;

let admin, customer, vendors, catId, newCatId, tplId;
const createdTemplateIds = [];

after(async () => {
  // Offerings go with the test vendors; templates/categories this run made are removed.
  await cleanup(P);
  if (createdTemplateIds.length) {
    await db().query("UPDATE custom_offering_requests SET resolved_template_id = NULL WHERE resolved_template_id = ANY($1::int[])", [
      createdTemplateIds,
    ]);
    await db().query("UPDATE services SET template_id = NULL WHERE template_id = ANY($1::int[])", [createdTemplateIds]);
    await db().query("DELETE FROM offering_templates WHERE id = ANY($1::int[])", [createdTemplateIds]);
  }
  if (newCatId) {
    await db().query("DELETE FROM services WHERE category_id = $1", [newCatId]);
    await db().query("DELETE FROM offering_templates WHERE category_id = $1", [newCatId]);
    await db().query("DELETE FROM categories WHERE id = $1", [newCatId]);
  }
  await closeDb();
});

async function addOffering(vendorId, title, { customName = null, templateId = null, categoryId = catId } = {}) {
  const { rows } = await db().query(
    `INSERT INTO services (vendor_id, title, description, price_from, price_unit, category_id, template_id, custom_name, active)
     VALUES ($1, $2, '', 5000, 'event', $3, $4, $5, true) RETURNING id`,
    [vendorId, title, categoryId, templateId, customName]
  );
  return rows[0].id;
}

test("setup: admin, customer, three approved vendors", async () => {
  admin = await createAdmin(P, { name: "Rvw Admin" });
  customer = await makeCustomer(P, { name: "Rvw Customer" });
  vendors = [];
  for (let i = 0; i < 3; i++) {
    const v = await makeVendor(P, { name: `Rvw Vendor ${i}` });
    const l = await createListing(v.userId, { name: `Rvw Listing ${i} ${RUN_ID}`, status: "approved", category: "Traditional & Live Arts" });
    await db().query("UPDATE vendors SET published = true WHERE id = $1", [l.id]);
    vendors.push({ ...v, listing: l });
  }
  catId = vendors[0].listing.primary_category_id;
  assert.ok(catId, "category id");
});

// ---------------------------------------------------------------------------
// P1-2 audit log is append-only
// ---------------------------------------------------------------------------

test("audit rows cannot be updated, deleted or truncated (DB trigger)", async () => {
  const mark = await auditWatermark();
  const r = await request(`/api/admin/users/${customer.userId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { action: "force_logout" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await countAudit({ afterId: mark, action: "user.force_logout" }), 1);
  const { rows } = await db().query("SELECT id FROM admin_audit_log WHERE id > $1 ORDER BY id DESC LIMIT 1", [mark]);
  const id = rows[0].id;
  await assert.rejects(db().query("UPDATE admin_audit_log SET reason = 'tampered' WHERE id = $1", [id]), /append-only/);
  await assert.rejects(db().query("DELETE FROM admin_audit_log WHERE id = $1", [id]), /append-only/);
  await assert.rejects(db().query("TRUNCATE admin_audit_log"), /append-only/);
  const still = await db().query("SELECT reason FROM admin_audit_log WHERE id = $1", [id]);
  assert.equal(still.rowCount, 1);
});

// ---------------------------------------------------------------------------
// P1-7 taxonomy
// ---------------------------------------------------------------------------

test("a new template shows in the public taxonomy (wizard + filters) at once, one audit row", async () => {
  const before = await request("/api/meta/taxonomy");
  assert.equal(before.status, 200);
  const name = `Thiruvathira ${RUN_ID}`;
  assert.ok(!before.data.templates.some((t) => t.name === name));
  const mark = await auditWatermark();
  const r = await request("/api/admin/templates", {
    method: "POST",
    cookie: admin.cookie,
    body: {
      categoryId: catId,
      name,
      attributeSchema: [{ key: "troupe_size", label: "Troupe size", type: "number", filterable: true }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  tplId = r.data.template.id;
  createdTemplateIds.push(tplId);
  assert.equal(await countAudit({ afterId: mark, action: "template.create", entityId: tplId }), 1);
  const now = await request("/api/meta/taxonomy");
  assert.ok(now.data.templates.some((t) => t.id === tplId && t.name === name), "template visible without a deploy");
  // The vendor wizard (server-rendered from the same cached taxonomy) offers it too.
  const fresh = await makeVendor(P, { name: "Rvw Wizard" });
  await createListing(fresh.userId, { status: "draft", category: "Traditional & Live Arts" });
  const wiz = await request("/vendor/onboarding?step=2", { cookie: fresh.cookie });
  assert.equal(wiz.status, 200);
  assert.ok(wiz.text.includes(name), "wizard lists the new template");
});

test("renaming an attribute key in use is 409 KEY_IN_USE; relabelling is fine", async () => {
  await addOffering(vendors[0].listing.id, `Thiruvathira show ${RUN_ID}`, { templateId: tplId });
  const mark = await auditWatermark();
  const bad = await request(`/api/admin/templates/${tplId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { attributeSchema: [{ key: "group_size", label: "Troupe size", type: "number" }] },
  });
  assert.equal(bad.status, 409, JSON.stringify(bad.data));
  assert.equal(bad.data.code, "KEY_IN_USE");
  assert.equal(await countAudit({ afterId: mark }), 0, "no audit row for a refused change");
  const ok = await request(`/api/admin/templates/${tplId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { attributeSchema: [{ key: "troupe_size", label: "Dancers in the troupe", type: "number" }] },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(await countAudit({ afterId: mark, action: "template.update", entityId: tplId }), 1);
});

test("retiring a category with active offerings is 409; an empty one retires and leaves the filters", async () => {
  const busy = await request(`/api/admin/categories/${catId}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { active: false },
  });
  assert.equal(busy.status, 409, JSON.stringify(busy.data));
  assert.equal(busy.data.code, "CATEGORY_IN_USE");

  const name = `Rvw Category ${RUN_ID}`;
  const mark = await auditWatermark();
  const c = await request("/api/admin/categories", { method: "POST", cookie: admin.cookie, body: { name } });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  newCatId = c.data.category.id;
  assert.equal(await countAudit({ afterId: mark, action: "category.create" }), 1);
  // Public search filters list it straight away (DB taxonomy, no deploy).
  let s = await request("/search");
  assert.ok(s.text.includes(name), "new category is a search filter");
  const off = await request(`/api/admin/categories/${newCatId}`, { method: "PATCH", cookie: admin.cookie, body: { active: false } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(await countAudit({ afterId: mark, action: "category.retire", entityId: newCatId }), 1);
  s = await request("/search");
  assert.ok(!s.text.includes(name), "retired category leaves the filters");
});

// ---------------------------------------------------------------------------
// P1-8 custom offerings
// ---------------------------------------------------------------------------

test("promote: all 3 vendors' custom offerings re-pointed, template public, vendors notified, one audit row", async () => {
  const serviceIds = [];
  for (const v of vendors) {
    const sid = await addOffering(v.listing.id, CUSTOM, { customName: CUSTOM });
    serviceIds.push(sid);
    await db().query(
      `INSERT INTO custom_offering_requests (service_id, vendor_id, category_id, raw_name, normalised_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [sid, v.listing.id, catId, CUSTOM, CUSTOM_NORM]
    );
  }
  const q = await request("/api/admin/custom-offerings", { cookie: admin.cookie });
  assert.equal(q.status, 200);
  const group = JSON.stringify(q.data);
  assert.ok(group.includes(CUSTOM_NORM), "queue groups by normalised name");

  const mark = await auditWatermark();
  const r = await request("/api/admin/custom-offerings/resolve", {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "promote", normalisedName: CUSTOM_NORM, newTemplate: { categoryId: catId, name: CUSTOM } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const newTpl = r.data.template.id;
  createdTemplateIds.push(newTpl);
  assert.equal(r.data.affected_vendors, 3);
  assert.equal(await countAudit({ afterId: mark }), 1);
  const { rows } = await db().query("SELECT template_id, custom_name FROM services WHERE id = ANY($1::int[])", [serviceIds]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.template_id, newTpl);
    assert.equal(row.custom_name, null);
  }
  const tax = await request("/api/meta/taxonomy");
  assert.ok(tax.data.templates.some((t) => t.id === newTpl), "promoted template is a public filter option");
  for (const v of vendors) {
    const n = await request("/api/notifications", { cookie: v.cookie });
    assert.equal(n.status, 200);
    assert.ok(n.data.items.some((x) => x.kind === "offering.promoted"), "vendor notified");
  }
  const again = await request("/api/admin/custom-offerings/resolve", {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "promote", normalisedName: CUSTOM_NORM },
  });
  assert.equal(again.status, 409);
});

test("reject: reason required, offering hidden from the public profile, vendor notified", async () => {
  const v = vendors[1];
  const sid = await addOffering(v.listing.id, REJECT_NAME, { customName: REJECT_NAME });
  const { rows } = await db().query(
    `INSERT INTO custom_offering_requests (service_id, vendor_id, category_id, raw_name, normalised_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sid, v.listing.id, catId, REJECT_NAME, REJECT_NAME.toLowerCase()]
  );
  const reqId = rows[0].id;
  const pub = await request(`/vendors/${v.listing.id}`);
  assert.ok(pub.text.includes(REJECT_NAME), "visible before");

  const noReason = await request("/api/admin/custom-offerings/resolve", {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", ids: [reqId] },
  });
  assert.equal(noReason.status, 400);
  const mark = await auditWatermark();
  const r = await request("/api/admin/custom-offerings/resolve", {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", ids: [reqId], reason: "Fireworks are not allowed on Vela" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await countAudit({ afterId: mark, action: "custom_offering.reject" }), 1);
  const s = await db().query("SELECT hidden_reason FROM services WHERE id = $1", [sid]);
  assert.equal(s.rows[0].hidden_reason, "admin");
  const pub2 = await request(`/vendors/${v.listing.id}`);
  assert.ok(!pub2.text.includes(REJECT_NAME), "hidden after reject");
  const n = await request("/api/notifications", { cookie: v.cookie });
  const note = n.data.items.find((x) => x.kind === "offering.rejected");
  assert.ok(note, "vendor notified");
  assert.match(note.body, /not allowed on Vela/);
});

// ---------------------------------------------------------------------------
// Vendor notifications (vendor home + /api/notifications)
// ---------------------------------------------------------------------------

test("notifications: 401 signed out, own rows only, mark one and mark all read", async () => {
  assert.equal((await request("/api/notifications")).status, 401);
  const v = vendors[1];
  const list = await request("/api/notifications", { cookie: v.cookie });
  assert.ok(list.data.unread >= 2, JSON.stringify(list.data));
  const other = (await request("/api/notifications", { cookie: vendors[0].cookie })).data.items[0];
  // Another user's id is silently ignored.
  const cross = await request("/api/notifications", { method: "POST", cookie: v.cookie, body: { ids: [other.id] } });
  assert.equal(cross.status, 200);
  assert.equal(cross.data.marked, 0);
  const still = await db().query("SELECT read_at FROM notifications WHERE id = $1", [other.id]);
  assert.equal(still.rows[0].read_at, null);
  assert.equal((await request("/api/notifications", { method: "POST", cookie: v.cookie, body: { ids: ["x"] } })).status, 400);

  const home = await request("/vendor", { cookie: v.cookie });
  assert.equal(home.status, 200);
  assert.ok(home.text.includes("Updates from Vela"));
  assert.ok(home.text.includes(`&quot;${REJECT_NAME}&quot; was hidden`) || home.text.includes(`"${REJECT_NAME}" was hidden`));

  const one = await request("/api/notifications", { method: "POST", cookie: v.cookie, body: { ids: [list.data.items[0].id] } });
  assert.equal(one.data.marked, 1);
  const all = await request("/api/notifications", { method: "POST", cookie: v.cookie, body: { all: true } });
  assert.equal(all.status, 200);
  assert.equal((await request("/api/notifications", { cookie: v.cookie })).data.unread, 0);
});

// ---------------------------------------------------------------------------
// Public review report + vendor media reason
// ---------------------------------------------------------------------------

test("public profile: a review has a Report button; reporting puts it in the admin queue", async () => {
  const v = vendors[2];
  const { rows } = await db().query(
    "INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body) VALUES ($1,$2,'Rvw Reviewer',2,$3) RETURNING id",
    [v.listing.id, customer.userId, `Not great ${RUN_ID}`]
  );
  const reviewId = rows[0].id;
  const anon = await request(`/vendors/${v.listing.id}`);
  assert.ok(anon.text.includes("Report review"), "report button shown");
  const r = await request(`/api/reviews/${reviewId}/report`, {
    method: "POST",
    cookie: vendors[0].cookie,
    body: { reason: "Fake or not a real customer" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const q = await request("/api/admin/reviews/reports", { cookie: admin.cookie });
  assert.equal(q.status, 200);
  assert.ok(JSON.stringify(q.data).includes(`Not great ${RUN_ID}`));
});

test("vendor media manager API returns the rejection reason for a rejected photo", async () => {
  const v = vendors[2];
  const key = `vendors/${v.listing.id}/media/rvw-${RUN_ID}`;
  const variants = { thumb: { key: `${key}/thumb.webp`, w: 320, h: 240 }, card: { key: `${key}/card.webp`, w: 800, h: 600 } };
  const { rows } = await db().query(
    `INSERT INTO media_assets (vendor_id, purpose, kind, storage_driver, storage_key, variants, mime, width, height, caption, status)
     VALUES ($1, 'gallery', 'image', 'local', $2, $3::jsonb, 'image/webp', 800, 600, '', 'approved') RETURNING id`,
    [v.listing.id, key, JSON.stringify(variants)]
  );
  const id = rows[0].id;
  const r = await request(`/api/admin/media/${id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", reason: "Shows another studio's watermark" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = await request("/api/vendor/media", { cookie: v.cookie });
  assert.ok(JSON.stringify(m.data).includes("another studio's watermark"));
});
