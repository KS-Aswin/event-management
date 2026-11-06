import { test, expect, runTag, signUp, type Creds } from "./helpers";

// QA round 3, vendor group: reproductions of new issues (QA3-V1 = QA-058, fixed).
//
//   QA3-V1 "Create a package from these" ignores prices typed on step 3
//   On onboarding step 3 the vendor types a starting price for each offering
//   and clicks "Create a package from these". The package sheet still lists
//   every unit as "No price yet · off (the package will be marked incomplete)"
//   and none is ticked, so the vendor has to tick them by hand and the new
//   package shows "incomplete: an included unit is off" until Save & continue.

test.describe("qa3 vendor findings", () => {
  let vendor: Creds;

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Vani Qathree ${tag}`, email: `e2e-vendor-qa3-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("QA3-V1: package sheet uses the prices typed on step 3", async ({ page }) => {
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);
    await page.getByLabel("A company or team").check();
    await page.getByLabel("Business name").fill(`Qathree Studio ${vendor.email.slice(0, 20)}`);
    await page.getByLabel("What do you mainly do?").selectOption({ label: "Photography" });
    await page.getByLabel("Home district").selectOption({ label: "Thrissur" });
    await page.getByLabel("Phone for enquiries").fill("9847033333");
    await page.getByLabel("Years of experience").fill("6");
    await page.getByLabel("About your business").fill("Candid wedding photography across Thrissur and Palakkad.");
    await page.getByRole("button", { name: "Create my listing" }).click();
    await expect(page.locator("main h1").first()).toHaveText("What you offer", { timeout: 90_000 });
    await page.getByLabel("Candid photography").check();
    await page.getByLabel("Wedding photography (traditional)").check();
    await page.getByRole("button", { name: "Save & continue" }).click();
    await expect(page.locator("main h1").first()).toHaveText("Prices & packages", { timeout: 90_000 });

    const prices = page.getByLabel(/Starting price/);
    await prices.nth(0).fill("30000");
    await prices.nth(1).fill("35000");
    await page.getByRole("button", { name: "Create a package from these" }).click();

    // Expected: the units now have prices, so they are offered as included (not "off").
    await expect(page.getByText(/the package will be marked incomplete/)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Candid photography/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Wedding photography \(traditional\)/ })).toBeChecked();
    await page.getByLabel("Package name").fill("Wedding photo basic");
    await page.getByLabel("Price (₹)", { exact: true }).fill("60000");
    await page.getByRole("button", { name: "Create package" }).click();
    await expect(page.getByText("Wedding photo basic")).toBeVisible();
    await expect(page.getByText(/incomplete: an included unit is off/)).toHaveCount(0);
  });
});
