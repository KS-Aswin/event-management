import pg from "pg";
import { test, expect, checkScreen, runTag, signUp, isMobile, type Creds } from "./helpers";

// Customer area (P2-1, P2-9, P2-10, 2.7): a guest saves vendors on this
// device, signs up and lands on /my with the saved vendors merged into the
// shortlist; adds a note, compares two vendors (the table scrolls inside
// itself on phones), sends one enquiry to the selection and sees per-vendor
// results; navigation is the customer header (desktop) or tab bar (phone).
// The customer is custtest-my-e2e-* (NOT e2e-*: the global setup of another
// suite running at the same time deletes every e2e-* user) and is removed,
// with its enquiries and shortlist, in afterAll.

test.describe.configure({ mode: "serial" });

// Seeded vendors' photos are local files that a re-seed can replace while
// the DB rows still point at the old ones; the cards fall back to the
// category gradient, so a missing seeded image is not an app error here.
const SEEDED_MEDIA = { ignoreErrors: [new RegExp("status of 404.*/media/vendors/")] };

let customer: Creds;
let vendorIds: number[] = [];
let vendorNames: string[] = [];

test.beforeAll(async ({ request }, testInfo) => {
  const tag = runTag(testInfo);
  // Stable per run and project: a worker restart between the two tests
  // must find the same account.
  customer = { name: "Meera Nair", email: `custtest-my-e2e-${tag}@example.com`, password: "e2e-my-password-1" };
  const res = await request.get("/api/vendors?limit=3&sort=rating");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { vendors: { id: number; name: string }[] };
  expect(body.vendors.length).toBeGreaterThanOrEqual(3);
  vendorIds = body.vendors.map((v) => v.id);
  vendorNames = body.vendors.map((v) => v.name);
});

test.afterAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || !customer) return;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const ids = (await c.query("SELECT id FROM users WHERE email = $1", [customer.email])).rows.map((r) => r.id);
    if (ids.length) {
      await c.query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
      await c.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    }
  } finally {
    await c.end();
  }
});

test("guest shortlist merges into the account after sign-up; /my is the landing", async ({ page, diag }, testInfo) => {
  // Save two vendors as a guest (no sign-in prompt, saved on this device).
  for (const id of vendorIds.slice(0, 2)) {
    await page.goto(`/vendors/${id}`);
    await page.getByRole("button", { name: "Save to shortlist" }).first().click();
    await expect(page.getByRole("button", { name: "Remove from shortlist" }).first()).toBeVisible();
  }
  await expect(page.getByText("Saved on this device").first()).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem("vela.shortlist.v1"));
  expect(JSON.parse(stored ?? "[]")).toHaveLength(2);

  await signUp(page, "customer", customer);
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Meera");
  // The merge clears the device list and the shortlist shows both vendors.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("vela.shortlist.v1"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your shortlist" })).toBeVisible();
  for (const n of vendorNames.slice(0, 2)) await expect(page.getByText(n).first()).toBeVisible();
  await expect(page.getByText("List your business")).toHaveCount(0);

  if (isMobile(page)) {
    const bar = page.getByTestId("customer-tab-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: /Shortlist/ })).toContainText("2");
    // The vendor profile's own sticky bar owns the bottom edge there.
    await page.goto(`/vendors/${vendorIds[0]}`);
    await expect(page.getByTestId("customer-tab-bar")).toHaveCount(0);
    await page.goto("/my");
  } else {
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: /My events/ })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByTestId("shortlist-count")).toContainText("2");
  }
  await checkScreen(page, diag, testInfo, "my-home", SEEDED_MEDIA);
});

test("shortlist: note, compare two vendors, send one enquiry to the selection", async ({ page, diag }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(customer.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/my$/);

  // Add a third vendor from its profile while signed in.
  await page.goto(`/vendors/${vendorIds[2]}`);
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/vendors/${vendorIds[2]}/favorite`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save to shortlist" }).first().click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Remove from shortlist" }).first()).toBeVisible();

  await page.goto("/my/shortlist");
  await expect(page.getByTestId("shortlist-row")).toHaveCount(3);

  // Private note.
  await page.getByRole("button", { name: `+ Add note for ${vendorNames[0]}` }).click();
  await page.getByLabel(`Note for ${vendorNames[0]}`).fill("Ask about the Sunday rate");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Ask about the Sunday rate")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ask about the Sunday rate")).toBeVisible();

  // Select two and compare.
  await page.getByLabel(`Select ${vendorNames[0]}`).check();
  await page.getByLabel(`Select ${vendorNames[1]}`).check();
  await expect(page.getByText("2 of 5 selected")).toBeVisible();
  await checkScreen(page, diag, testInfo, "my-shortlist-selected", SEEDED_MEDIA);
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/my\/compare\?ids=/);
  await expect(page.getByRole("heading", { name: "Compare vendors" })).toBeVisible();
  const table = page.getByRole("region", { name: "Comparison table" });
  await expect(table.getByRole("rowheader", { name: "Price" })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "Usually replies" })).toBeVisible();
  await expect(table.getByText("Ask about the Sunday rate")).toBeVisible();
  if (isMobile(page)) {
    // Only the table scrolls sideways; the page itself never does.
    const scroll = await table.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeGreaterThan(scroll.cw);
  }
  await checkScreen(page, diag, testInfo, "my-compare", SEEDED_MEDIA);

  // Send one enquiry to the selection.
  await page.goto("/my/shortlist");
  await page.getByLabel(`Select ${vendorNames[0]}`).check();
  await page.getByLabel(`Select ${vendorNames[2]}`).check();
  await page.getByRole("button", { name: "Send enquiry to 2" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Send one enquiry to 2 vendors" })).toBeVisible();
  const phone = `98${String(Date.now()).slice(-8)}`;
  await dialog.getByLabel("Phone number").fill(phone);
  const d = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  await dialog.getByLabel("Event date").fill(d);
  await dialog.getByLabel("Occasion").selectOption({ index: 1 });
  await dialog.getByLabel("Message").fill(`Shortlist send e2e ${runTag(testInfo)}`);
  await checkScreen(page, diag, testInfo, "my-shortlist-send", SEEDED_MEDIA);
  await dialog.getByRole("button", { name: "Send to 2 vendors" }).click();
  await expect(dialog.getByRole("status")).toContainText("Sent to 2 of 2");
  await expect(dialog.getByRole("link", { name: "View" })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Enquiry sent · view").first()).toBeVisible();

  // The home now has a next event and the reviews page renders.
  await page.goto("/my");
  await expect(page.getByText(/Next event/)).toBeVisible();
  await page.goto("/my/reviews");
  await expect(page.getByRole("heading", { name: "My reviews" })).toBeVisible();
  await checkScreen(page, diag, testInfo, "my-reviews", SEEDED_MEDIA);
});
