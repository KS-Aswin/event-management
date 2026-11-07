import { test, expect, checkScreen, isMobile } from "./helpers";

// Search v2 and browse pages (P2-7, P2-8), as a signed-out visitor. Uses the
// seeded vendors (npm run db:seed) only; nothing is created.

test("home: What / Where / When and the occasion chips", async ({ page, diag }, testInfo) => {
  await page.goto("/");
  const occasions = page.getByRole("navigation", { name: "Plan by occasion" });
  await expect(occasions.getByRole("link", { name: "Nikah" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Search vendors/ })).toBeVisible();
  await page.getByLabel("Where: district").selectOption("Ernakulam");
  await expect(page.getByLabel("When: event date (optional)")).toBeVisible();
  await checkScreen(page, diag, testInfo, "home-what-where-when");
  await page.getByRole("button", { name: "Search vendors" }).click();
  await page.waitForURL(/\/search\?.*location=Ernakulam/);
  await expect(page.locator('a[href^="/vendors/"]').first()).toBeVisible();
});

test("event-type page lists the bundle with top vendors", async ({ page, diag }, testInfo) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Plan by occasion" }).getByRole("link", { name: "Nikah" }).click();
  await page.waitForURL(/\/e\/nikah$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Nikah/);
  await expect(page).toHaveTitle(/Nikah/);
  await expect(page.getByRole("heading", { name: "What you'll need" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Catering" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Photography" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "event-type-nikah");
  await page.getByRole("link", { name: /See all photography/ }).click();
  await page.waitForURL(/\/search\?.*category=Photography.*eventType=nikah/);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Nikah");
});

test("category landing page and unknown slugs", async ({ page, diag }, testInfo) => {
  await page.goto("/c/photography");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Photography in Kerala");
  await expect(page.getByRole("heading", { name: "Popular services" })).toBeVisible();
  await expect(page.locator('a[href^="/vendors/"]').first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "category-photography");
  await page.getByRole("link", { name: "Candid photography" }).click();
  await page.waitForURL(/view=offerings.*offering=candid-photography/);

  await page.goto("/e/no-such-occasion");
  await expect(page.locator("main, body").first()).toContainText(/couldn.t find/i);
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});

test("search: services view shows offering cards", async ({ page, diag }, testInfo) => {
  await page.goto("/search?category=Photography");
  const toggle = page.getByRole("navigation", { name: "Show results as" });
  await toggle.getByRole("link", { name: "Services" }).click();
  await page.waitForURL(/view=offerings/);
  await expect(toggle.getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");
  const card = page.locator("article").first();
  await expect(card).toContainText(/₹[\d,]+ \/ \w+/);
  await expect(card).toContainText(/by .+, /);
  await checkScreen(page, diag, testInfo, "search-services");
  const href = await card.getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/vendors\/\d+#offering-\d+$/);
});

test("search: filter sheet with per-unit budget, date and verified", async ({ page, diag }, testInfo) => {
  await page.goto("/search");
  const panel = page.locator("#search-filters-panel"); // QA-027: a dialog when open on phones, a sidebar on desktop
  if (isMobile(page)) {
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: /^Filters/ }).click();
  }
  await expect(panel).toBeVisible();
  await panel.locator("label", { hasText: "Catering" }).click();
  await page.waitForURL(/category=Catering/);
  // Catering budgets are per plate.
  await expect(panel.getByLabel(/Budget \(per plate\)/)).toBeVisible();
  await panel.getByLabel(/Budget/).selectOption("900");
  await page.waitForURL(/budgetMax=900.*priceUnit=plate|priceUnit=plate.*budgetMax=900/);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("per plate");
  await panel.getByLabel("Guests").fill("300");
  await panel.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/guests=300/);
  await panel.getByLabel("Verified businesses only").check();
  await page.waitForURL(/verified=1/);
  if (isMobile(page)) await checkScreen(page, diag, testInfo, "search-filter-sheet");
  if (isMobile(page)) {
    await panel.getByRole("button", { name: /^Show / }).click();
    await expect(panel).toBeHidden();
  }
  await checkScreen(page, diag, testInfo, "search-filtered-v2");
});

test("search: empty result suggests nearby districts", async ({ page, diag }, testInfo) => {
  // No caterer is based in or travels to Wayanad in the seed; neighbours have one.
  await page.goto("/search?category=Catering&location=Wayanad");
  await expect(page.getByText(/No vendors match/)).toBeVisible();
  const nearby = page.getByRole("list", { name: "Nearby districts" });
  await expect(nearby).toBeVisible();
  await checkScreen(page, diag, testInfo, "search-nearby");
  await nearby.getByRole("link").first().click();
  await page.waitForURL((u) => !u.search.includes("Wayanad"));
  await expect(page.locator('a[href^="/vendors/"]').first()).toBeVisible();
});
