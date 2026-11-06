import { test, expect, loginAsAdmin } from "./helpers";

// QA round 2 (admin) reproductions. Each test is expected to fail until the
// bug is fixed (test.fail). Uses the local DB; touches only the seeded
// "Mehendi" category (restored at the end) and a qa2 test category.

const ORIGIN = { origin: "http://localhost" };

test("QA2-admin: renaming a category to another category's name is refused", async ({ page }, testInfo) => {
  test.fail(true, "QA2 admin: PATCH /api/admin/categories/:id accepts a duplicate display name");
  await loginAsAdmin(page, testInfo);
  const base = new URL(page.url()).origin;
  const H = { ...ORIGIN, origin: base };
  const cats = (await (await page.request.get("/api/admin/categories")).json()) as {
    categories: { id: number; display_name: string; active: boolean }[];
  };
  const [a, b] = cats.categories.filter((c) => c.active);
  const r = await page.request.patch(`/api/admin/categories/${a.id}`, { headers: H, data: { displayName: b.display_name } });
  // restore whatever happened
  await page.request.patch(`/api/admin/categories/${a.id}`, { headers: H, data: { displayName: a.display_name } });
  expect(r.status()).toBe(409);
});

test("QA2-admin: reset-link dialog label does not repeat (optional)", async ({ page }, testInfo) => {
  test.fail(true, "QA2 admin: label reads 'Note (optional) (optional)'");
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/users");
  await page.locator("main a[href^='/admin/users/']").first().click();
  await page.getByRole("button", { name: "Create reset link" }).click();
  await expect(page.locator("dialog[open], [role=dialog]").first()).not.toContainText("(optional) (optional)");
});

test("QA2-admin: categories can be reordered from the taxonomy page", async ({ page }, testInfo) => {
  test.fail(true, "QA2 admin: no reorder control in /admin/taxonomy (sortOrder is API-only)");
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/taxonomy");
  await expect(page.getByRole("heading", { level: 1, name: "Taxonomy" })).toBeVisible();
  const reorder = page.getByRole("button", { name: /move up|move down|reorder/i });
  expect(await reorder.count()).toBeGreaterThan(0);
});
