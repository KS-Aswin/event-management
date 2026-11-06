import pg from "pg";
import { test, expect, checkScreen, runTag, signUp, isMobile, type Creds } from "./helpers";

// Customer enquiry journey (P2-2 quote dialog v2, P2-3 guest tracking page,
// P2-12 profile contact + sticky mobile bar). Uses the seeded caterer
// "Malabar Spice Caterers" (per-plate units with a 100-plate minimum).
// Enquiries are tagged "E2E run ..." and test users are e2e-customer-...,
// both removed by the global setup.

const CATERER = "Malabar Spice Caterers";

async function db<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL ?? "";
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("local DB only");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function catererPath() {
  const rows = await db<{ id: number }>("SELECT id FROM vendors WHERE name = $1 AND owner_id IS NULL", [CATERER]);
  expect(rows.length, "seeded caterer present (npm run db:seed)").toBe(1);
  return `/vendors/${rows[0].id}`;
}

test.describe("customer enquiry", () => {
  test("guest sends a v2 enquiry from an offering and opens the tracking page", async ({ page, diag }, testInfo) => {
    const tag = runTag(testInfo);
    const path = await catererPath();
    await page.goto(path);
    await expect(page.locator("h1")).toHaveText(CATERER);

    // The offering's own "Request quote" opens the dialog with it preselected.
    const sadya = page
      .locator("li[id^=offering-]")
      .filter({ has: page.getByRole("heading", { name: "Traditional sadya", exact: true }) })
      .first();
    await sadya.getByRole("button", { name: "Request quote" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: "Traditional sadya" })).toBeChecked();

    await dialog.getByLabel("Event type").selectOption({ label: "Nikah" });
    await dialog.getByLabel("Event date").fill(new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10));
    await dialog.getByLabel("Time of day").selectOption("evening");
    await dialog.getByLabel("Guests").fill("50");
    // 50 guests under a 100-plate minimum: a warning, still allowed.
    await expect(dialog.getByText(/usually takes at least 100 plates/)).toBeVisible();
    await dialog.getByLabel("District").selectOption({ label: "Thrissur" });
    await dialog.getByLabel("Venue type").selectOption("hall");
    await dialog.getByLabel("Food preference").selectOption("non_veg");
    await dialog.getByLabel("Budget").selectOption({ label: "₹1 – 3 lakh" });
    await dialog.getByLabel("Your name").fill("Fathima E2E");
    await dialog.getByLabel("Phone number").fill("+971 50 123 4567");
    await dialog.getByRole("textbox", { name: /^Email/ }).fill(`e2e-guest-${tag}@example.com`);
    await dialog.getByLabel("Message").fill(`E2E run ${tag}: nikah in Thrissur`);
    await checkScreen(page, diag, testInfo, "enquiry-v2-filled");

    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByRole("status")).toContainText(`Quote request sent to ${CATERER}`);
    await expect(dialog.getByText(/minimum is usually 100/)).toBeVisible();
    const link = dialog.getByLabel("Tracking link");
    await expect(link).toHaveValue(/\/enquiry\/[0-9a-f-]{36}$/);
    const trackingUrl = await link.inputValue();
    const share = dialog.getByRole("link", { name: "Share on WhatsApp" });
    const shareHref = (await share.getAttribute("href")) ?? "";
    expect(shareHref.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(shareHref.split("text=")[1])).toContain(trackingUrl);
    await checkScreen(page, diag, testInfo, "enquiry-v2-sent");

    // Stored as E.164 with the event context.
    const token = trackingUrl.split("/enquiry/")[1];
    const [row] = await db<{ phone: string; guest_count: number; food_pref: string; budget_min: number }>(
      "SELECT phone, guest_count, food_pref, budget_min FROM quote_requests WHERE guest_token = $1",
      [token]
    );
    expect(row).toMatchObject({ phone: "+971501234567", guest_count: 50, food_pref: "non_veg", budget_min: 100000 });

    await dialog.getByRole("link", { name: "Open tracking page" }).click();
    await expect(page).toHaveURL(/\/enquiry\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(CATERER);
    await expect(page.getByText("Waiting for the vendor")).toBeVisible();
    await expect(page.getByText("No offer yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create free account" })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await checkScreen(page, diag, testInfo, "enquiry-tracking");
  });

  test("a wrong tracking token shows not found", async ({ page, diag }, testInfo) => {
    await page.goto("/enquiry/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
    await checkScreen(page, diag, testInfo, "enquiry-tracking-404", { ignoreErrors: [/status of 404/] });
  });

  test("profile contact: WhatsApp click-to-chat is counted; sticky mobile bar leaves content visible", async ({ page, diag }, testInfo) => {
    const path = await catererPath();
    const vendorId = Number(path.split("/").pop());
    await page.goto(path);
    const wa = page.getByRole("link", { name: /WhatsApp/ }).filter({ visible: true }).first();
    const href = (await wa.getAttribute("href")) ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/91\d{10}\?text=/);
    expect(decodeURIComponent(href.split("text=")[1])).toContain(CATERER);
    // Signed out: the number itself needs an account.
    await expect(page.getByRole("link", { name: "Sign in to see the phone number" }).filter({ visible: true }).first()).toBeVisible();

    if (isMobile(page)) {
      // QA-009: the bar is sticky (last child of <main>), not fixed, so it sits
      // at the bottom of the screen while scrolling and stops above the footer
      // instead of covering content (qa1-public.spec.ts checks the footer).
      const bar = page.getByTestId("vendor-mobile-cta");
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("button", { name: "Get quote" })).toBeVisible();
      await expect(bar.getByRole("link", { name: /WhatsApp/ })).toBeVisible();
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
      const box = (await bar.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    }
    await checkScreen(page, diag, testInfo, "profile-contact");

    const count = async () =>
      (await db<{ n: number }>("SELECT count(*)::int AS n FROM vendor_events WHERE vendor_id = $1 AND kind = 'whatsapp_click'", [vendorId]))[0].n;
    const before = await count();
    const popup = page.waitForEvent("popup").catch(() => null);
    await wa.click();
    (await popup)?.close().catch(() => {});
    await expect.poll(count, { timeout: 15_000 }).toBeGreaterThan(before);
  });

  test("a signed-in customer sees the vendor's phone and a prefilled form", async ({ page, diag }, testInfo) => {
    const tag = runTag(testInfo);
    const creds: Creds = { name: `Cara Enquiry ${tag}`, email: `e2e-customer-enq-${tag}@example.com`, password: "e2e-pass-12345" };
    await signUp(page, "customer", creds);
    await page.goto(await catererPath());
    await expect(page.getByRole("link", { name: /^Call \+91 / }).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Request quote" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Your name")).toHaveValue(creds.name);
    await expect(dialog.getByRole("textbox", { name: "Email" })).toHaveValue(creds.email);
    await checkScreen(page, diag, testInfo, "enquiry-v2-signed-in");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });
});
