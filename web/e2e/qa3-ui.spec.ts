import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect } from "./helpers";

// QA round qa3 (cross-cutting UI / responsive). Open issues, reproduced on LOCAL.
// Users are created in the LOCAL DB with e2e-* emails (removed by the global cleanup).

function client() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("needs a localhost DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

// QA3-UI-1: /c/[slug] "Top <category> vendors" list overflows the page on a
// phone when a vendor has an ordinary but long business name. The list is a CSS
// grid whose items keep min-width:auto, so the row's `truncate` name never
// shrinks and the whole page scrolls sideways (same pattern as QA-011 on /e).
test.fail("QA3-UI-1 /c/[slug] top vendors list: a long vendor name makes the page scroll sideways at 390px", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 600, "phone-only layout bug");
  const rnd = Math.random().toString(36).slice(2, 8);
  const c = client();
  await c.connect();
  let slug = "";
  try {
    // The category with the fewest live vendors, so the new one is in the top list.
    const cat = (
      await c.query<{ id: number; slug: string; name: string }>(
        `SELECT c.id, c.slug, c.name FROM categories c
          LEFT JOIN vendors v ON v.primary_category_id = c.id AND v.status = 'approved'
          GROUP BY c.id ORDER BY count(v.id), c.id LIMIT 1`
      )
    ).rows[0];
    slug = cat.slug;
    const uid = (
      await c.query<{ id: number }>(
        "INSERT INTO users (name, email, password_hash, role) VALUES ('QA3 Vendor', $1, $2, 'vendor') RETURNING id",
        [`e2e-vendor-qa3-ui-${rnd}@example.com`, await bcrypt.hash("e2e-qa3-password-1", 10)]
      )
    ).rows[0].id;
    const vid = (
      await c.query<{ id: number }>(
        `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                              district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
         VALUES ($1, $2, $3, 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E qa3 listing.', 'approved',
                 (SELECT id FROM districts WHERE name = 'Ernakulam' LIMIT 1), $4, '+919847012345', '+919847012345', 6, now(), now())
         RETURNING id`,
        [uid, `Sree Lakshmi Wedding Photography and Films ${rnd}`, cat.name, cat.id]
      )
    ).rows[0].id;
    await c.query("INSERT INTO vendor_categories (vendor_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [vid, cat.id]);
  } finally {
    await c.end();
  }
  await page.goto(`/c/${slug}`);
  await expect(page.getByText(/Sree Lakshmi Wedding Photography/).first()).toBeVisible();
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "page must not scroll horizontally").toBeLessThanOrEqual(iw);
});
