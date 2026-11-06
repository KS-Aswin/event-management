import { test, expect, signUp, runTag, loginAsAdmin, type Creds } from "./helpers";
import type { Page } from "@playwright/test";

// QA round 5 (cross-cutting UI), QA-109 (QA5-UI-1): a customer name that is
// one long unbroken word (allowed: 80 characters max) made /my scroll
// sideways at 390px and 768px. The same name also overflowed the vendor's
// /vendor, /vendor/leads, /vendor/leads/[id] and the admin's
// /admin/users/[id]. Fixed by letting long words wrap (globals.css: body
// overflow-wrap: break-word, headings overflow-wrap: anywhere, plus
// wrap-anywhere on names inside flex rows).

const WIDTHS = [390, 768];

async function expectNoSideScroll(page: Page, path: string, mustShow: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(path);
    await expect(page.locator("main").getByText(mustShow).first()).toBeVisible();
    const { sw, iw, wide } = await page.evaluate(() => ({
      sw: document.scrollingElement!.scrollWidth,
      iw: innerWidth,
      // The elements that stick out, to name them in the failure message.
      wide: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} < ${String(el.parentElement?.className).slice(0, 60)} "${(el.textContent ?? "").slice(0, 40)}"`),
    }));
    expect(sw, `${path} at ${width}px scrolls sideways: ${wide.join(" | ")}`).toBeLessThanOrEqual(iw);
  }
}

test("QA-109 (QA5-UI-1): a long unbroken customer name wraps on customer, vendor and admin pages at 390 and 768", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const tag = runTag(testInfo);
  const longName = `qa5Venkatasubramaniankrishnamoorthyparameswaranpillaithiruvananthapuram${tag}`.slice(0, 80);
  // The first 20 characters are enough to find the name on each page.
  const nameStart = longName.slice(0, 20);

  // Customer: /my greets them by name.
  const customer: Creds = { name: longName, email: `e2e-qa5-ui-longname-${tag}@example.com`, password: "qa5-ui-password-1" };
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "customer", customer);
  await expectNoSideScroll(page, "/my", nameStart);

  // A live vendor (approved straight in the local DB) gets an enquiry from them.
  const vctx = await browser.newContext();
  const v = await vctx.newPage();
  try {
    const vendor: Creds = { name: `qa5 Layout ${tag}`, email: `e2e-qa5-ui-vendor-${tag}@example.com`, password: "e2e-pass-12345" };
    await signUp(v, "vendor", vendor);
    const created = await v.request.post("/api/vendor/listing", { data: { name: `qa5 Layout Studio ${tag}`, primaryCategoryId: 8, districtId: 1 } });
    expect(created.status()).toBe(201);
    const vendorId = (await created.json()).listing.id as number;
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let customerId: number;
    try {
      await client.query("UPDATE vendors SET status = 'approved', published = true WHERE id = $1", [vendorId]);
      const { rows } = await client.query("SELECT id FROM users WHERE email = $1", [customer.email]);
      customerId = rows[0].id as number;
    } finally {
      await client.end();
    }

    const date = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const q = await page.request.post(`/api/vendors/${vendorId}/quotes`, {
      data: { name: longName, phone: "9847055509", preferredContact: "whatsapp", eventDate: date, guestCount: 120, message: "qa5 layout enquiry" },
    });
    expect(q.status(), await q.text()).toBe(201);
    const leadId = (await q.json()).enquiry.id as number;

    await expectNoSideScroll(v, "/vendor", nameStart);
    await expectNoSideScroll(v, "/vendor/leads", nameStart);
    await expectNoSideScroll(v, `/vendor/leads/${leadId}`, nameStart);

    // Admin: the user detail page has the name as its h1.
    const actx = await browser.newContext();
    const a = await actx.newPage();
    try {
      await loginAsAdmin(a, testInfo);
      await expectNoSideScroll(a, `/admin/users/${customerId}`, nameStart);
      // The admin enquiry list prints the same name (truncated in its row).
      await expectNoSideScroll(a, "/admin/enquiries", nameStart);
    } finally {
      await actx.close();
    }
  } finally {
    await vctx.close();
  }
});
