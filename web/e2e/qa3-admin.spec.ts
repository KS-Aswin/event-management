import { test, expect, loginAsAdmin } from "./helpers";

// QA round 3 (admin) reproductions. Each test is expected to fail until the
// bug is fixed. Uses the local DB; restores what it changes.

type QueueItem = { id: number; vendor: { id: number; name: string } };

test.fail("QA3-ADM-1: an admin-hidden photo can be shown again from the admin console", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  const origin = new URL(page.url()).origin;
  const H = { origin };
  // Any public upload of a live vendor.
  const q = (await (await page.request.get("/api/admin/media?tab=recent")).json()) as { items: QueueItem[] };
  const item = q.items[0];
  test.skip(!item, "no recent media to hide");
  const hide = await page.request.post(`/api/admin/media/${item.id}/decision`, {
    headers: H,
    data: { action: "hide", reason: "QA3 repro: hidden by mistake" },
  });
  expect(hide.status()).toBe(200);
  try {
    // The hide dialog says "Only an admin can show it again", but the hidden
    // item is in none of the media tabs and the listing's media grid offers no
    // action for it, so the admin can't undo a mistaken hide.
    await page.goto(`/admin/vendors/${item.vendor.id}`);
    const card = page.locator(`[data-media-id="${item.id}"]`);
    await expect(card).toContainText("Hidden");
    await expect(card.getByRole("button", { name: /show|unhide|restore|approve/i })).toBeVisible({ timeout: 5_000 });
  } finally {
    await page.request.post(`/api/admin/media/${item.id}/decision`, { headers: H, data: { action: "approve" } });
  }
});

test.fail("QA3-ADM-2: admin vendor filter uses the category display name", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  const cats = (await (await page.request.get("/api/admin/categories")).json()) as {
    categories: { id: number; name: string; display_name: string; active: boolean }[];
  };
  const renamed = cats.categories.find((c) => c.active && c.display_name.trim() !== c.name);
  test.skip(!renamed, "no renamed category");
  await page.goto("/admin/vendors?status=all");
  const labels = await page.locator("select[name=category] option").allInnerTexts();
  expect(labels).toContain(renamed!.display_name);
});
