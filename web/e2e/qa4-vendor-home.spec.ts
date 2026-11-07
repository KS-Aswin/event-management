import { test, expect, runTag, signUp, isMobile, type Creds } from "./helpers";

// QA round 4 fixes, vendor home + notifications:
//   QA4-V3 / QA-095 every unread notification can be opened somewhere: the
//          bell (newest 15) and "Updates from Vela" (newest 6) link to
//          /notifications, which pages through all of them and marks them read.
//   QA-096 at 390 the "Updates from Vela" title links and the /vendor/areas
//          "Change" link are >= 44 px tall.

async function approvedVendor(page: import("@playwright/test").Page, tag: string) {
  const vendor: Creds = { name: `qa4 Home ${tag}`, email: `e2e-qa4-vhome-${tag}@example.com`, password: "e2e-pass-12345" };
  await signUp(page, "vendor", vendor);
  const created = await page.request.post("/api/vendor/listing", { data: { name: `qa4 Home Studio ${tag}`, primaryCategoryId: 8, districtId: 1 } });
  expect(created.status()).toBe(201);
  const vendorId = (await created.json()).listing.id as number;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("UPDATE vendors SET status = 'approved', published = true WHERE id = $1", [vendorId]);
    const { rows } = await client.query("SELECT owner_id FROM vendors WHERE id = $1", [vendorId]);
    const userId = rows[0].owner_id as number;
    // 18 notifications, oldest first; the newest links to the profile editor.
    await client.query(
      `INSERT INTO notifications (user_id, kind, payload, created_at)
       SELECT $1, 'admin_note',
              jsonb_build_object('title', 'qa4 update ' || i, 'body', 'Details of update ' || i,
                                 'link', CASE WHEN i = 18 THEN '/vendor/profile' END),
              now() - make_interval(mins => 18 - i)
         FROM generate_series(1, 18) AS i`,
      [userId]
    );
  } finally {
    await client.end();
  }
  return { vendor, vendorId };
}

test.describe("qa4 vendor home and notifications", () => {
  test("QA4-V3: unread notifications beyond the first 15 are reachable from a See all page", async ({ page }, testInfo) => {
    await approvedVendor(page, runTag(testInfo));

    await page.goto("/vendor");
    const card = page.getByTestId("vendor-notifications");
    await expect(card.locator("li")).toHaveCount(6);
    await expect(card.getByTestId("vendor-notifications-see-all")).toHaveText(/See all 18 updates/);

    // The bell lists 15 and links to the rest.
    const bell = page.getByTestId("notification-bell").filter({ visible: true }).first();
    await bell.click();
    const panel = page.locator("#notification-panel");
    await expect(panel.locator("li")).toHaveCount(15);
    await expect(panel.getByText("qa4 update 1", { exact: true })).toHaveCount(0);
    await panel.getByTestId("notifications-see-all").click();
    await page.waitForURL("**/notifications");

    // The full list: the oldest is there, readable and can be marked read.
    const feed = page.getByTestId("notifications-feed");
    await expect(feed.getByTestId("notification-item")).toHaveCount(18);
    const oldest = feed.getByTestId("notification-item").filter({ has: page.getByText("Details of update 1", { exact: true }) });
    await expect(oldest).toHaveAttribute("data-unread", "1");
    await expect(oldest.getByText("Details of update 1", { exact: true })).toBeVisible();
    await oldest.getByRole("button", { name: /Mark .* as read/ }).click();
    await expect(page.getByText(/^17 unread\./)).toBeVisible();
    await expect(oldest).not.toHaveAttribute("data-unread", "1");

    // Unread filter and mark all.
    await page.getByRole("link", { name: /^Unread/ }).click();
    await expect(feed.getByTestId("notification-item")).toHaveCount(17);
    await feed.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByText(/You're all caught up/)).toBeVisible();
  });

  test("QA-096: notification titles and the areas Change link are 44 px tap targets at 390", async ({ page }, testInfo) => {
    test.skip(!isMobile(page), "phone tap targets");
    await approvedVendor(page, `${runTag(testInfo)}t`); // its own vendor (QA4-V3 uses the plain tag)

    await page.goto("/vendor");
    const title = page.getByTestId("vendor-notifications").getByRole("link", { name: /qa4 update 18/ });
    const tb = (await title.boundingBox())!;
    expect(tb.height).toBeGreaterThanOrEqual(44);
    const seeAll = (await page.getByTestId("vendor-notifications-see-all").boundingBox())!;
    expect(seeAll.height).toBeGreaterThanOrEqual(44);

    await page.goto("/vendor/areas");
    const change = page.getByRole("link", { name: "Change", exact: true });
    const cb = (await change.boundingBox())!;
    expect(cb.height).toBeGreaterThanOrEqual(44);

    await page.goto("/notifications");
    const link = page.getByTestId("notifications-feed").getByRole("link", { name: /qa4 update 18/ });
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
