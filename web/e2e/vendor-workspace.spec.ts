import path from "node:path";
import { test, expect, checkScreen, isMobile, runTag, signUp, type Creds } from "./helpers";
import type { Page } from "@playwright/test";

// P0 vendor workspace (docs/PRODUCT_PLAN.md section 8, P0-16): onboarding
// wizard to submit, media manager, the 2.6 redirect table, the public
// profile (gallery, lightbox, offerings) and the vendor nav at 390px.
// Photos come from db/fixtures/media (generated, license-free).

const FIXTURES = path.resolve(__dirname, "..", "db", "fixtures", "media");
const fx = (name: string) => path.join(FIXTURES, name);
const GALLERY = ["thrissur-tent-and-rentals-1.jpg", "thrissur-tent-and-rentals-2.jpg", "thrissur-tent-and-rentals-3.jpg"].map(fx);
const COVER = fx("thrissur-tent-and-rentals-cover.jpg");

async function heading(page: Page, text: string | RegExp) {
  await expect(page.locator("main h1").first()).toHaveText(text, { timeout: 90_000 });
}

/** Status and Location of a GET without following redirects. */
async function peek(page: Page, url: string) {
  const res = await page.request.get(url, { maxRedirects: 0 });
  const loc = res.headers()["location"];
  return { status: res.status(), path: loc ? new URL(loc, "http://x").pathname + new URL(loc, "http://x").search : null };
}

test.describe("vendor onboarding wizard", () => {
  let vendor: Creds;
  let business = "";

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Wendy Wizard ${tag}`, email: `e2e-vendor-wiz-${tag}@example.com`, password: "e2e-pass-12345" };
    business = `E2E Events ${tag}`;
  });

  test("vendor signs up, completes every step and submits for review", async ({ page, diag }, testInfo) => {
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);

    // 1. About you
    await heading(page, "About you");
    await checkScreen(page, diag, testInfo, "wizard-1-about");
    await page.getByLabel("A company or team").check();
    await page.getByLabel("Business name").fill(business);
    await page.getByLabel("What do you mainly do?").selectOption({ label: "Event Management" });
    await page.getByLabel("Home district").selectOption({ label: "Ernakulam" });
    await page.getByLabel("Phone for enquiries").fill("9847011111");
    await page.getByLabel("Years of experience").fill("8");
    await page.getByLabel("About your business").fill("Full wedding planning across Ernakulam and Thrissur, from mandapam to sadhya.");
    await page.getByRole("button", { name: "Create my listing" }).click();

    // 2. What you offer: two units, the second one package-only.
    await heading(page, "What you offer");
    await page.getByLabel("Full planning & coordination").check();
    await page.getByLabel("Wedding photography (traditional)").check();
    await page.getByText("Package only").last().click();
    await checkScreen(page, diag, testInfo, "wizard-2-offer");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // Resume: a reload comes back to the saved step.
    await heading(page, "Prices & packages");
    await page.goto("/vendor/onboarding");
    await heading(page, "Prices & packages");

    // 3. Prices and a package
    const prices = page.getByLabel(/Starting price/);
    await expect(prices.first()).toBeVisible();
    const n = await prices.count();
    for (let i = 0; i < n; i++) await prices.nth(i).fill(String(50000 + i * 10000));
    await page.getByRole("button", { name: "Create a package from these" }).click();
    await page.getByLabel("Package name").fill("Wedding basic");
    await page.getByLabel("Price (₹)", { exact: true }).fill("150000");
    await page.getByRole("button", { name: "Create package" }).click();
    await expect(page.getByText("Wedding basic").first()).toBeVisible({ timeout: 30_000 });
    await checkScreen(page, diag, testInfo, "wizard-3-prices");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // 4. Where you work
    await heading(page, "Where you work");
    await checkScreen(page, diag, testInfo, "wizard-4-areas");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // 5. Photos: skip at first, so submit is blocked.
    await heading(page, "Photos & videos");
    await page.getByRole("button", { name: /^Continue/ }).click();
    await heading(page, "Review & submit");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("A few things are still missing")).toBeVisible({ timeout: 30_000 });
    // The blocked submit is a 400 the page handles; the browser still logs it.
    await checkScreen(page, diag, testInfo, "wizard-6-blocked", { ignoreErrors: [/status of 400.*listing\/submit/] });

    // Fix: cover + 3 photos.
    await page.getByRole("button", { name: "Fix" }).first().click();
    await heading(page, "Photos & videos");
    await page.getByLabel(/These are photos of my own work/).check();
    const inputs = page.locator('main input[type="file"]');
    await inputs.nth(1).setInputFiles(COVER);
    await expect(page.getByRole("img", { name: "Cover photo" })).toBeVisible({ timeout: 90_000 });
    await inputs.nth(2).setInputFiles(GALLERY);
    await expect(page.locator("main figure img")).toHaveCount(3, { timeout: 120_000 });
    await expect(page.getByText("3 uploaded")).toBeVisible();
    await checkScreen(page, diag, testInfo, "wizard-5-photos");
    await page.getByRole("button", { name: /^Continue/ }).click();

    // 6. Review & submit
    await heading(page, "Review & submit");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Your listing is under review")).toBeVisible({ timeout: 30_000 });
    await checkScreen(page, diag, testInfo, "wizard-6-submitted");

    const listing = await (await page.request.get("/api/vendor/listing")).json();
    expect(listing.listing.status).toBe("pending");
    // Pending listings are not public.
    const search = await (await page.request.get(`/api/vendors?q=${encodeURIComponent(business)}`)).json();
    expect((search.vendors ?? []).some((v: { name: string }) => v.name === business)).toBe(false);
  });
});

test.describe("vendor media manager", () => {
  let vendor: Creds;
  let tag = "";

  test.beforeAll(({}, testInfo) => {
    tag = runTag(testInfo);
    vendor = { name: `Mira Media ${tag}`, email: `e2e-vendor-media-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("upload 3 photos, album, cover, reorder and delete show in the preview", async ({ page, diag }, testInfo) => {
    await signUp(page, "vendor", vendor);
    const tax = await (await page.request.get("/api/meta/taxonomy")).json();
    const created = await page.request.post("/api/vendor/listing", {
      data: {
        name: `E2E Rentals ${tag}`,
        vendorType: "company",
        primaryCategoryId: tax.categories.find((c: { slug: string }) => c.slug === "rental").id,
        districtId: tax.districts.find((d: { name: string }) => d.name === "Thrissur").id,
        phone: "9847022222",
      },
    });
    expect(created.status()).toBe(201);
    const vendorId: number = (await created.json()).listing.id;

    await page.goto("/vendor/media");
    await heading(page, /Photos|Media/);
    await expect(page.getByText("No photos yet")).toBeVisible({ timeout: 60_000 });
    await checkScreen(page, diag, testInfo, "media-empty");

    // Upload 3 (consent first).
    await page.getByLabel(/I have my clients.? permission/).check();
    await page.getByTestId("media-input-gallery").setInputFiles(GALLERY);
    const tiles = page.getByTestId("media-tile");
    await expect(tiles).toHaveCount(3, { timeout: 120_000 });

    // Cover
    await page.getByTestId("media-input-cover").setInputFiles(COVER);
    await expect(page.getByRole("img", { name: "Your cover photo" })).toBeVisible({ timeout: 90_000 });

    // Album: create it, then move the first photo into it.
    await page.getByRole("button", { name: "+ New album" }).click();
    await page.getByLabel("Album name").fill("Wedding pandals");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Wedding pandals \(0\)/ })).toBeVisible();
    await page.getByRole("button", { name: /^All \(/ }).click();
    await tiles.first().getByRole("button", { name: /^Edit / }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Album").selectOption({ label: "Wedding pandals" });
    await sheet.getByLabel("Caption").fill("Pandal for 300 guests");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: /^Wedding pandals \(1\)/ })).toBeVisible();

    // Reorder: move the first photo one place later.
    const order = () => tiles.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-media-id"))));
    const before = await order();
    await page.getByRole("button", { name: "Move Pandal for 300 guests later" }).click();
    await expect.poll(order).toEqual([before[1], before[0], before[2]]);

    // Delete the last photo (in-page confirm, no browser dialog).
    const doomed = before[2];
    await page.locator(`[data-media-id="${doomed}"]`).getByRole("button", { name: /^Edit / }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete photo" }).click();
    await expect(tiles).toHaveCount(2);
    await checkScreen(page, diag, testInfo, "media-manager");

    // The owner's preview shows the same state.
    await page.goto(`/vendors/${vendorId}`);
    await expect(page.locator("h1")).toHaveText(`E2E Rentals ${tag}`);
    await expect(page.getByText(/Preview, not public yet/i).first()).toBeVisible();
    const photos = page.getByRole("button", { name: /^Open photo \d/ });
    await expect(photos).toHaveCount(2);
    await expect(photos.nth(1)).toHaveAccessibleName(/Pandal for 300 guests/);
    await expect(page.getByRole("group", { name: "Gallery filter" }).getByRole("button", { name: /Wedding pandals \(1\)/ })).toBeVisible();
    const lib = await (await page.request.get("/api/vendor/media")).json();
    expect(lib.coverMediaId).not.toBeNull();
    expect(lib.assets.some((a: { id: number }) => a.id === doomed)).toBe(false);
    await checkScreen(page, diag, testInfo, "media-preview");
  });
});

test.describe("public vendor profile", () => {
  async function openSeeded(page: Page, name: string) {
    await page.goto(`/search?q=${encodeURIComponent(name)}`);
    const card = page.locator('main a[href^="/vendors/"]').filter({ hasText: name }).first();
    await expect(card).toBeVisible();
    return card;
  }

  test("search card uses the cover photo", async ({ page }) => {
    await openSeeded(page, "Kerala Celebrations Co.");
    const article = page.locator("main article").filter({ hasText: "Kerala Celebrations Co." }).first();
    await expect(article.locator('img[src*="/media/"]').first()).toBeVisible();
  });

  test("gallery, lightbox and offerings with sale badges", async ({ page, diag }, testInfo) => {
    const card = await openSeeded(page, "Kerala Celebrations Co.");
    await page.goto((await card.getAttribute("href"))!);
    await expect(page.locator("h1")).toHaveText("Kerala Celebrations Co.");

    // Offerings grouped by unit, with prices and badges.
    await expect(page.getByText("Bookable separately").first()).toBeVisible();
    await expect(page.getByText("Package only").first()).toBeVisible();
    await expect(page.getByText("Signature wedding package").first()).toBeVisible();
    await expect(page.getByText(/₹25,000/).first()).toBeVisible();

    // Gallery + album chip + lightbox with keyboard.
    await expect(page.getByRole("group", { name: "Gallery filter" })).toBeVisible();
    await page.getByRole("button", { name: /^Open photo 1/ }).click();
    await expect(page.getByRole("dialog", { name: /^Photo 1 of \d/ })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const viewer = page.getByRole("dialog", { name: /^Photo 2 of \d/ });
    await expect(viewer).toBeVisible();
    await checkScreen(page, diag, testInfo, "profile-lightbox");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /^Photo \d+ of/ })).toBeHidden();
    await checkScreen(page, diag, testInfo, "profile-seeded");
  });

  test("a video link loads only when tapped", async ({ page }) => {
    const card = await openSeeded(page, "Studio Frames by Arun");
    await page.goto((await card.getAttribute("href"))!);
    await page.getByRole("button", { name: /^Videos \(1\)/ }).click();
    await expect(page.getByRole("button", { name: /^Play .*\(loads YouTube\)/i })).toBeVisible();
    await expect(page.locator('iframe[src*="youtube"]')).toHaveCount(0);
  });
});

test.describe("role redirects (PRODUCT_PLAN 2.6)", () => {
  let vendor: Creds;
  let customer: Creds;

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Rhea Redirect ${tag}`, email: `e2e-vendor-redir-${tag}@example.com`, password: "e2e-pass-12345" };
    customer = { name: `Cyril Redirect ${tag}`, email: `e2e-customer-redir-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("signed out: workspace pages go to login with next, admin is 404", async ({ page }) => {
    expect(await peek(page, "/vendor")).toEqual({ status: 307, path: "/login?next=%2Fvendor" });
    expect(await peek(page, "/vendor/media")).toEqual({ status: 307, path: "/login?next=%2Fvendor%2Fmedia" });
    expect(await peek(page, "/my")).toEqual({ status: 307, path: "/login?next=%2Fmy" });
    expect((await peek(page, "/admin")).status).toBe(404);
  });

  test("vendor: legacy dashboard links, /my and /admin", async ({ page }) => {
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);
    const table: [string, string][] = [
      ["/dashboard", "/vendor"],
      ["/dashboard/create-listing", "/vendor/onboarding"],
      ["/dashboard/edit-listing", "/vendor/profile"],
      ["/dashboard/services", "/vendor/offerings"],
      ["/dashboard/leads", "/vendor/leads"],
      ["/my", "/vendor"],
      ["/my/shortlist", "/vendor"],
    ];
    for (const [from, to] of table) {
      const r = await peek(page, from);
      expect([307, 308], `${from} status`).toContain(r.status);
      expect(r.path, `${from} target`).toBe(to);
    }
    expect((await peek(page, "/admin")).status).toBe(404);
    // Public pages stay open to vendors.
    expect((await peek(page, "/search")).status).toBe(200);
  });

  test("customer: vendor workspace is off-limits", async ({ page }) => {
    await signUp(page, "customer", customer);
    for (const p of ["/vendor", "/vendor/media", "/vendor/leads"]) {
      const r = await peek(page, p);
      expect([307, 308], `${p} status`).toContain(r.status);
      expect(r.path ?? "", `${p} target`).not.toMatch(/^\/vendor/);
    }
    expect((await peek(page, "/admin")).status).toBe(404);
    const api = await page.request.get("/api/vendor/media");
    expect(api.status()).toBe(403);
  });
});

test.describe("vendor navigation", () => {
  let vendor: Creds;

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Navin Nav ${tag}`, email: `e2e-vendor-nav-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("workspace nav reaches every section", async ({ page, diag }, testInfo) => {
    await signUp(page, "vendor", vendor);
    // Until the listing exists the shell is in onboarding mode (no nav).
    const tax = await (await page.request.get("/api/meta/taxonomy")).json();
    const created = await page.request.post("/api/vendor/listing", {
      data: {
        name: `E2E Chenda ${vendor.email.slice(15, 25)}`,
        vendorType: "company",
        primaryCategoryId: tax.categories.find((c: { slug: string }) => c.slug === "traditional-music").id,
        districtId: tax.districts.find((d: { name: string }) => d.name === "Thrissur").id,
        phone: "9847033333",
      },
    });
    expect(created.status()).toBe(201);
    await page.goto("/vendor");
    await expect(page.locator("main h1").first()).toBeVisible({ timeout: 90_000 });
    const nav = page.getByRole("navigation", { name: "Workspace" }).filter({ visible: true }).first();
    await expect(nav).toBeVisible();
    await checkScreen(page, diag, testInfo, "vendor-home");

    for (const [label, url] of [
      [/^Leads/, /\/vendor\/leads$/],
      [/^Offerings/, /\/vendor\/offerings$/],
      [/^Media$/, /\/vendor\/media$/],
    ] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator("main h1").first()).toBeVisible();
      await checkScreen(page, diag, testInfo, `vendor-nav-${String(url).replace(/\W+/g, "-")}`);
    }

    if (isMobile(page)) {
      // Bottom tab bar: Home, Leads, Offerings, Media, More.
      await nav.getByRole("button", { name: "More" }).click();
      const sheet = page.getByRole("dialog", { name: "More workspace pages" });
      await expect(sheet).toBeVisible();
      await checkScreen(page, diag, testInfo, "vendor-nav-more");
      await sheet.getByRole("link", { name: /Profile/ }).click();
    } else {
      await nav.getByRole("link", { name: /Profile/ }).click();
    }
    await expect(page).toHaveURL(/\/vendor\/profile$/);
    await expect(page.locator("main h1").first()).toBeVisible();
    await checkScreen(page, diag, testInfo, "vendor-profile-form");
  });
});
