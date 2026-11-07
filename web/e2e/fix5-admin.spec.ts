import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, loginAsAdmin, isMobile, runTag } from "./helpers";

// fix5 (admin) regression tests: QA-107 (Remove badge asks first, takes an
// optional note and tells the vendor) and QA-110 (44px admin tap targets at
// 390 on /admin/documents, the possible-duplicates list on /admin/vendors/[id]
// and the /admin/taxonomy "N templates" links). LOCAL DB only; removes what
// it creates.

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function db() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!LOCAL.has(host)) throw new Error("fix5-admin spec needs a localhost DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

async function q<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const c = db();
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/** A vendor user with an approved listing, created straight in the local DB. */
async function makeListing(tag: string, name: string, extra: { verified?: boolean } = {}) {
  const [u] = await q<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'vendor') RETURNING id",
    [`fix5 Vendor ${tag}`, `e2e-fix5-admin-${tag}-${Math.random().toString(36).slice(2, 8)}@example.com`, await bcrypt.hash("fix5-vendor-pw-1", 4)]
  );
  const [v] = await q<{ id: number }>(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                          district_id, primary_category_id, onboarding_step, onboarding_completed_at, submitted_at, verified_at)
     VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'fix5 spec listing.', 'approved',
             (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
             (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), 6, now(), now(),
             CASE WHEN $3 THEN now() END)
     RETURNING id`,
    [u.id, name, !!extra.verified]
  );
  return { userId: u.id, vendorId: v.id };
}

async function dropUsers(ids: number[]) {
  if (!ids.length) return;
  await q("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
  await q("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
}

async function expectTapTargets(locator: import("@playwright/test").Locator, what: string) {
  const n = await locator.count();
  expect(n, `${what}: at least one link`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const box = await locator.nth(i).boundingBox();
    expect(box, `${what} #${i} is visible`).not.toBeNull();
    expect(box!.height, `${what} #${i} height`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `${what} #${i} width`).toBeGreaterThanOrEqual(44);
  }
}

test("QA-110 (FIX5-ADM-1): admin links on documents, possible duplicates and taxonomy are 44px tap targets at 390", async ({ page }, testInfo) => {
  test.skip(!isMobile(page), "tap targets are checked on the phone project");
  const tag = runTag(testInfo);
  const name = `fix5 Dup Studio ${tag}`;
  const a = await makeListing(`${tag}-a`, name);
  const b = await makeListing(`${tag}-b`, name);
  try {
    await q(
      `INSERT INTO vendor_documents (vendor_id, doc_type, number, storage_driver, storage_key, mime, bytes)
       VALUES ($1, 'gst', '32ABCDE1234F1Z5', 'local', $2, 'application/pdf', 1000)`,
      [a.vendorId, `private/fix5-${tag}.pdf`]
    );
    await loginAsAdmin(page, testInfo);

    await page.goto(`/admin/documents?tab=pending&vendor=${a.vendorId}`);
    await expectTapTargets(page.locator(`[data-testid="document-queue"] a[href="/admin/vendors/${a.vendorId}"]`), "document card vendor link");
    await expectTapTargets(page.locator(`main a[href="/admin/vendors/${a.vendorId}"]`).first(), "documents filter vendor link");

    await page.goto(`/admin/vendors/${a.vendorId}`);
    await expectTapTargets(page.locator('[data-testid="duplicate-hints"] a'), "possible duplicate link");

    await page.goto("/admin/taxonomy");
    await expectTapTargets(page.getByRole("button", { name: /^\d+ templates?$/ }), "N templates link");
  } finally {
    await dropUsers([a.userId, b.userId]);
  }
});

test("QA-107 (FIX5-ADM-2): Remove badge asks first, takes a note, and the vendor is told", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const v = await makeListing(`${tag}-v`, `fix5 Verified Studio ${tag}`, { verified: true });
  try {
    await loginAsAdmin(page, testInfo);
    await page.goto(`/admin/vendors/${v.vendorId}`);
    await page.getByRole("button", { name: "Remove badge", exact: true }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Remove the Verified badge?" });
    await expect(dialog).toBeVisible();
    // Nothing has changed yet: the dialog is a real confirm.
    expect((await q<{ verified_at: string | null }>("SELECT verified_at FROM vendors WHERE id = $1", [v.vendorId]))[0].verified_at).not.toBeNull();

    // Cancelling keeps the badge.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await q<{ verified_at: string | null }>("SELECT verified_at FROM vendors WHERE id = $1", [v.vendorId]))[0].verified_at).not.toBeNull();

    const note = `fix5 e2e: the licence has expired ${tag}`;
    await page.getByRole("button", { name: "Remove badge", exact: true }).click();
    await dialog.locator("textarea").fill(note);
    await dialog.getByRole("button", { name: "Remove badge" }).click();
    await expect(page.getByTestId("decision-message")).toContainText("Verified badge removed");
    await expect(page.getByRole("button", { name: "Mark verified", exact: true })).toBeVisible();

    const [row] = await q<{ verified_at: string | null }>("SELECT verified_at FROM vendors WHERE id = $1", [v.vendorId]);
    expect(row.verified_at).toBeNull();
    const [audit] = await q<{ reason: string | null }>(
      "SELECT reason FROM admin_audit_log WHERE action = 'vendor.unverify' AND entity_id = $1 ORDER BY id DESC LIMIT 1",
      [String(v.vendorId)]
    );
    expect(audit.reason).toBe(note);
    const notes = await q<{ payload: { title: string; body: string; link: string } }>(
      "SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'vendor.unverified'",
      [v.userId]
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].payload.body).toContain(note);
    expect(notes[0].payload.link).toBe("/vendor");
  } finally {
    await q("DELETE FROM notifications WHERE user_id = $1", [v.userId]);
    await dropUsers([v.userId]);
  }
});
