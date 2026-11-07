import { test, expect, loginAsAdmin } from "./helpers";

// QA round 2 admin fixes, as a browser sees them (fix2 group "adm").
// QA-052: a missing vendor/user id is a real 404 inside the admin shell.
// QA-049: taxonomy reorder buttons are 44px and move an item (moved back after).
// QA-039: Request changes on a live listing warns that it goes offline (cancelled).
// The API side is in tests/qa2-adm.test.mjs.

for (const path of ["/admin/vendors/2147483000", "/admin/users/2147483000"]) {
  test(`QA-052 ${path}: admin 404 inside the admin shell`, async ({ page }, testInfo) => {
    await loginAsAdmin(page, testInfo);
    const resp = await page.goto(path);
    expect(resp?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This record doesn't exist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find vendors" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("link", { name: "Vendors", exact: true })).toBeVisible();
    await page.locator("main").getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  });
}

test("QA-049: categories move up and down from /admin/taxonomy", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/taxonomy");
  await expect(page.getByRole("heading", { level: 1, name: "Taxonomy" })).toBeVisible();
  const down = page.getByRole("button", { name: /^Move down: .+$/ }).first();
  await expect(down).toBeVisible();
  const box = await down.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const name = (await down.getAttribute("aria-label"))!.replace(/^Move down: /, "");
  const headings = page.locator("[data-testid^='category-'] h2");
  expect((await headings.first().textContent())?.trim()).toBe(name);
  await down.click();
  await expect(page.getByRole("status").filter({ hasText: `Moved "${name}" down.` })).toBeVisible();
  await expect(headings.nth(1)).toHaveText(name);
  // Put it back.
  await page.getByRole("button", { name: `Move up: ${name}` }).click();
  await expect(headings.first()).toHaveText(name);
});

test("QA-039: Request changes on a live listing says it goes offline", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let id: number | undefined;
  try {
    id = (await client.query("SELECT id FROM vendors WHERE status = 'approved' ORDER BY id LIMIT 1")).rows[0]?.id;
  } finally {
    await client.end();
  }
  test.skip(!id, "no approved listing in the local DB");
  await page.goto(`/admin/vendors/${id}`);
  await page.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("Take the listing offline and ask for changes?");
  await expect(dialog).toContainText("its public page goes offline at once");
  await expect(dialog.getByRole("button", { name: "Take offline and send" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});
