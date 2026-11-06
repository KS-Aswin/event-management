import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, signIn, type Creds } from "./helpers";

// QA round qa2 (customer persona). Each test reproduces an open issue and is
// marked test.fail() until it is fixed. Users are created in the LOCAL DB with
// e2e-* emails (removed by the global cleanup).

function client() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("needs a localhost DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

type Fixture = { customer: Creds; listingId: number };

// A customer who already sent one enquiry (Hindu wedding, Ernakulam, 300
// guests, phone saved) to a photography listing whose event is months away.
async function setup(tag: string): Promise<Fixture> {
  const rnd = Math.random().toString(36).slice(2, 7);
  const pw = "e2e-qa2-password-1";
  const vendorEmail = `e2e-vendor-qa2-${tag}-${rnd}@example.com`;
  const customer: Creds = { name: "Qa Two", email: `e2e-customer-qa2-${tag}-${rnd}@example.com`, password: pw };
  const c = client();
  await c.connect();
  try {
    const hash = await bcrypt.hash(pw, 10);
    const vid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ('QA2 Vendor', $1, $2, 'vendor') RETURNING id", [vendorEmail, hash])
    ).rows[0].id;
    const cid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer') RETURNING id", [customer.name, customer.email, hash])
    ).rows[0].id;
    const listingId = (
      await c.query<{ id: number }>(
        `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                              district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
         VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E qa2 listing.', 'approved',
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
                 (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', '+919847012345', 6, now(), now())
         RETURNING id`,
        [vid, `QA2 Lens ${tag}${rnd}`]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, district_id, event_type_id)
       VALUES ($1, $2, $3, '+919847011111', (now() AT TIME ZONE 'Asia/Kolkata')::date + 100, 'E2E qa2 first enquiry', 300,
               (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
               (SELECT id FROM event_types ORDER BY id LIMIT 1))`,
      [listingId, cid, customer.name]
    );
    return { customer, listingId };
  } finally {
    await c.end();
  }
}

test.describe("qa2 customer", () => {
  test("QA2-C01 a second identical enquiry to the same vendor is accepted with no warning", async ({ page }, testInfo) => {
    test.fail();
    const f = await setup(testInfo.workerIndex.toString());
    await signIn(page, f.customer);
    const res = await page.request.post(`/api/vendors/${f.listingId}/quotes`, {
      data: { name: "Qa Two", phone: "+919847011111", eventDate: new Date(Date.now() + 100 * 864e5).toISOString().slice(0, 10), guestCount: 300, message: "again" },
    });
    // Expected: refused (409) or at least a duplicate warning; actual: 201 with warnings [].
    const body = await res.json();
    expect(res.status() !== 201 || (body.warnings ?? []).length > 0).toBe(true);
  });

  test("QA2-C02 single-vendor quote sheet is not prefilled from the customer's earlier enquiry", async ({ page }, testInfo) => {
    test.fail();
    const f = await setup(testInfo.workerIndex.toString());
    await signIn(page, f.customer);
    await page.goto(`/vendors/${f.listingId}`);
    await page.getByRole("button", { name: /Request quote/ }).first().click();
    const d = page.getByRole("dialog");
    await expect(d.getByLabel("Phone number")).not.toHaveValue("");
    await expect(d.getByRole("spinbutton", { name: "Guests" })).toHaveValue("300");
  });

  test("QA2-C03 a review can be posted immediately after enquiring, months before the event", async ({ page }, testInfo) => {
    test.fail();
    const f = await setup(testInfo.workerIndex.toString());
    await signIn(page, f.customer);
    const res = await page.request.post(`/api/vendors/${f.listingId}/reviews`, { data: { rating: 1, body: "QA2 review before the event" } });
    // Expected: refused until the booked event has happened; actual: 201 and it counts in the rating.
    expect(res.status()).not.toBe(201);
  });

  test("QA2-C04 'Price: low to high' lists 'Price on request' vendors first", async ({ page }, testInfo) => {
    test.fail();
    await setup(testInfo.workerIndex.toString());
    await page.goto("/search?sort=priceLow");
    await expect(page.getByText(/\d+ vendors found/)).toBeVisible();
    const text = await page.locator("main").innerText();
    const results = text.slice(text.search(/\d+ vendors found/));
    const firstPrice = results.match(/₹[\d,]+|Price on request/)?.[0];
    expect(firstPrice).not.toBe("Price on request");
  });
});
