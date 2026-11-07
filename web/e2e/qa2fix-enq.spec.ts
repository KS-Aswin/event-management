import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, signIn, type Creds } from "./helpers";

// QA round 2 enquiry/review fixes, as a browser sees them (fix2 group "enq").
// QA-040: the profile says an enquiry was already sent, the sheet warns, and
//         sending the same date again points to the existing enquiry.
// QA-041: the single-vendor sheet is prefilled from the saved event.
// QA-038: no review form before the event; the copy says why.
// The API side is in tests/qa2-enq.test.mjs. Users are e2e-* (global cleanup).

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

async function setup(tag: string): Promise<{ customer: Creds; listingId: number; enquiryId: number }> {
  const rnd = Math.random().toString(36).slice(2, 7);
  const pw = "e2e-qa2fix-password-1";
  const customer: Creds = { name: "Qa Fix", email: `e2e-customer-qa2fix-enq-${tag}-${rnd}@example.com`, password: pw };
  const c = client();
  await c.connect();
  try {
    const hash = await bcrypt.hash(pw, 10);
    const vid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ('QA2fix Vendor', $1, $2, 'vendor') RETURNING id", [
        `e2e-vendor-qa2fix-enq-${tag}-${rnd}@example.com`,
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
    const listingId = (
      await c.query<{ id: number }>(
        `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                              district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
         VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E qa2fix listing.', 'approved',
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
                 (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', '+919847012345', 6, now(), now())
         RETURNING id`,
        [vid, `QA2fix Lens ${tag}${rnd}`]
      )
    ).rows[0].id;
    const enquiryId = (
      await c.query<{ id: number }>(
        `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count, district_id, event_type_id)
         VALUES ($1, $2, $3, '+919847011111', (now() AT TIME ZONE 'Asia/Kolkata')::date + 100, 'E2E qa2fix first enquiry', 300,
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
                 (SELECT id FROM event_types WHERE active ORDER BY id LIMIT 1))
         RETURNING id`,
        [listingId, cid, customer.name]
      )
    ).rows[0].id;
    return { customer, listingId, enquiryId };
  } finally {
    await c.end();
  }
}

test("QA-040/041/038: profile with an open enquiry: link, prefilled sheet, duplicate refused, no review form yet", async ({ page }, testInfo) => {
  const f = await setup(testInfo.workerIndex.toString());
  await signIn(page, f.customer);
  await page.goto(`/vendors/${f.listingId}`);

  // QA-040: "Enquiry sent for <date> · view" next to the CTA, 44px tall.
  const sentLink = page.getByRole("link", { name: /Enquiry sent for .+ · view/ }).locator("visible=true").first();
  await expect(sentLink).toBeVisible();
  await expect(sentLink).toHaveAttribute("href", `/my/enquiries/${f.enquiryId}`);
  expect((await sentLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // QA-038: the review area explains when a review becomes possible.
  await expect(page.getByText(/after your event date, once they have replied to your enquiry or you have booked them/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Post review" })).toHaveCount(0);

  // QA-041: the sheet starts from the saved event.
  await page.getByRole("button", { name: "Request quote" }).locator("visible=true").first().click();
  const d = page.getByRole("dialog");
  await expect(d.getByText(/You already have an open enquiry with/)).toBeVisible();
  await expect(d.getByLabel("Phone number")).toHaveValue("+919847011111");
  await expect(d.getByRole("spinbutton", { name: "Guests" })).toHaveValue("300");
  // The saved date is the open enquiry's own date with this vendor, so it is
  // not prefilled here (it could only be refused as a duplicate).
  await expect(d.getByLabel("Event date")).toHaveValue("");
  await expect(d.getByLabel("District")).not.toHaveValue("");
  await expect(d.getByText(/Filled in from your .+ enquiry/)).toBeVisible();

  // Same date again: refused, pointing at the existing enquiry.
  const sameDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 100 * 86_400_000));
  await d.getByLabel("Event date").fill(sameDate);
  await d.getByRole("button", { name: "Send request" }).click();
  const alert = d.getByRole("alert");
  // The first send compiles the API route in dev: allow for it.
  await expect(alert).toContainText("already sent this vendor an enquiry for this date", { timeout: 60_000 });
  await expect(alert.getByRole("link", { name: "View your enquiry" })).toHaveAttribute("href", `/my/enquiries/${f.enquiryId}`);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
});
