import { test, expect, runTag, signUp, type Creds } from "./helpers";

// QA round 1, vendor group UI checks (event-management-qa-tracker.md):
//   QA-013 "Block a range" with To before From shows an inline error
//   QA-032 profile edit blocks an About under 30 characters
// The API side of these (and QA-002/004/014/030/033/034) is in
// tests/qa1-vendor.test.mjs.

const istDay = (plusDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + plusDays * 86_400_000));

test.describe("qa1 vendor fixes", () => {
  let vendor: Creds;

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Quinn Qafix ${tag}`, email: `e2e-vendor-qa1fix-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("calendar range: To before From is an inline error; profile About needs 30 characters", async ({ page }) => {
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);
    // A listing to work on (the legacy one-form create makes a draft).
    const res = await page.request.post("/api/vendors", {
      data: {
        name: `Qafix Studio ${vendor.email.slice(0, 24)}`,
        category: "Photography",
        location: "Kochi",
        price: 25000,
        experience: "3 yrs",
        about: "Automated e2e listing for the qa1 vendor fixes.",
      },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).vendor.status).toBe("draft");

    // QA-013
    await page.goto("/vendor/calendar");
    const range = page.locator("section", { has: page.getByRole("heading", { name: "Block a range" }) });
    await range.getByLabel("From").fill(istDay(30));
    await range.getByLabel("To").fill(istDay(20));
    await range.getByRole("button", { name: "Block dates" }).click();
    await expect(range.getByRole("alert")).toHaveText("The end date must be on or after the start date.");
    await expect(range.getByLabel("To")).toHaveAttribute("aria-invalid", "true");
    // Fixing the date clears the error.
    await range.getByLabel("To").fill(istDay(31));
    await expect(range.getByRole("alert")).toHaveCount(0);

    // QA-032
    await page.goto("/vendor/profile");
    const about = page.getByLabel("About your business");
    await about.fill("too short");
    await page.locator("form#about").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#pf-about-err")).toContainText("at least 30 characters");
    await expect(about).toHaveAttribute("aria-invalid", "true");
  });
});
