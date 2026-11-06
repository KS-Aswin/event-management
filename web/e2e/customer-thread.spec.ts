import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, checkScreen, runTag, signIn, type Creds } from "./helpers";

// P2-4 / P2-5 / P2-13: a vendor answers a lead with a message and an
// itemised offer; the customer sees the bell, the enquiry list and the
// thread, accepts the offer, replies and marks it booked. Users are created
// straight in the LOCAL DB with e2e-* emails (removed by the global cleanup).

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

type Fixture = { vendor: Creds; customer: Creds; vendorName: string; leadId: number };

async function setup(tag: string): Promise<Fixture> {
  const rnd = Math.random().toString(36).slice(2, 7);
  const vendor: Creds = { name: "Thread Vendor", email: `e2e-vendor-thread-${tag}-${rnd}@example.com`, password: "e2e-thread-password-1" };
  const customer: Creds = { name: "Anu Thomas", email: `e2e-customer-thread-${tag}-${rnd}@example.com`, password: "e2e-thread-password-1" };
  const vendorName = `Lens Thread ${tag}${rnd}`;
  const c = client();
  await c.connect();
  try {
    const hash = await bcrypt.hash(vendor.password, 10);
    const vid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'vendor') RETURNING id", [
        vendor.name,
        vendor.email,
        hash,
      ])
    ).rows[0].id;
    const cid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer') RETURNING id", [
        customer.name,
        customer.email,
        hash,
      ])
    ).rows[0].id;
    const listing = (
      await c.query<{ id: number }>(
        `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                              district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
         VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E thread listing.', 'approved',
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
                 (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', '+919847012345', 6, now(), now())
         RETURNING id`,
        [vid, vendorName]
      )
    ).rows[0].id;
    const svc = (
      await c.query<{ id: number }>(
        `INSERT INTO services (vendor_id, category_id, title, price_from, price_unit)
         VALUES ($1, (SELECT id FROM categories WHERE name = 'Photography'), 'Candid photography', 45000, 'event') RETURNING id`,
        [listing]
      )
    ).rows[0].id;
    const leadId = (
      await c.query<{ id: number }>(
        `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, district_id)
         VALUES ($1, $2, $3, '+919999922222', (now() AT TIME ZONE 'Asia/Kolkata')::date + 40, 'E2E run thread: wedding photos please', 250,
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1))
         RETURNING id`,
        [listing, cid, customer.name]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO quote_request_services (quote_request_id, service_id, qty, snapshot)
       VALUES ($1, $2, 1, jsonb_build_object('title', 'Candid photography', 'kind', 'unit', 'price_from', 45000, 'price_mode', 'from', 'price_unit', 'event'))`,
      [leadId, svc]
    );
    return { vendor, customer, vendorName, leadId };
  } finally {
    await c.end();
  }
}

test("thread: vendor offer -> customer accepts, replies and marks booked", async ({ page, diag }, testInfo) => {
  const f = await setup(runTag(testInfo));

  // ---- Vendor: bell shows the new lead, reply and send an itemised offer.
  await signIn(page, f.vendor);
  const bell = page.getByTestId("notification-bell");
  await expect(bell).toHaveAccessibleName(/Notifications, \d+ unread/);
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText(`New enquiry from ${f.customer.name}`)).toBeVisible();
  await checkScreen(page, diag, testInfo, "thread-vendor-bell");
  await panel.getByRole("link", { name: new RegExp(`New enquiry from ${f.customer.name}`) }).click();
  await page.waitForURL(`**/vendor/leads/${f.leadId}`);

  await page.getByLabel("Reply to Anu").fill("Thanks Anu! The date is free. Sending an offer now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("The date is free. Sending an offer now.")).toBeVisible();

  await page.getByRole("button", { name: "Build an itemised offer" }).click();
  const offerForm = page.getByRole("form", { name: "Offer v1" });
  await expect(offerForm.getByLabel("Item 1")).toHaveValue("Candid photography");
  await expect(offerForm.getByLabel("Price per unit (₹)")).toHaveValue("45000");
  await offerForm.getByRole("button", { name: "+ Add a line" }).click();
  await offerForm.getByLabel("Item 2").fill("Drone coverage");
  await offerForm.getByLabel("Qty", { exact: true }).nth(1).fill("2");
  await offerForm.getByLabel("Unit", { exact: true }).nth(1).fill("hour");
  await offerForm.getByLabel("Price per unit (₹)").nth(1).fill("2500");
  await offerForm.getByLabel("Advance (%)").fill("25");
  await expect(offerForm.getByTestId("offer-total")).toHaveText("₹50,000");
  await checkScreen(page, diag, testInfo, "thread-vendor-offer-builder");
  await offerForm.getByRole("button", { name: "Send offer" }).click();
  const v1 = page.getByTestId("offer-v1");
  await expect(v1).toBeVisible();
  await expect(v1).toContainText("Waiting for reply");
  await expect(v1).toContainText("₹50,000");
  await checkScreen(page, diag, testInfo, "thread-vendor-lead");

  // ---- Customer: bell, list, thread, accept, reply, mark booked.
  await page.context().clearCookies();
  await signIn(page, f.customer);
  await expect(page.getByTestId("notification-bell")).toHaveAccessibleName(/Notifications, \d+ unread/);
  await page.goto("/my/enquiries");
  await expect(page.getByRole("heading", { level: 1, name: "My enquiries" })).toBeVisible();
  await expect(page.getByText(/Offer v1 · ₹50,000 · waiting for your reply/)).toBeVisible();
  await checkScreen(page, diag, testInfo, "thread-customer-list");
  await page.getByRole("link", { name: f.vendorName }).click();
  await page.waitForURL(`**/my/enquiries/${f.leadId}`);
  await expect(page.getByText("The date is free. Sending an offer now.")).toBeVisible();
  const offer = page.getByTestId("offer-v1");
  await expect(offer).toContainText("Drone coverage");
  await expect(offer).toContainText("Advance 25%");
  await checkScreen(page, diag, testInfo, "thread-customer-enquiry");

  await offer.getByRole("button", { name: "Accept offer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByTestId("offer-v1")).toContainText("Accepted");

  await page.getByLabel(`Message ${f.vendorName}`).fill("Great, we'll pay the advance tomorrow.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("we'll pay the advance tomorrow.")).toBeVisible();

  await page.getByRole("button", { name: "Mark as booked" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark booked" }).click();
  await expect(page.getByRole("list", { name: "Status history" })).toContainText("You marked it booked");
  await expect(page.getByRole("button", { name: "Withdraw enquiry" })).toHaveCount(0);
  await checkScreen(page, diag, testInfo, "thread-customer-booked");

  // Someone else's enquiry is a real 404.
  const other = await page.request.get(`/my/enquiries/${f.leadId + 100000}`, { maxRedirects: 0 });
  expect(other.status()).toBe(404);
});
