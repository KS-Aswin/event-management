import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, loginAsAdmin, runTag, type Creds } from "./helpers";

// QA round 4 (admin) regression tests (QA-085, QA-097, QA-098, QA-099 and the
// QA-086 landmark check). Uses the LOCAL DB only and removes what it creates.

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
  if (!LOCAL.has(host)) throw new Error("qa4-admin spec needs a localhost DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

/** A vendor user with a pending listing, created straight in the local DB. */
async function makePendingListing(tag: string) {
  const c = db();
  await c.connect();
  try {
    const creds: Creds = { name: `qa4 Vendor ${tag}`, email: `e2e-qa4-admin-spec-${tag}@example.com`, password: "qa4-vendor-password-1" };
    const u = await c.query<{ id: number }>(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'vendor') RETURNING id",
      [creds.name, creds.email, await bcrypt.hash(creds.password, 10)]
    );
    const v = await c.query<{ id: number }>(
      `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                            district_id, primary_category_id, onboarding_step, onboarding_completed_at, submitted_at)
       VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'qa4 spec listing.', 'pending',
               (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
               (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), 6, now(), now())
       RETURNING id`,
      [u.rows[0].id, `qa4 Spec Studio ${tag}`]
    );
    return { creds, userId: u.rows[0].id, vendorId: v.rows[0].id };
  } finally {
    await c.end();
  }
}

async function dropUser(userId: number) {
  const c = db();
  await c.connect();
  try {
    await c.query("DELETE FROM vendors WHERE owner_id = $1", [userId]);
    await c.query("DELETE FROM users WHERE id = $1", [userId]);
  } finally {
    await c.end();
  }
}

async function decide(page: import("@playwright/test").Page, vendorId: number, button: string, confirm: string, reason?: string) {
  await page.goto(`/admin/vendors/${vendorId}`);
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: confirm }) });
  if (reason) await dialog.locator("textarea").fill(reason);
  await dialog.getByRole("button", { name: confirm }).click();
}

test("QA4-ADM-1: unsuspending a changes-requested listing keeps the admin's change request note", async ({ page, browser }, testInfo) => {
  const tag = runTag(testInfo) + Math.random().toString(36).slice(2, 6);
  const { creds, userId, vendorId } = await makePendingListing(tag);
  try {
    await loginAsAdmin(page, testInfo);
    const note = "qa4 spec: please add three photos of your own weddings";
    await decide(page, vendorId, "Request changes", "Send to vendor", note);
    await expect(page.getByText("Sent back to the vendor")).toBeVisible();
    await decide(page, vendorId, "Suspend", "Suspend listing", "qa4 spec: fake reviews");
    await expect(page.getByText("Suspended. The listing")).toBeVisible();
    await decide(page, vendorId, "Unsuspend", "Unsuspend");
    await expect(page.getByText("Suspension lifted.")).toBeVisible();
    await page.reload();
    await expect(page.locator("main")).toContainText("changes requested");
    // QA-085: unsuspend used to set status_reason = NULL even when it restored
    // changes_requested (or rejected), so the note was gone for the admin page
    // and the vendor home ("Our team asked for a few changes" + nothing).
    await expect(page.locator("main")).toContainText(note);

    const vendor = await browser.newPage();
    await vendor.goto("/login");
    await vendor.getByLabel("Email").fill(creds.email);
    await vendor.getByLabel("Password", { exact: true }).fill(creds.password);
    await vendor.getByRole("button", { name: "Sign in" }).click();
    await vendor.waitForURL((u) => !u.pathname.startsWith("/login"));
    await vendor.goto("/vendor");
    await expect(vendor.locator("main")).toContainText(note);
  } finally {
    await dropUser(userId);
  }
});

test("QA4-ADM-2: at 390px the active admin tab is scrolled into view", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page, testInfo);
  for (const url of ["/admin/media?tab=hidden", "/admin/vendors?status=suspended", "/admin/vendors?status=all"]) {
    await page.goto(url);
    const active = page.locator("main [aria-current=page]").last();
    // Was: 'Hidden by Vela' left=494, 'Suspended' left=582, 'All' left=944 in a 390px viewport.
    // The strip scrolls after hydration, so poll.
    await expect
      .poll(async () => {
        const box = await active.boundingBox();
        return box && box.x >= 0 && box.x + box.width <= 390;
      }, { message: `${url} active tab is inside the viewport` })
      .toBe(true);
  }
});

test("QA4-ADM-3: the Verified badge control's accessible name includes its visible label", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/vendors?status=approved");
  await page.locator("main a[href^='/admin/vendors/']").first().click();
  // QA-098: the visible text was 'Mark verified' / 'Remove badge' but the
  // aria-label was 'Verified business badge' (WCAG 2.5.3 label in name), so
  // voice control users saying "click Mark verified" got nothing. It is now a
  // plain action button named by its visible text.
  await expect(page.getByRole("button", { name: /^(Mark verified|Remove badge)$/ })).toHaveCount(1);
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test("QA4-ADM-4: unhiding a review tells the vendor, like hiding it does", async ({ page }, testInfo) => {
  const tag = runTag(testInfo) + Math.random().toString(36).slice(2, 6);
  const { userId, vendorId } = await makePendingListing(tag);
  const c = db();
  await c.connect();
  try {
    await c.query("UPDATE vendors SET status = 'approved' WHERE id = $1", [vendorId]);
    const r = await c.query<{ id: number }>(
      "INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1, 'qa4 spec reviewer', 1, 'qa4 spec review with 9999999999') RETURNING id",
      [vendorId]
    );
    await c.query("INSERT INTO review_reports (review_id, reason) VALUES ($1, 'qa4 spec: phone number')", [r.rows[0].id]);
    await loginAsAdmin(page, testInfo);
    await page.goto("/admin/reviews");
    const card = page.locator("article, li, section").filter({ hasText: "qa4 spec reviewer" }).last();
    await card.getByRole("button", { name: "Hide review" }).click();
    const hide = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Hide review" }) });
    await hide.locator("textarea").fill("qa4 spec: contact details");
    await hide.getByRole("button", { name: "Hide review" }).click();
    await expect(page.getByText(/Review hidden/)).toBeVisible();
    await page.goto("/admin/reviews?tab=hidden");
    const hidden = page.locator("article, li, section").filter({ hasText: "qa4 spec reviewer" }).last();
    await hidden.getByRole("button", { name: "Unhide review" }).click();
    await page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Unhide review" }) }).getByRole("button", { name: "Unhide review" }).click();
    await expect(page.getByText("Review is public again.")).toBeVisible();
    const n = await c.query("SELECT kind FROM notifications WHERE user_id = $1 ORDER BY id", [userId]);
    // Observed: only 'review.hidden' ("Your rating has been updated"); the
    // review comes back and the rating drops again without any notice.
    expect(n.rows.map((x) => x.kind)).toContain("review.unhidden");
  } finally {
    await c.query("DELETE FROM vendor_reviews WHERE vendor_id = $1", [vendorId]).catch(() => {});
    await c.end();
    await dropUser(userId);
  }
});

test("QA4-ADM-5: the forgot and reset password pages have a main landmark", async ({ page }) => {
  for (const url of ["/forgot-password", "/reset-password?token=qa4-invalid"]) {
    await page.goto(url);
    // /login and /signup render <main>; these two use a plain <div>.
    await expect(page.getByRole("main"), url).toHaveCount(1);
  }
});
