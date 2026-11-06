import { test, expect, loginAsAdmin } from "./helpers";

// QA round 2 (cross-cutting UI) reproductions. Fixed in round fix2 (now a regular test).
// QA2-UI-1: an admin detail page for a missing vendor/user answers HTTP 200,
// drops the admin shell (no admin nav) and shows the public "vendor may no
// longer be listed / Find vendors" 404 copy.

for (const path of ["/admin/vendors/999999", "/admin/users/999999"]) {
  test(`QA2-UI-1 admin not-found ${path}: real 404 status inside the admin shell`, async ({ page }, testInfo) => {
    await loginAsAdmin(page, testInfo);
    const resp = await page.goto(path);
    expect(resp?.status()).toBe(404);
    // The admin navigation should still be there so the admin can go back.
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Find vendors" })).toHaveCount(0);
  });
}
