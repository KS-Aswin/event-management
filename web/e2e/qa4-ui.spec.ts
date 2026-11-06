import { test, expect, loginAsAdmin } from "./helpers";

// QA round qa4 (cross-cutting UI / responsive / a11y / copy). Open issues
// reproduced on LOCAL (http://localhost:3160). Marked test.fail until fixed.

// QA4-UI-1: /forgot-password and /reset-password have no <main> landmark
// (QA-071 added one to /login and /signup only).
test.fail("QA4-UI-1 /forgot-password and /reset-password expose a <main> landmark", async ({ page }) => {
  for (const path of ["/forgot-password", "/reset-password", "/reset-password?token=bogus"]) {
    await page.goto(path);
    await expect(page.locator("main"), path).toHaveCount(1);
  }
});

// QA4-UI-2: an unknown /admin/* route shown to a signed-in admin renders the
// root 404 with no header, nav or footer (the site header hides itself under
// /admin for admins, and the admin shell is not applied to the root not-found),
// so the only exits are the public "Find vendors" / "Go home" buttons.
test.fail("QA4-UI-2 unknown /admin route keeps admin navigation on the 404 page", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  const res = await page.goto("/admin/no-such-admin-page");
  expect(res?.status()).toBe(404);
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Vendors$/ }).first()).toBeVisible();
});

// QA4-UI-3: admin vendor detail, Offerings list: the meta line reads
// "Service ·Candid photography" (no space after the middle dot).
// Source: app/admin/vendors/[id]/page.tsx ~line 231.
test.fail("QA4-UI-3 admin vendor offerings meta has a space after the middle dot", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/vendors/605");
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/(Service|Package|Add-on) ·\S/);
});
