import { test, expect, runTag, signUp, type Creds } from "./helpers";

// QA round 4, vendor group: reproductions of new issues. Marked test.fail until
// fixed. Not run during qa4 (the Playwright webServer/teardown would disturb the
// parallel testers).
//
//   QA4-V1 Lead page: after "Send message" the header badge flips to "Replied"
//          but the Status <select> keeps showing "New" until a reload.
//   QA4-V2 Deleting an offering that is inside a package: the delete dialog does
//          not warn, the package silently becomes "Incomplete" (hidden from
//          customers), and the copy says "one of its units is off" although no
//          unit is off. Saving the package unchanged clears it.
//   QA4-V3 "Updates from Vela": unread count includes notifications that can't
//          be opened anywhere (home shows 6, bell shows 15, no full list).

async function approvedVendorWithLead(page: import("@playwright/test").Page, tag: string) {
  const vendor: Creds = { name: `qa4 Vani ${tag}`, email: `e2e-qa4-vendor-spec-${tag}@example.com`, password: "e2e-pass-12345" };
  await signUp(page, "vendor", vendor);
  const created = await page.request.post("/api/vendor/listing", { data: { name: `qa4 Spec Studio ${tag}`, primaryCategoryId: 8, districtId: 1 } });
  expect(created.status()).toBe(201);
  const vendorId = (await created.json()).listing.id as number;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("UPDATE vendors SET status = 'approved', published = true WHERE id = $1", [vendorId]);
  } finally {
    await client.end();
  }
  return { vendor, vendorId };
}

test.describe("qa4 vendor findings", () => {
  test("QA4-V1: lead Status select follows the Replied badge after sending a message", async ({ page, browser }, testInfo) => {
    test.fail(true, "QA4-V1 open");
    const tag = runTag(testInfo);
    const { vendorId } = await approvedVendorWithLead(page, tag);
    // A guest enquiry from a separate context.
    const guest = await browser.newContext();
    const g = await guest.newPage();
    const date = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const q = await g.request.post(`/api/vendors/${vendorId}/quotes`, {
      data: { name: "qa4 Guest", contactEmail: `e2e-qa4-guest-${tag}@example.com`, phone: "9847055555", preferredContact: "whatsapp", eventDate: date, guestCount: 100, message: "qa4 spec enquiry" },
    });
    expect(q.status()).toBe(201);
    await guest.close();

    await page.goto("/vendor/leads");
    await page.getByRole("link", { name: "qa4 Guest" }).first().click();
    const status = page.getByLabel(/^Status of enquiry/);
    await expect(status).toHaveValue("pending");
    await page.getByLabel(/^Reply to/).fill("qa4: thanks, checking availability.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("main").getByText("Replied").first()).toBeVisible();
    // Expected: the select agrees with the header without a reload.
    await expect(status).toHaveValue("responded", { timeout: 5_000 });
  });

  test("QA4-V2: deleting an offering inside a package warns and does not blame an 'off' unit", async ({ page }, testInfo) => {
    test.fail(true, "QA4-V2 open");
    const tag = runTag(testInfo);
    // Precondition (as in the qa4 run): a vendor with two priced units, Candid
    // photography and Wedding photography (traditional), and one package that
    // includes both, created through onboarding step 3 "Create a package from these".
    const vendor: Creds = { name: `qa4 Vani ${tag}`, email: `e2e-qa4-vendor-pkg-${tag}@example.com`, password: "e2e-pass-12345" };
    await signUp(page, "vendor", vendor);
    await page.getByLabel("A company or team").check();
    await page.getByLabel("Business name").fill(`qa4 Pkg Studio ${tag}`);
    await page.getByLabel("What do you mainly do?").selectOption({ label: "Photography" });
    await page.getByLabel("Home district").selectOption({ label: "Thrissur" });
    await page.getByLabel("Phone for enquiries").fill("9847044444");
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
    await page.getByLabel("Package name").fill("qa4 Wedding day full cover");
    await page.getByLabel("Price (₹)", { exact: true }).fill("60000");
    await page.getByRole("button", { name: "Create package" }).click();
    await expect(page.getByText("qa4 Wedding day full cover").first()).toBeVisible();

    await page.goto("/vendor/offerings");
    const card = page.locator("main li, main article, main div").filter({ hasText: /^Candid photography/ }).last();
    await card.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog").or(page.locator("dialog[open]"));
    // Expected: the confirm says the package will be hidden / changed.
    await expect(dialog).toContainText(/qa4 Wedding day full cover|package/);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("tab", { name: /Packages/ }).click();
    // Observed: "Packages marked Incomplete include a unit that is off" though no unit is off.
    await expect(page.getByText(/include a unit that is off/)).toHaveCount(0);
  });

  test.skip("QA4-V3: every unread notification can be opened somewhere", async () => {
    // Manual repro (local): give a vendor more than 15 notifications (e.g. 3 rounds of admin
    // suspend/unsuspend plus enquiries). /vendor 'Updates from Vela' says '18 unread' but lists
    // 6, the bell lists 15, and there is no 'See all' page; the oldest are unreachable.
  });
});
