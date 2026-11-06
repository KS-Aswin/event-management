import { test, expect, checkScreen } from "./helpers";

// P1-14: the terms and content policy page and the links to it.

test("footer links to /terms and the page has the content policy", async ({ page, diag }, testInfo) => {
  await page.goto("/about");
  const footer = page.getByRole("navigation", { name: "Footer" });
  await footer.getByRole("link", { name: "Terms" }).click();
  await page.waitForURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: "Terms and content policy" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Content policy/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Photos, videos and consent/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Verification documents/ })).toBeVisible();
  await expect(page.getByText(/No communal, caste or religious remarks/)).toBeVisible();
  await checkScreen(page, diag, testInfo, "terms");
});

test("signup page links to /terms under the button", async ({ page }) => {
  await page.goto("/signup");
  const link = page.getByRole("link", { name: "Terms and content policy" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/terms");
});

test("/terms#media anchor (used by the upload consent box) exists", async ({ page }) => {
  await page.goto("/terms#media");
  await expect(page.locator("#media")).toHaveText(/Photos, videos and consent/);
});
