import pg from "pg";
import { test, expect, checkScreen, runTag, signUp, isMobile, type Creds } from "./helpers";

// QA round 1, customer group (layout and form behaviour):
//   QA-012  /my/compare with 3 vendors: at 390px only the comparison table
//           scrolls sideways; the page itself never does (the sr-only spans in
//           the table cells used to escape the scroller and widen the page).
//   QA-029  "Send enquiry to N" on /my/shortlist starts prefilled from the
//           customer's next upcoming enquiry (phone, date, occasion, district,
//           guests) and says where the details came from.
// The customer is e2e-customer-qa1-*: removed in afterAll and by the global
// cleanup.

test.describe.configure({ mode: "serial" });

const SEEDED_MEDIA = { ignoreErrors: [new RegExp("status of 404.*/media/vendors/")] };

let customer: Creds;
let vendors: { id: number; name: string }[] = [];

function localDbUrl(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const url = localDbUrl();
  if (!url) throw new Error("needs a localhost DATABASE_URL");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** YYYY-MM-DD, `days` from today in India. */
function isoDay(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async ({ request }, testInfo) => {
  customer = {
    name: "Anu Varghese",
    email: `e2e-customer-qa1-${runTag(testInfo)}@example.com`,
    password: "e2e-qa1-password-1",
  };
  const res = await request.get("/api/vendors?limit=3&sort=rating");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { vendors: { id: number; name: string }[] };
  expect(body.vendors.length).toBeGreaterThanOrEqual(3);
  vendors = body.vendors.slice(0, 3);
});

test.afterAll(async () => {
  if (!customer || !localDbUrl()) return;
  await withDb(async (c) => {
    const ids = (await c.query("SELECT id FROM users WHERE email = $1", [customer.email])).rows.map((r) => r.id);
    if (!ids.length) return;
    await c.query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
    await c.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  });
});

test("compare 3 vendors: only the table scrolls sideways; the send sheet is prefilled", async ({ page, diag }, testInfo) => {
  await signUp(page, "customer", customer);
  for (const v of vendors) {
    const r = await page.request.post("/api/my/shortlist", { data: { vendorId: v.id } });
    expect(r.status(), `shortlist ${v.id}`).toBeLessThan(300);
  }

  // ---- QA-012 ----
  await page.goto(`/my/compare?ids=${vendors.map((v) => v.id).join(",")}`);
  await expect(page.getByRole("heading", { name: "Compare vendors" })).toBeVisible();
  const table = page.getByRole("region", { name: "Comparison table" });
  await expect(table.getByRole("rowheader", { name: "Price" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page itself must not scroll sideways").toBeLessThanOrEqual(0);
  if (isMobile(page)) {
    const scroll = await table.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw, "the table scrolls inside its own region").toBeGreaterThan(scroll.cw);
    // Scrolled fully right, the page still doesn't move.
    await table.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  }
  await checkScreen(page, diag, testInfo, "qa1-my-compare-3", SEEDED_MEDIA);

  // ---- QA-029 ----
  // The customer already told a vendor about their event.
  const upcoming = isoDay(90);
  const ids = await withDb(async (c) => {
    const user = (await c.query("SELECT id FROM users WHERE email = $1", [customer.email])).rows[0];
    const et = (await c.query("SELECT id, name FROM event_types WHERE active AND slug <> 'other' ORDER BY sort_order, id LIMIT 1")).rows[0];
    const d = (await c.query("SELECT id FROM districts WHERE name = 'Thrissur' AND state = 'Kerala'")).rows[0];
    await c.query(
      `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, status, event_type_id, district_id,
                                   guest_count, preferred_contact)
       VALUES ($1, $2, $3, '+919847055501', $4, 'pending', $5, $6, 250, 'call')`,
      [vendors[0].id, user.id, customer.name, upcoming, et.id, d.id]
    );
    return { eventType: et as { id: number; name: string }, districtId: d.id as number };
  });

  await page.goto("/my/shortlist");
  await page.getByLabel(`Select ${vendors[1].name}`).check();
  await page.getByLabel(`Select ${vendors[2].name}`).check();
  await page.getByRole("button", { name: "Send enquiry to 2" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Send one enquiry to 2 vendors" })).toBeVisible();
  await expect(dialog.getByText(`Filled in from your ${ids.eventType.name} enquiry`)).toBeVisible();
  await expect(dialog.getByLabel("Your name")).toHaveValue(customer.name);
  await expect(dialog.getByLabel("Phone number")).toHaveValue("+919847055501");
  await expect(dialog.getByLabel("Event date")).toHaveValue(upcoming);
  await expect(dialog.getByLabel("Occasion")).toHaveValue(String(ids.eventType.id));
  await expect(dialog.getByLabel("District")).toHaveValue(String(ids.districtId));
  await expect(dialog.getByLabel("Guests")).toHaveValue("250");
  await expect(dialog.getByLabel("Reach me by")).toHaveValue("call");
  await checkScreen(page, diag, testInfo, "qa1-my-shortlist-send-prefilled", SEEDED_MEDIA);

  // Sends without retyping anything.
  await dialog.getByRole("button", { name: "Send to 2 vendors" }).click();
  await expect(dialog.getByRole("status")).toContainText("Sent to 2 of 2");
});
