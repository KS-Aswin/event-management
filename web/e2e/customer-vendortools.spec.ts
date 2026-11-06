import pg from "pg";
import bcrypt from "bcryptjs";
import { test, expect, checkScreen, isMobile, runTag, signIn, type Creds } from "./helpers";

// P2-6 calendar, P2-11 review replies, P2-14 insights from the vendor's
// side. Users are created straight in the LOCAL DB as vtools-e2e-* emails
// (not e2e-*, so a parallel suite's global cleanup can't delete them mid-run)
// and removed with their listings after the suite.

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

/** YYYY-MM-DD in India, n days from today. */
function istDate(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

test.afterAll(async () => {
  const c = client();
  await c.connect();
  try {
    const ids = (await c.query<{ id: number }>("SELECT id FROM users WHERE email ~ '^vtools-e2e-[0-9a-z-]+@example[.]com$'")).rows.map(
      (r) => r.id
    );
    if (ids.length) {
      await c.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[])", [ids]);
      await c.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    }
  } finally {
    await c.end();
  }
});

type Fixture = { vendor: Creds; vendorName: string; vendorId: number; c: pg.Client };

async function setup(tag: string, label: string): Promise<Fixture> {
  const rnd = Math.random().toString(36).slice(2, 7);
  const vendor: Creds = { name: "Tools Vendor", email: `vtools-e2e-${label}-${tag}-${rnd}@example.com`, password: "e2e-vtools-password-1" };
  const vendorName = `Tools Lens ${tag}${rnd}`;
  const c = client();
  await c.connect();
  const hash = await bcrypt.hash(vendor.password, 10);
  const vid = (
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
       VALUES ($1, $2, 'Photography', 'Ernakulam', 0, 'Price on request', '3 yrs', 'E2E vendor tools listing.', 'approved',
               (SELECT id FROM districts WHERE name = 'Ernakulam' AND state = 'Kerala' LIMIT 1),
               (SELECT id FROM categories WHERE name = 'Photography' LIMIT 1), '+919847012345', '+919847012345', 6, now(), now())
       RETURNING id`,
      [vid, vendorName]
    )
  ).rows[0].id;
  return { vendor, vendorName, vendorId, c };
}

test("calendar: block a day with an open enquiry, set capacity and block a range", async ({ page, diag }, testInfo) => {
  const f = await setup(runTag(testInfo), "cal");
  const D = istDate(40);
  const D2 = istDate(41);
  try {
    await f.c.query(
      `INSERT INTO quote_requests (vendor_id, name, phone, event_date, status, message)
       VALUES ($1, 'Meera Pillai', '+919999933333', $2::date, 'pending', 'E2E calendar enquiry')`,
      [f.vendorId, D]
    );
  } finally {
    await f.c.end();
  }

  await signIn(page, f.vendor);
  if (!isMobile(page)) {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Calendar" }).click();
    await page.waitForURL("**/vendor/calendar");
  }
  await page.goto(`/vendor/calendar?month=${D.slice(0, 7)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  const day = page.locator(`button[data-date="${D}"]`);
  await expect(day).toHaveAccessibleName(/1 open enquiry/);
  await day.click();
  await expect(page.getByRole("link", { name: /Meera Pillai/ })).toBeVisible();
  await checkScreen(page, diag, testInfo, "vtools-calendar");

  // Blocking warns about the open enquiry first.
  await page.getByRole("button", { name: "Block full day", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("There's an open enquiry on this date");
  await expect(dialog).toContainText("Meera Pillai");
  await dialog.getByRole("button", { name: "Block anyway" }).click();
  await expect(page.getByRole("status").filter({ hasText: "blocked" })).toBeVisible();
  await expect(day).toHaveAttribute("data-state", "blocked");
  await expect(page.getByRole("button", { name: "Unblock full day" })).toBeVisible();

  // Two teams on the next day.
  await page.locator(`button[data-date="${D2}"]`).click();
  await page.getByRole("button", { name: "Set capacity for full day" }).click();
  await page.getByLabel("Events you can take").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-slot-state="full"]')).toHaveText("Open · 2 events");

  // Bulk range (same month as D2 when possible).
  const from = istDate(43);
  const to = istDate(44);
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.getByLabel("Note").fill("Out of station");
  await page.getByRole("button", { name: "Block dates", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Blocked" })).toBeVisible();
  if (from.slice(0, 7) === D.slice(0, 7)) await expect(page.locator(`button[data-date="${from}"]`)).toHaveAttribute("data-state", "blocked");
  // The 409 PENDING_LEADS answer behind the confirm dialog is expected.
  await checkScreen(page, diag, testInfo, "vtools-calendar-blocked", {
    ignoreErrors: [/status of 409 .*\/api\/vendor\/availability/],
  });
});

test("reviews: vendor replies publicly; the reply shows on the profile", async ({ page, diag }, testInfo) => {
  const f = await setup(runTag(testInfo), "rev");
  try {
    await f.c.query(
      `INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body, verified)
       VALUES ($1, 'Liya Thomas', 4, 'Lovely candid shots. Delivery took a week longer than promised.', true)`,
      [f.vendorId]
    );
  } finally {
    await f.c.end();
  }

  await signIn(page, f.vendor);
  await page.goto("/vendor/reviews");
  await expect(page.getByRole("heading", { level: 1, name: "Reviews" })).toBeVisible();
  await expect(page.getByText("1 waiting for your reply")).toBeVisible();
  await expect(page.getByLabel("Review link")).toHaveValue(new RegExp(`/vendors/${f.vendorId}#write-review$`));
  await page.getByRole("button", { name: "Reply publicly" }).click();
  await page.getByLabel("Your public reply").fill("Thank you Liya! Sorry about the delay; we now confirm delivery dates in writing.");
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByText("Your reply", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit reply" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "vtools-reviews");

  await page.context().clearCookies();
  await page.goto(`/vendors/${f.vendorId}`);
  await expect(page.getByText(`Reply from ${f.vendorName}`)).toBeVisible();
  await expect(page.getByText("we now confirm delivery dates in writing")).toBeVisible();
  await expect(page.getByText("Verified booking")).toBeVisible();
});

test("insights: numbers from the vendor's events and enquiries", async ({ page, diag }, testInfo) => {
  const f = await setup(runTag(testInfo), "ins");
  try {
    await f.c.query(
      `INSERT INTO vendor_events (vendor_id, kind, created_at)
       SELECT $1, k, now() - interval '1 day' FROM unnest(ARRAY['profile_view','profile_view','profile_view','whatsapp_click']) k`,
      [f.vendorId]
    );
    await f.c.query(
      `INSERT INTO quote_requests (vendor_id, name, phone, status, created_at)
       SELECT $1, 'Insight Customer', '+919999944444', s, now() - interval '1 day' FROM unnest(ARRAY['booked','pending']) s`,
      [f.vendorId]
    );
  } finally {
    await f.c.end();
  }

  await signIn(page, f.vendor);
  await page.goto("/vendor/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await page.getByRole("link", { name: "7 days" }).click();
  await page.waitForURL("**/vendor/insights?range=7");
  await expect(page.getByTestId("insight-views").locator("[data-value]")).toHaveText("3");
  await expect(page.getByTestId("insight-whatsapp").locator("[data-value]")).toHaveText("1");
  await expect(page.getByTestId("insight-enquiries").locator("[data-value]")).toHaveText("2");
  await expect(page.getByTestId("insight-booked-rate").locator("[data-value]")).toHaveText("50%");
  await checkScreen(page, diag, testInfo, "vtools-insights");
});
