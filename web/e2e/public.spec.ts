import { test, expect, checkScreen, isMobile } from "./helpers";

// Screens anyone can see without an account.

test("home page renders categories and search", async ({ page, diag }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Search vendors/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Browse by category" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "home");
});

test("home typeahead shows suggestions and opens search", async ({ page, diag }, testInfo) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: /Search vendors/ });
  await box.click();
  await box.pressSequentially("photo", { delay: 60 });
  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option").first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "home-typeahead");
  await box.press("Enter");
  await page.waitForURL(/\/search|\/vendors\//);
  await expect(page.locator("main")).toBeVisible();
});

test("category link on home opens filtered search", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Browse by category" });
  await nav.getByRole("link").first().click();
  await page.waitForURL(/\/search\?/);
  await expect(page.locator('a[href^="/vendors/"]').first()).toBeVisible();
});

test("search results page", async ({ page, diag }, testInfo) => {
  await page.goto("/search");
  await expect(page.locator('a[href^="/vendors/"]').first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "search");
});

test("search filters: category, location, rating, clear", async ({ page, diag }, testInfo) => {
  await page.goto("/search");
  if (isMobile(page)) await page.getByRole("button", { name: /^Filters/ }).click();
  const panel = page.getByRole("complementary", { name: "Filters" });
  await expect(panel).toBeVisible();
  await panel.locator("label", { hasText: "Photography" }).click();
  await page.waitForURL(/category=/);
  await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible();
  if (isMobile(page) && !(await panel.isVisible())) await page.getByRole("button", { name: /^Filters/ }).click();
  await panel.getByLabel("Minimum rating").selectOption("4.5");
  await page.waitForURL(/minRating=4.5/);
  if (isMobile(page) && !(await panel.isVisible())) await page.getByRole("button", { name: /^Filters/ }).click();
  await checkScreen(page, diag, testInfo, "search-filtered");
  const locationOptions = await panel.getByLabel("Location").locator("option").allTextContents();
  if (locationOptions.length > 1) {
    await panel.getByLabel("Location").selectOption({ index: 1 });
    await page.waitForURL(/location=/);
  }
  if (isMobile(page) && !(await panel.isVisible())) await page.getByRole("button", { name: /^Filters/ }).click();
  await panel.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL((u) => !u.search.includes("category="));
});

test("search with a query that has no results", async ({ page, diag }, testInfo) => {
  await page.goto("/search?q=zzzznotavendor");
  await expect(page.getByRole("heading", { name: "Popular vendors" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "search-empty");
});

test("vendor profile page", async ({ page, diag }, testInfo) => {
  await page.goto("/search");
  const first = page.locator('a[href^="/vendors/"]').first();
  const href = await first.getAttribute("href");
  await page.goto(href!);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request quote" }).first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "vendor-profile");
});

test("quote dialog when signed out", async ({ page, diag }, testInfo) => {
  await page.goto("/search");
  const href = await page.locator('a[href^="/vendors/"]').first().getAttribute("href");
  await page.goto(href!);
  await page.getByRole("button", { name: "Request quote" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await checkScreen(page, diag, testInfo, "quote-dialog");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("unknown vendor id shows the not-found page with noindex", async ({ page, diag }, testInfo) => {
  // The root loading.tsx starts streaming first, so Next.js sends 200 plus a
  // robots noindex tag instead of a 404 status (documented framework behaviour).
  await page.goto("/vendors/99999999");
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  await expect(page.locator("main, body").first()).toContainText(/not found|couldn.t find|doesn.t exist/i);
  await checkScreen(page, diag, testInfo, "vendor-not-found", { ignoreErrors: [/status of 404/] });
});

for (const [path, name, heading] of [
  ["/about", "about", /./],
  ["/help", "help", /./],
  ["/privacy", "privacy", /./],
  ["/for-vendors", "for-vendors", /./],
  ["/login", "login", /Sign in|Welcome/i],
  ["/signup", "signup", /Create your account/],
] as const) {
  test(`static page ${path}`, async ({ page, diag }, testInfo) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toHaveText(heading);
    await checkScreen(page, diag, testInfo, name);
  });
}

test("404 page", async ({ page, diag }, testInfo) => {
  const res = await page.goto("/this-page-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: /home|search|browse/i }).first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "not-found", { ignoreErrors: [/status of 404/] });
});

test("dashboard and settings redirect to login when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody-e2e@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
