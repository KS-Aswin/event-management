import { test, expect, checkScreen, runTag, signUp, signIn, signOut, type Creds } from "./helpers";

// End-to-end account flows. Each project (width) creates its own unique
// vendor and customer; global-setup.ts deletes them again after the run.

// Ordered but not serial: a failed screen check in one step must not skip the
// rest. State that later steps need is re-derived when a worker restarts.
test.describe("vendor and customer journey", () => {
  let tag = "";
  let vendor: Creds;
  let customer: Creds;
  let vendorPath = "";
  const business = () => `E2E Studio ${tag}`;

  async function listingPath(page: import("@playwright/test").Page) {
    if (vendorPath) return vendorPath;
    await page.goto(`/search?q=${encodeURIComponent(business())}`);
    vendorPath = (await page.locator('main a[href^="/vendors/"]').first().getAttribute("href")) ?? "";
    return vendorPath;
  }

  test.beforeAll(({}, testInfo) => {
    tag = runTag(testInfo);
    vendor = { name: `Vera Vendor ${tag}`, email: `e2e-vendor-${tag}@example.com`, password: "e2e-pass-12345" };
    customer = { name: `Cara Customer ${tag}`, email: `e2e-customer-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  // P0 wave 1: vendors now land in the /vendor workspace. The onboarding
  // wizard, offerings and leads pages arrive in wave 2, so until then the
  // listing is created through the API and only the shipped pages are checked.
  test("vendor signs up and lands in the workspace", async ({ page }) => {
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/vendor(\/|\?|$)/);
    // The customer area is off-limits for vendors.
    await page.goto("/my");
    await expect(page).toHaveURL(/\/vendor(\/|\?|$)/);
  });

  test("vendor creates a listing", async ({ page }) => {
    await signIn(page, vendor);
    const res = await page.request.post("/api/vendors", {
      data: {
        name: business(),
        category: "Photography",
        location: "Kochi",
        phone: "9876543210",
        price: 25000,
        experience: "5 yrs",
        about: "Automated e2e listing for testing the Vela flows.",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const id = body.vendor?.id ?? body.id;
    expect(typeof id).toBe("number");
    vendorPath = `/vendors/${id}`;
  });

  test("vendor workspace pages render", async ({ page, diag }, testInfo) => {
    await signIn(page, vendor);
    for (const [path, name] of [["/vendor/reviews", "vendor-reviews"], ["/vendor/settings", "vendor-settings"]] as const) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      await checkScreen(page, diag, testInfo, name);
    }
    // Old dashboard links move permanently to the workspace.
    await page.goto("/dashboard/services");
    await expect(page).toHaveURL(/\/vendor\/offerings/);
  });

  test("vendor signs out", async ({ page }) => {
    await signIn(page, vendor);
    await page.goto("/");
    await signOut(page);
  });

  test("customer signs up, favourites and requests a quote", async ({ page, diag }, testInfo) => {
    await signUp(page, "customer", customer);
    await page.goto("/dashboard");
    await checkScreen(page, diag, testInfo, "dashboard-customer-empty");

    // The new listing is searchable.
    await page.goto(`/search?q=${encodeURIComponent(business())}`);
    await expect(page.getByText(business()).first()).toBeVisible();

    await page.goto(await listingPath(page));
    await expect(page.locator("h1")).toHaveText(business());
    await page.getByRole("button", { name: "Save to favorites" }).first().click();
    await expect(page.getByRole("button", { name: "Remove from favorites" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Request quote" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Your name")).toHaveValue(customer.name);
    await dialog.getByLabel("Phone number").fill("9876543210");
    const d = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await dialog.getByLabel("Event date").fill(d);
    await dialog.getByLabel("Budget (₹)").fill("50000");
    await dialog.getByLabel("Message").fill(`E2E run ${tag}: wedding in Kochi`);
    await checkScreen(page, diag, testInfo, "quote-dialog-filled");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByRole("status")).toContainText("Quote request sent");
    await checkScreen(page, diag, testInfo, "quote-sent");
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.goto("/dashboard");
    await expect(page.getByText(business()).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your favorites" })).toBeVisible();
    await checkScreen(page, diag, testInfo, "dashboard-customer");
  });

  test("customer updates settings and signs out", async ({ page, diag }, testInfo) => {
    await signIn(page, customer);
    await page.goto("/settings");
    await checkScreen(page, diag, testInfo, "settings");
    const nameBox = page.getByLabel("Full name");
    await nameBox.fill(`${customer.name} Updated`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(page.getByText("Settings saved")).toBeVisible();
    customer.name = `${customer.name} Updated`;
    await signOut(page);
  });

  // Wave 2 (P0-15) brings the /vendor/leads page; re-enable the UI check then.
  test.fixme("vendor sees the lead and changes its status", async ({ page, diag }, testInfo) => {
    await signIn(page, vendor);
    await page.goto("/vendor/leads");
    const status = page.getByRole("combobox", { name: /Status of enquiry from/ }).first();
    await expect(status).toBeVisible();
    await checkScreen(page, diag, testInfo, "vendor-leads");
    await status.selectOption("responded");
    await page.reload();
    await expect(page.getByRole("combobox", { name: /Status of enquiry from/ }).first()).toHaveValue("responded");
  });
});
