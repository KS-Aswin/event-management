import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, checkScreen, runTag, signIn, isMobile, type Creds } from "./helpers";

// The whole P2 customer journey across builders' seams, as a real user:
// guest enquiry -> tracking link -> sign up (enquiry linked) -> /my ->
// thread -> vendor offer -> accept -> booked -> review -> vendor reply.
// The vendor is created straight in the LOCAL DB with an e2e-vendor-* email;
// the customer signs up with an e2e-customer-* email (both removed by the
// global cleanup).

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

async function makeVendor(tag: string, rnd: string) {
  const vendor: Creds = { name: "Journey Vendor", email: `e2e-vendor-journey-${tag}-${rnd}@example.com`, password: "e2e-journey-password-1" };
  const vendorName = `Lens Journey ${tag}${rnd}`;
  const c = client();
  await c.connect();
  try {
    const hash = await bcrypt.hash(vendor.password, 10);
    const uid = (
      await c.query<{ id: number }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'vendor') RETURNING id", [
        vendor.name,
        vendor.email,
        hash,
      ])
    ).rows[0].id;
    const vendorId = (
      await c.query<{ id: number }>(
        `INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, about, status,
                              district_id, primary_category_id, phone, whatsapp, onboarding_step, onboarding_completed_at, submitted_at)
         VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E journey listing.', 'approved',
                 (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
                 (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', '+919847012345', 6, now(), now())
         RETURNING id`,
        [uid, vendorName]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO services (vendor_id, category_id, title, price_from, price_unit)
       VALUES ($1, (SELECT id FROM categories WHERE name = 'Photography'), 'Candid photography', 45000, 'event')`,
      [vendorId]
    );
    return { vendor, vendorName, vendorId };
  } finally {
    await c.end();
  }
}

async function noStaffTools(page: import("@playwright/test").Page) {
  // Customers never see vendor workspace or admin links.
  await expect(page.locator('a[href="/vendor"], a[href^="/vendor/"], a[href^="/admin"], a[href^="/signup?role=vendor"]')).toHaveCount(0);
}

test("journey: guest enquiry -> sign up -> /my -> offer -> booked -> review -> vendor reply", async ({ page, diag }, testInfo) => {
  test.setTimeout(300_000);
  const tag = runTag(testInfo);
  const rnd = Math.random().toString(36).slice(2, 7);
  const { vendor, vendorName, vendorId } = await makeVendor(tag, rnd);
  const customer: Creds = { name: "Meera Journey", email: `e2e-customer-journey-${tag}-${rnd}@example.com`, password: "e2e-journey-password-1" };

  // ---- Guest: enquiry from the public profile, tracking link.
  await page.goto(`/vendors/${vendorId}`);
  await expect(page.getByRole("heading", { level: 1, name: vendorName })).toBeVisible();
  await page
    .locator("li[id^=offering-]")
    .filter({ has: page.getByRole("heading", { name: "Candid photography", exact: true }) })
    .first()
    .getByRole("button", { name: "Request quote" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Candid photography" })).toBeChecked();
  await dialog.getByLabel("Event type").selectOption({ label: "Christian wedding" });
  await dialog.getByLabel("Event date").fill(new Date(Date.now() + 50 * 864e5).toISOString().slice(0, 10));
  await dialog.getByLabel("Guests").fill("300");
  await dialog.getByLabel("District").selectOption({ label: "Ernakulam" });
  await dialog.getByLabel("Your name").fill(customer.name);
  await dialog.getByLabel("Phone number").fill("+91 98470 55555");
  await dialog.getByRole("textbox", { name: /^Email/ }).fill(customer.email);
  await dialog.getByLabel("Message").fill(`Journey ${tag}: candid photos for a wedding`);
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog.getByRole("status")).toContainText(`Quote request sent to ${vendorName}`);
  const trackingUrl = await dialog.getByLabel("Tracking link").inputValue();
  expect(trackingUrl).toMatch(/\/enquiry\/[0-9a-f-]{36}$/);
  await checkScreen(page, diag, testInfo, "journey-guest-sent");

  await page.goto(new URL(trackingUrl).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(vendorName);
  await checkScreen(page, diag, testInfo, "journey-guest-tracking");

  // ---- Sign up from the tracking page: the guest enquiry joins the account.
  await page.getByRole("link", { name: "Create free account" }).click();
  await page.waitForURL(/\/signup/);
  await page.getByText("I'm planning an event").click();
  await page.getByLabel("Your name").fill(customer.name);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(customer.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/my/enquiries");
  await expect(page.getByRole("link", { name: vendorName })).toBeVisible();
  await noStaffTools(page);
  await checkScreen(page, diag, testInfo, "journey-customer-enquiries");

  const c = client();
  await c.connect();
  let leadId: number;
  try {
    const r = await c.query<{ id: number }>(
      "SELECT q.id FROM quote_requests q JOIN users u ON u.id = q.customer_id WHERE q.vendor_id = $1 AND u.email = $2",
      [vendorId, customer.email]
    );
    expect(r.rows).toHaveLength(1);
    leadId = r.rows[0].id;
  } finally {
    await c.end();
  }

  // /my is discovery-first with the next event.
  await page.goto("/my");
  await expect(page.getByRole("region", { name: "Find vendors" })).toBeVisible();
  await noStaffTools(page);
  if (isMobile(page)) await expect(page.getByRole("navigation", { name: "Customer" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "journey-customer-home");

  // Customer writes in the thread.
  await page.goto(`/my/enquiries/${leadId}`);
  const composer = page.getByLabel(`Message ${vendorName}`);
  await composer.fill("Hi! Do you also cover the reception the evening before?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toHaveValue(""); // cleared only after the POST succeeded
  await expect(page.getByText("cover the reception the evening before")).toBeVisible();

  // ---- Vendor: sees the message, replies and sends an offer.
  await page.context().clearCookies();
  await signIn(page, vendor);
  await page.goto(`/vendor/leads/${leadId}`);
  await expect(page.getByText("cover the reception the evening before")).toBeVisible();
  const reply = page.getByLabel(/^Reply to Meera/);
  await reply.fill("Yes we do. Sending an offer with both days.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(reply).toHaveValue("");
  await expect(page.getByText("Sending an offer with both days.")).toBeVisible();
  await page.getByRole("button", { name: "Build an itemised offer" }).click();
  const offerForm = page.getByRole("form", { name: "Offer v1" });
  await expect(offerForm.getByLabel("Item 1")).toHaveValue("Candid photography");
  await offerForm.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByTestId("offer-v1")).toContainText("Waiting for reply");
  await checkScreen(page, diag, testInfo, "journey-vendor-lead");

  // ---- Customer: accept, mark booked; lands on /my after sign-in.
  await page.context().clearCookies();
  await signIn(page, customer);
  await expect(page).toHaveURL(/\/my$/);
  await page.goto(`/my/enquiries/${leadId}`);
  await expect(page.getByText("Sending an offer with both days.")).toBeVisible();
  const offer = page.getByTestId("offer-v1");
  await checkScreen(page, diag, testInfo, "journey-customer-offer"); // also waits for hydration
  await offer.getByRole("button", { name: "Accept offer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByTestId("offer-v1")).toContainText("Accepted");
  await page.getByRole("button", { name: "Mark as booked" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark booked" }).click();
  await expect(page.getByRole("list", { name: "Status history" })).toContainText("You marked it booked");
  await noStaffTools(page);
  await checkScreen(page, diag, testInfo, "journey-customer-booked");

  // Time passes: the event is over (moved in the local DB).
  const c2 = client();
  await c2.connect();
  try {
    await c2.query("UPDATE quote_requests SET event_date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 3 WHERE id = $1", [leadId]);
  } finally {
    await c2.end();
  }

  // ---- Review prompt on /my/reviews, then a verified review.
  await page.goto("/my/reviews");
  await expect(page.getByText(vendorName).first()).toBeVisible();
  await checkScreen(page, diag, testInfo, "journey-customer-rate");
  await page.goto(`/vendors/${vendorId}#write-review`);
  await page.getByRole("radio", { name: "5 stars" }).check({ force: true });
  await page.getByLabel("Your review").fill("Beautiful candid photos and on time on both days. Highly recommended.");
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(page.getByText("Beautiful candid photos and on time on both days.")).toBeVisible();
  await expect(page.getByText("Verified booking").first()).toBeVisible();

  // ---- Vendor replies publicly; the reply shows on the profile.
  await page.context().clearCookies();
  await signIn(page, vendor);
  await page.goto("/vendor/reviews");
  await page.getByRole("button", { name: "Reply publicly" }).click();
  await page.getByLabel("Your public reply").fill("Thank you Meera, it was a joy to shoot your wedding!");
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByRole("button", { name: "Edit reply" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "journey-vendor-reply");

  await page.context().clearCookies();
  await page.goto(`/vendors/${vendorId}`);
  await expect(page.getByText(`Reply from ${vendorName}`)).toBeVisible();
  await checkScreen(page, diag, testInfo, "journey-public-profile");
});
