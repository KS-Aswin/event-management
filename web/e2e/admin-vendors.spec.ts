import pg from "pg";
import { test, expect, checkScreen, isMobile, loginAsAdmin, runTag } from "./helpers";

// P1-3: an admin opens the vendor queue, opens a pending listing and
// approves it through the in-page dialog. The listing is created straight
// in the LOCAL DB (no owner) and removed afterwards.

const created: number[] = [];

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

test.afterAll(async () => {
  if (!created.length) return;
  const c = client();
  await c.connect();
  try {
    await c.query("DELETE FROM vendors WHERE id = ANY($1::int[]) AND owner_id IS NULL", [created]);
  } finally {
    await c.end();
  }
});

test("admin: vendor queue -> pending listing -> approve", async ({ page, diag }, testInfo) => {
  const name = `E2E Pending ${runTag(testInfo)} ${Math.random().toString(36).slice(2, 6)}`;
  const c = client();
  await c.connect();
  let id: number;
  try {
    const r = await c.query<{ id: number }>(
      `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                            district_id, primary_category_id, phone, onboarding_step, onboarding_completed_at, submitted_at)
       VALUES (NULL, $1, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E pending listing for the admin queue.',
               'pending', (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
               (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', 6, now(), now())
       RETURNING id`,
      [name]
    );
    id = r.rows[0].id;
    created.push(id);
  } finally {
    await c.end();
  }

  await loginAsAdmin(page, testInfo);
  await page.goto(`/admin/vendors?status=pending&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Vendor queues" });
  await expect(tabs.getByRole("link", { name: /^Pending/ })).toHaveAttribute("aria-current", "page");
  const row = page.getByTestId("vendors-list").getByRole("link", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await checkScreen(page, diag, testInfo, "admin-vendors-queue");

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/admin/vendors/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
  await expect(page.locator(`a[href="/admin/documents?vendor=${id}"]`)).toBeVisible();
  await checkScreen(page, diag, testInfo, "admin-vendor-detail");

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Approve this listing?" });
  await expect(dialog).toBeVisible();
  if (isMobile(page)) await checkScreen(page, diag, testInfo, "admin-vendor-approve-dialog");
  await dialog.getByRole("button", { name: "Approve and publish" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("decision-message")).toContainText("Approved");
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("status-history")).toContainText("pending");

  // Public now, and gone from the pending queue.
  expect((await page.request.get(`/api/vendors/${id}`)).status()).toBe(200);
  await page.goto(`/admin/vendors?status=pending&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("heading", { name: "No vendors match" })).toBeVisible();
});
