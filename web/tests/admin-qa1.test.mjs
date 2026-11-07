// QA round 1 admin fixes: QA-019 (audit/enquiry/vendor paging past the end,
// "entrys" plural), QA-020 (vendor detail repeated the primary category),
// QA-021 (vendor detail in one DB round trip; Vercel region next to the DB),
// QA-022 (Signups headline adds up with its breakdown, "1 vendors").
// Run: BASE_URL=http://localhost:<port> node --env-file-if-exists=.env.local --test tests/admin-qa1.test.mjs
// Test users are admtest-qa1fix-<digits>@example.com (admin-helpers.mjs), removed in after().

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WEB_DIR,
  request,
  makeCustomer,
  makeVendor,
  createAdmin,
  createListing,
  db,
  cleanup,
  closeDb,
} from "./admin-helpers.mjs";
import { plural } from "../lib/admin/format.ts";

const P = "qa1fix";

after(async () => {
  await cleanup(P);
  await closeDb();
});

let admin, customer, vendor, listing;

/** Visible text of an HTML page (tags removed, entities for the few we render). */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

test("setup: admin, customer, vendor with a listing in two categories", async () => {
  admin = await createAdmin(P);
  customer = await makeCustomer(P);
  vendor = await makeVendor(P);
  listing = await createListing(vendor.userId, {
    status: "approved",
    category: "Photography",
    name: `Admtest QA1 ${Date.now()}`,
  });
  // vendor_categories holds the primary category too (as onboarding writes it), plus one more.
  await db().query(
    `INSERT INTO vendor_categories (vendor_id, category_id)
     SELECT $1, id FROM categories WHERE name IN ('Photography', 'Decoration')
     ON CONFLICT DO NOTHING`,
    [listing.id]
  );
  assert.ok(admin.cookie && listing.id);
});

test("plural(): irregular English plurals", () => {
  assert.equal(plural(1, "entry"), "1 entry");
  assert.equal(plural(647, "entry"), "647 entries");
  assert.equal(plural(2, "enquiry"), "2 enquiries");
  assert.equal(plural(1, "vendor"), "1 vendor");
  assert.equal(plural(0, "vendor"), "0 vendors");
  assert.equal(plural(3, "day"), "3 days");
  assert.equal(plural(12345, "customer"), "12,345 customers");
});

test("QA-019: audit API clamps an out-of-range page to the last page", async () => {
  const { rows } = await db().query("SELECT count(*)::int AS n FROM admin_audit_log");
  const total = rows[0].n;
  const r = await request("/api/admin/audit?page=999", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  if (total === 0) {
    assert.equal(r.data.page, 1);
    assert.equal(r.data.rows.length, 0);
    return;
  }
  assert.ok(r.data.total >= total);
  assert.equal(r.data.page, r.data.pages, "page is clamped to the last page");
  assert.ok(r.data.rows.length > 0, "the last page has rows");
  // A normal in-range page is unchanged.
  const first = await request("/api/admin/audit?page=1", { cookie: admin.cookie });
  assert.equal(first.data.page, 1);
});

test("QA-019: /admin/audit?page=999 shows the last page and says 'entries'", async () => {
  const r = await request("/admin/audit?page=999", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  const t = textOf(r.text);
  assert.doesNotMatch(t, /entrys/);
  assert.doesNotMatch(t, /page 999 of/);
  const m = t.match(/([\d,]+) (entry|entries) · page (\d+) of (\d+)/);
  if (m) {
    assert.equal(m[3], m[4], "shows the last page");
    assert.equal(m[2], m[1] === "1" ? "entry" : "entries");
    assert.doesNotMatch(t, /No admin actions yet/);
  } else {
    assert.match(t, /No admin actions yet/); // empty log on a fresh DB
  }
});

test("QA-019: enquiries API/page clamp and pluralise too", async () => {
  const r = await request("/admin/enquiries?range=all&page=999", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  const t = textOf(r.text);
  assert.doesNotMatch(t, /enquirys/);
  assert.doesNotMatch(t, /page 999 of/);
});

test("QA-019: /admin/vendors past the last page shows the last page", async () => {
  const r = await request("/admin/vendors?status=all&page=999", { cookie: admin.cookie });
  assert.equal(r.status, 200);
  const t = textOf(r.text);
  assert.doesNotMatch(t, /page 999 of/);
  assert.doesNotMatch(t, /No all vendors|Nothing waiting/);
  const m = t.match(/([\d,]+) vendors? · page (\d+) of (\d+)/);
  assert.ok(m, "pager shown");
  assert.equal(m[2], m[3], "shows the last page");
});

test("QA-020/021: vendor detail lists each category once, owner shown, in one round of queries", async () => {
  const r = await request(`/admin/vendors/${listing.id}`, { cookie: admin.cookie });
  assert.equal(r.status, 200);
  const t = textOf(r.text);
  assert.match(t, /Category Photography, Decoration/);
  assert.doesNotMatch(t, /Photography, Photography/);
  assert.match(t, new RegExp(vendor.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Unknown id is still not-found (the first query no longer gates the rest).
  // loading.tsx streams the page, so the not-found UI may come with a 200.
  const missing = await request("/admin/vendors/999999999", { cookie: admin.cookie });
  assert.ok(missing.status === 404 || /couldn(&#x27;|&apos;|')t find that page/.test(missing.text));
});

test("QA-020: a listing with no owner still renders", async () => {
  const { rows } = await db().query(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status)
     VALUES (NULL, $1, 'Photography', 'Ernakulam', 0, 'Price on request', '1 yr', 'Unclaimed.', 'approved') RETURNING id`,
    [`Admtest QA1 unclaimed ${Date.now()}`]
  );
  const id = rows[0].id;
  try {
    const r = await request(`/admin/vendors/${id}`, { cookie: admin.cookie });
    assert.equal(r.status, 200);
  } finally {
    await db().query("DELETE FROM vendors WHERE id = $1", [id]);
  }
});

test("QA-021: functions run in Seoul (icn1), next to the Supabase DB (ap-northeast-2)", () => {
  const cfg = JSON.parse(readFileSync(path.join(WEB_DIR, "vercel.json"), "utf8"));
  assert.deepEqual(cfg.regions, ["icn1"]);
});

test("QA-022: Signups headline equals the sum of its breakdown, with correct plurals", async () => {
  const api = await request("/api/admin/analytics?days=7", { cookie: admin.cookie });
  assert.equal(api.status, 200);
  const t = api.data.signups.totals;
  assert.equal(t.all, t.customer + t.vendor + t.admin);
  assert.ok(t.admin >= 1 && t.customer >= 1 && t.vendor >= 1, "this run's accounts are counted");

  const page = await request("/admin/analytics?days=7", { cookie: admin.cookie });
  assert.equal(page.status, 200);
  const text = textOf(page.text);
  const m = text.match(/Signups, last 7 days ([\d,]+) ([\d,]+) vendors? · ([\d,]+) customers?(?: · ([\d,]+) admins?)?/);
  assert.ok(m, `signups stat not found in: ${text.slice(0, 400)}`);
  const n = (s) => Number((s ?? "0").replace(/,/g, ""));
  assert.equal(n(m[1]), n(m[2]) + n(m[3]) + n(m[4]), "headline adds up");
  assert.doesNotMatch(text, /\b1 (vendors|customers|admins)\b/);
  assert.equal(customer.cookie.length > 0, true);
});
