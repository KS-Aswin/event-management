import { test, expect, runTag, signUp, type Creds } from "./helpers";

// QA round 5, vendor group: repro specs for issues found in qa5 (not run by the
// tester; marked test.fail until fixed).
//
//   QA5-V1 Live listing, a package whose only other units are gone: deleting the
//          last unit inside the package. The confirm says "deleting removes it
//          from that package", then the server refuses with "customers need at
//          least one priced offering or package they can book on its own. Add or
//          turn on another one first", although a priced, bookable package is
//          right there. Nothing says the package would be left empty.
//   QA5-V2 Offer builder: a new line defaults to unit "event", so the customer
//          sees "2 event × ₹4,500.50" (no plural, wrong unit for an album).
//   QA5-V3 A rejected listing: "Edit and resubmit" opens step 6, which shows the
//          admin's note only for changes_requested, not the reject reason.

async function db() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function onboardOneUnitWithPackage(page: import("@playwright/test").Page, tag: string) {
  const vendor: Creds = { name: `qa5 Vani ${tag}`, email: `e2e-qa5-vendor-${tag}@example.com`, password: "e2e-pass-12345" };
  await signUp(page, "vendor", vendor);
  await page.getByLabel("An individual").check();
  await page.getByLabel("Name customers know you by").fill(`qa5 Lens ${tag}`);
  await page.getByLabel("What do you mainly do?").selectOption({ label: "Photography" });
  await page.getByLabel("Home district").selectOption({ label: "Thrissur" });
  await page.getByLabel("Phone for enquiries").fill("9847051234");
  await page.getByLabel("Years of experience").fill("5");
  await page.getByLabel("About your business").fill("Candid wedding photography across Thrissur and Palakkad.");
  await page.getByRole("button", { name: "Create my listing" }).click();
  await expect(page.locator("main h1").first()).toHaveText("What you offer", { timeout: 90_000 });
  await page.getByLabel("Candid photography").check();
  await page.getByLabel("Engagement shoot").check();
  await page.getByRole("button", { name: "Save & continue" }).click();
  await expect(page.locator("main h1").first()).toHaveText("Prices & packages", { timeout: 90_000 });
  const prices = page.getByLabel(/Starting price/);
  await prices.nth(0).fill("30000");
  await prices.nth(1).fill("15000");
  await page.getByRole("button", { name: "Create a package from these" }).click();
  await page.getByLabel("Package name").fill("qa5 Full day");
  await page.getByLabel("Price (₹)", { exact: true }).fill("40000");
  await page.getByRole("button", { name: "Create package" }).click();
  await expect(page.getByText("qa5 Full day").first()).toBeVisible();
  const listing = await (await page.request.get("/api/vendor/listing")).json();
  const vendorId = listing.listing.id as number;
  const c = await db();
  try {
    await c.query("UPDATE vendors SET status = 'approved', published = true WHERE id = $1", [vendorId]);
  } finally {
    await c.end();
  }
  return { vendor, vendorId };
}

test.describe("qa5 vendor findings", () => {
  test.fail("QA-103 (QA5-V1): deleting the last unit of a live package explains the package, not a missing offering", async ({ page }, testInfo) => {
    await onboardOneUnitWithPackage(page, runTag(testInfo));
    await page.goto("/vendor/offerings");
    // Delete Engagement shoot (allowed: Candid + package remain).
    const eng = page.locator("main li").filter({ has: page.getByRole("link", { name: "Engagement shoot", exact: true }) });
    await eng.getByRole("button", { name: "Delete" }).click();
    await page.locator("dialog[open], [role=alertdialog]").last().getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Engagement shoot was deleted/).first()).toBeVisible();
    // Now Candid photography is the only unit, and the priced package includes it.
    const candid = page.locator("main li").filter({ has: page.getByRole("link", { name: "Candid photography", exact: true }) });
    await candid.getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator("dialog[open], [role=alertdialog]").last();
    await dialog.getByRole("button", { name: "Delete" }).click();
    // Expected: the refusal (or the confirm) names the package that would be left empty.
    await expect(page.locator("main [role=alert]").filter({ hasText: /qa5 Full day|package would be empty|last unit/ })).toBeVisible();
  });

  test.fail("QA-104 (QA5-V2): an extra offer line doesn't read '2 event ×' to the customer", async ({ page, browser }, testInfo) => {
    const { vendorId } = await onboardOneUnitWithPackage(page, `${runTag(testInfo)}o`);
    const guest = await browser.newContext();
    const g = await guest.newPage();
    const date = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const q = await g.request.post(`/api/vendors/${vendorId}/quotes`, {
      data: { name: "qa5 Guest", contactEmail: `e2e-qa5-guest-${runTag(testInfo)}@example.com`, phone: "9847055501", preferredContact: "whatsapp", eventDate: date, guestCount: 100, message: "qa5 spec enquiry" },
    });
    expect(q.status()).toBe(201);
    const tracking = (await q.json()).enquiry.trackingPath as string;
    await page.goto("/vendor/leads");
    await page.getByRole("link", { name: "qa5 Guest" }).first().click();
    await page.getByRole("button", { name: /Build an itemised offer/ }).click();
    await page.getByLabel("Item 1").fill("Candid coverage");
    await page.getByLabel("Price per unit (₹)").first().fill("30000");
    await page.getByRole("button", { name: "+ Add a line" }).click();
    await page.getByLabel("Item 2").fill("Album 40 pages");
    await page.getByLabel("Qty").nth(1).fill("2");
    await page.getByLabel("Price per unit (₹)").nth(1).fill("4500");
    await page.getByLabel("Valid until").fill(new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Send offer" }).click();
    await expect(page.getByText("Send a revised offer (v2)")).toBeVisible();
    await g.goto(tracking);
    await expect(g.getByText(/Album 40 pages/)).toBeVisible();
    await expect(g.getByText(/\b2 event ×/)).toHaveCount(0);
    await guest.close();
  });

  test.fail("QA-105 (QA5-V3): a rejected listing's resubmit step shows the reject reason", async ({ page }, testInfo) => {
    const { vendorId } = await onboardOneUnitWithPackage(page, `${runTag(testInfo)}r`);
    const c = await db();
    try {
      await c.query("UPDATE vendors SET status = 'rejected', published = false, status_reason = 'qa5: duplicate of another listing' WHERE id = $1", [vendorId]);
    } finally {
      await c.end();
    }
    await page.goto("/vendor");
    await expect(page.getByText("qa5: duplicate of another listing")).toBeVisible();
    await page.getByRole("link", { name: "Edit and resubmit" }).click();
    await expect(page.getByRole("button", { name: "Resubmit for review" })).toBeVisible();
    await expect(page.locator("main").getByText("qa5: duplicate of another listing")).toBeVisible();
  });
});
