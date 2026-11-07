// P1-10 vendor documents and verification (PRODUCT_PLAN section P1).
// Run: BASE_URL=http://localhost:<port> node --env-file-if-exists=.env.local --test tests/admin-documents.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import {
  WEB_DIR,
  BASE_URL,
  TEST_IP,
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

const P = "documents";
const UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(WEB_DIR, "uploads"));
const listingIds = [];

after(async () => {
  for (const id of listingIds) rmSync(path.join(UPLOADS, "private", "vendor-docs", String(id)), { recursive: true, force: true });
  await cleanup(P);
  await closeDb();
});

const PDF = Buffer.from(`%PDF-1.4\n% admtest ${RUN_ID}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

/** Multipart upload to /api/vendor/documents. */
async function upload(cookie, { file = PDF, name = "doc.pdf", type = "application/pdf", fields = {} } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ docType: "gst", ...fields })) if (v !== undefined) fd.set(k, v);
  if (file) fd.set("file", new Blob([file], { type }), name);
  const res = await fetch(`${BASE_URL}/api/vendor/documents`, {
    method: "POST",
    headers: { Cookie: cookie, "X-Forwarded-For": TEST_IP },
    body: fd,
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, data };
}

async function rawGet(urlPath, cookie) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    headers: { ...(cookie ? { Cookie: cookie } : {}), "X-Forwarded-For": TEST_IP },
    redirect: "manual",
  });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

async function docRow(id) {
  return (await db().query("SELECT * FROM vendor_documents WHERE id = $1", [id])).rows[0];
}

let vendorA, vendorB, customer, admin, listingA, listingB;
let pdfDoc, pngDoc, extraDoc;

test("setup: accounts and listings", async () => {
  vendorA = await makeVendor(P);
  vendorB = await makeVendor(P);
  customer = await makeCustomer(P);
  admin = await createAdmin(P);
  listingA = await createListing(vendorA.userId, { name: `Doctest A ${RUN_ID}`, status: "approved" });
  listingB = await createListing(vendorB.userId, { name: `Doctest B ${RUN_ID}`, status: "approved" });
  await db().query("UPDATE vendors SET published = true WHERE id = ANY($1::int[])", [[listingA.id, listingB.id]]);
  listingIds.push(listingA.id, listingB.id);
});

test("vendor uploads a PDF and a PNG; stored privately as pending", async () => {
  const r = await upload(vendorA.cookie, { fields: { docType: "fssai", number: " 1234 5678 9012 34 ", expiresAt: "2030-12-31" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  pdfDoc = r.data.document;
  assert.equal(pdfDoc.status, "pending");
  assert.equal(pdfDoc.docType, "fssai");
  assert.equal(pdfDoc.number, "1234 5678 9012 34");
  assert.equal(pdfDoc.expiresAt, "2030-12-31");
  assert.equal(pdfDoc.storage_key, undefined, "storage key is never exposed");
  const row = await docRow(pdfDoc.id);
  assert.equal(row.vendor_id, listingA.id);
  assert.match(row.storage_key, new RegExp(`^private/vendor-docs/${listingA.id}/`));
  assert.equal(row.mime, "application/pdf");
  assert.ok(existsSync(path.join(UPLOADS, ...row.storage_key.split("/"))));

  const p = await upload(vendorA.cookie, { file: PNG, name: "pan.png", type: "image/png", fields: { docType: "pan" } });
  assert.equal(p.status, 201);
  pngDoc = p.data.document;
  assert.equal(pngDoc.mime, "image/png");

  const e = await upload(vendorA.cookie, { fields: { docType: "trade_licence" } });
  assert.equal(e.status, 201);
  extraDoc = e.data.document;

  const list = await request("/api/vendor/documents", { cookie: vendorA.cookie });
  assert.equal(list.status, 200);
  assert.deepEqual(new Set(list.data.documents.map((d) => d.id)), new Set([pdfDoc.id, pngDoc.id, extraDoc.id]));
});

test("upload validation: magic bytes, type, size, expiry", async () => {
  const fake = await upload(vendorA.cookie, { file: Buffer.from("just text pretending"), name: "x.pdf", type: "application/pdf" });
  assert.equal(fake.status, 415);
  const html = await upload(vendorA.cookie, { file: Buffer.from("<html><script>1</script>"), name: "x.png", type: "image/png" });
  assert.equal(html.status, 415);
  const badType = await upload(vendorA.cookie, { fields: { docType: "passport" } });
  assert.equal(badType.status, 400);
  const badDate = await upload(vendorA.cookie, { fields: { expiresAt: "2030-02-30" } });
  assert.equal(badDate.status, 400);
  const noFile = await upload(vendorA.cookie, { file: null });
  assert.equal(noFile.status, 400);
  const big = await upload(vendorA.cookie, { file: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) });
  assert.equal(big.status, 413);
  const asCustomer = await upload(customer.cookie);
  assert.equal(asCustomer.status, 403);
  const signedOut = await fetch(`${BASE_URL}/api/vendor/documents`, { headers: { "X-Forwarded-For": TEST_IP } });
  assert.equal(signedOut.status, 401);
});

test("another vendor cannot see or delete the documents", async () => {
  const list = await request("/api/vendor/documents", { cookie: vendorB.cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.documents.length, 0);
  const del = await request(`/api/vendor/documents/${pdfDoc.id}`, { method: "DELETE", cookie: vendorB.cookie });
  assert.equal(del.status, 404);
  assert.ok(await docRow(pdfDoc.id), "row still there");
});

test("a document path via /media is 404 for everyone, including admins", async () => {
  const row = await docRow(pdfDoc.id);
  for (const cookie of [undefined, vendorA.cookie, admin.cookie]) {
    const r = await rawGet(`/media/${row.storage_key}`, cookie);
    assert.equal(r.status, 404);
  }
});

test("file route: 401 signed out, 403 non-admin, admin gets the bytes inline and uncached", async () => {
  const url = `/api/admin/documents/${pdfDoc.id}/file`;
  assert.equal((await rawGet(url)).status, 401);
  assert.equal((await rawGet(url, vendorA.cookie)).status, 403);
  assert.equal((await rawGet(url, customer.cookie)).status, 403);
  const ok = await rawGet(url, admin.cookie);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.equals(PDF));
  assert.equal(ok.headers.get("content-type"), "application/pdf");
  assert.match(ok.headers.get("content-disposition") ?? "", /^inline;/);
  assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await rawGet("/api/admin/documents/999999999/file", admin.cookie)).status, 404);
});

test("admin queue lists pending documents and filters by vendor", async () => {
  assert.equal((await request("/api/admin/documents", { cookie: vendorA.cookie })).status, 403);
  const r = await request(`/api/admin/documents?tab=pending&vendor=${listingA.id}`, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(r.data.items.map((d) => d.id)), new Set([pdfDoc.id, pngDoc.id, extraDoc.id]));
  assert.equal(r.data.counts.pending, 3);
  assert.equal(r.data.items[0].vendor.id, listingA.id);
  const other = await request(`/api/admin/documents?tab=pending&vendor=${listingB.id}`, { cookie: admin.cookie });
  assert.equal(other.data.items.length, 0);
});

test("reject requires a reason and writes no audit row without one", async () => {
  const mark = await auditWatermark();
  for (const reason of [undefined, "", "  x "]) {
    const r = await request(`/api/admin/documents/${pngDoc.id}/decision`, {
      method: "POST",
      cookie: admin.cookie,
      body: { action: "reject", reason },
    });
    assert.equal(r.status, 400);
    assert.equal(r.data.field, "reason");
  }
  assert.equal(await countAudit({ entityType: "vendor_document", afterId: mark }), 0);
  assert.equal((await docRow(pngDoc.id)).status, "pending");

  const ok = await request(`/api/admin/documents/${pngDoc.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "reject", reason: "Name doesn't match the business" },
  });
  assert.equal(ok.status, 200);
  assert.equal(await countAudit({ action: "document.reject", entityId: pngDoc.id, afterId: mark }), 1);
  const list = await request("/api/vendor/documents", { cookie: vendorA.cookie });
  const d = list.data.documents.find((x) => x.id === pngDoc.id);
  assert.equal(d.status, "rejected");
  assert.equal(d.reason, "Name doesn't match the business");
  const n = await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'document.rejected'", [vendorA.userId]);
  assert.equal(n.rowCount, 1);
});

test("verify is audited exactly once, notifies the vendor, and a repeat is 409", async () => {
  const mark = await auditWatermark();
  const r = await request(`/api/admin/documents/${pdfDoc.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "verify", expiresAt: "2031-03-31" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "verified");
  const row = await docRow(pdfDoc.id);
  assert.equal(row.status, "verified");
  assert.equal(row.reviewed_by, admin.userId);
  assert.equal(await countAudit({ action: "document.verify", entityType: "vendor_document", entityId: pdfDoc.id, afterId: mark }), 1);
  assert.equal(await countAudit({ afterId: mark, actorId: admin.userId }), 1);

  const again = await request(`/api/admin/documents/${pdfDoc.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "verify" },
  });
  assert.equal(again.status, 409);
  assert.equal(await countAudit({ afterId: mark, actorId: admin.userId }), 1);

  const n = await db().query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'document.verified'", [vendorA.userId]);
  assert.equal(n.rowCount, 1);
  assert.equal(n.rows[0].payload.link, "/vendor/documents");

  const past = await request(`/api/admin/documents/${extraDoc.id}/decision`, {
    method: "POST",
    cookie: admin.cookie,
    body: { action: "verify", expiresAt: "2001-01-01" },
  });
  assert.equal(past.status, 400);
  const nonAdmin = await request(`/api/admin/documents/${extraDoc.id}/decision`, {
    method: "POST",
    cookie: vendorA.cookie,
    body: { action: "verify" },
  });
  assert.equal(nonAdmin.status, 403);
  assert.equal(await countAudit({ afterId: mark, entityType: "vendor_document" }), 1);
});

test("an expired licence shows 'expired' to the vendor and admin but does not unpublish", async () => {
  await db().query("UPDATE vendor_documents SET expires_at = CURRENT_DATE - 3 WHERE id = $1", [pdfDoc.id]);
  const list = await request("/api/vendor/documents", { cookie: vendorA.cookie });
  const d = list.data.documents.find((x) => x.id === pdfDoc.id);
  assert.equal(d.status, "expired");
  const v = (await db().query("SELECT status::text AS status, published FROM vendors WHERE id = $1", [listingA.id])).rows[0];
  assert.equal(v.status, "approved");
  assert.equal(v.published, true);
  const q = await request(`/api/admin/documents?tab=expired&vendor=${listingA.id}`, { cookie: admin.cookie });
  assert.deepEqual(q.data.items.map((x) => x.id), [pdfDoc.id]);
  const verifiedTab = await request(`/api/admin/documents?tab=verified&vendor=${listingA.id}`, { cookie: admin.cookie });
  assert.equal(verifiedTab.data.items.length, 0);
  const page = await request("/vendor/documents", { cookie: vendorA.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Licence expired/);
});

test("vendor deletes own pending document (file removed) but not a verified one", async () => {
  const verified = await request(`/api/vendor/documents/${pdfDoc.id}`, { method: "DELETE", cookie: vendorA.cookie });
  assert.equal(verified.status, 409);
  const row = await docRow(extraDoc.id);
  const file = path.join(UPLOADS, ...row.storage_key.split("/"));
  assert.ok(existsSync(file));
  const del = await request(`/api/vendor/documents/${extraDoc.id}`, { method: "DELETE", cookie: vendorA.cookie });
  assert.equal(del.status, 200);
  assert.equal(await docRow(extraDoc.id), undefined);
  assert.equal(existsSync(file), false);
});

test("pages: vendor documents page and admin queue render; admin page is 404 for vendors", async () => {
  const v = await request("/vendor/documents", { cookie: vendorB.cookie });
  assert.equal(v.status, 200);
  assert.match(v.text, /No documents yet/);
  const home = await request("/vendor", { cookie: vendorB.cookie });
  assert.equal(home.status, 200);
  assert.match(home.text, /documents-prompt/);
  const a = await request(`/admin/documents?tab=expired&vendor=${listingA.id}`, { cookie: admin.cookie });
  assert.equal(a.status, 200);
  assert.match(a.text, /Doctest A/);
  const denied = await request("/admin/documents", { cookie: vendorA.cookie });
  assert.equal(denied.status, 404);
});
