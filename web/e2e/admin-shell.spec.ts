import { test, expect, checkScreen, isMobile, loginAsAdmin } from "./helpers";

// P1 admin foundation: the admin shell replaces all customer/vendor chrome
// on /admin, at 390px (menu) and 1440px (sidebar), with no horizontal scroll.

const SECTIONS = [
  "Today",
  "Vendors",
  "Media",
  "Reviews",
  "Taxonomy",
  "Custom offerings",
  "Users",
  "Enquiries",
  "Analytics",
  "Audit log",
];

test("admin: shell navigation, no public chrome", async ({ page, diag }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  // No customer/vendor header links, no public footer, no workspace nav.
  await expect(page.getByRole("link", { name: "For vendors" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse vendors" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Footer" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: "Admin" });
  if (isMobile(page)) {
    await expect(nav).toHaveCount(0); // hidden sidebar is display:none
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeVisible();
    await checkScreen(page, diag, testInfo, "admin-today");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    for (const label of SECTIONS) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View site" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await checkScreen(page, diag, testInfo, "admin-menu-open");
    await nav.getByRole("link", { name: "Vendors", exact: true }).click();
  } else {
    for (const label of SECTIONS) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View site" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await checkScreen(page, diag, testInfo, "admin-today");
    await nav.getByRole("link", { name: "Vendors", exact: true }).click();
  }

  await expect(page).toHaveURL(/\/admin\/vendors$/);
  await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
  if (!isMobile(page)) {
    await expect(nav.getByRole("link", { name: "Vendors", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await checkScreen(page, diag, testInfo, "admin-vendors");

  // Custom offerings highlights itself, not Taxonomy.
  await page.goto("/admin/taxonomy/custom");
  await expect(page.getByRole("heading", { level: 1, name: "Custom offerings" })).toBeVisible();
  if (!isMobile(page)) {
    await expect(nav.getByRole("link", { name: "Custom offerings" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Taxonomy", exact: true })).not.toHaveAttribute("aria-current", "page");
  }

  // Sign out returns to the public site.
  if (isMobile(page)) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  expect((await page.request.get("/admin", { maxRedirects: 0 })).status()).toBe(404);
});
