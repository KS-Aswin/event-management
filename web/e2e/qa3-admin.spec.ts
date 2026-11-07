import { test, expect, loginAsAdmin } from "./helpers";

// QA round 3 (admin) reproductions, fixed in the qa3 fix round (group d):
// QA-060 unhide, QA-072 category names, QA-074 duplicate chip at 390px,
// QA-075 focus after Move up/down, QA-083 analytics scroll region.
// Uses the local DB; restores what it changes. API side: tests/qa3-admin.test.mjs.

type QueueItem = { id: number; vendor: { id: number; name: string } };

test("QA3-ADM-1: an admin-hidden photo can be shown again from the admin console", async ({ page }, testInfo) => {
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

test("QA3-ADM-2: admin vendor filter uses the category display name", async ({ page }, testInfo) => {
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

test("QA-060: the Hidden by Vela tab lists a hidden photo and Unhide puts it back", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  const origin = new URL(page.url()).origin;
  const H = { origin };
  const q = (await (await page.request.get("/api/admin/media?tab=recent")).json()) as { items: QueueItem[] };
  const item = q.items[0];
  test.skip(!item, "no recent media to hide");
  const hide = await page.request.post(`/api/admin/media/${item.id}/decision`, {
    headers: H,
    data: { action: "hide", reason: "QA3 fix: hidden by mistake" },
  });
  expect(hide.status()).toBe(200);
  let restored = false;
  try {
    await page.goto("/admin/media?tab=hidden");
    await expect(page.getByRole("link", { name: /Hidden by Vela/ })).toHaveAttribute("aria-current", "page");
    const card = page.locator(`[data-media-id="${item.id}"]`);
    await expect(card).toContainText("QA3 fix: hidden by mistake");
    await expect(card).not.toContainText("admin:");
    await card.getByRole("button", { name: /^Unhide/ }).click();
    await expect(page.getByText("Back on the public profile.")).toBeVisible();
    await expect(card).toHaveCount(0);
    restored = true;
  } finally {
    if (!restored) await page.request.post(`/api/admin/media/${item.id}/decision`, { headers: H, data: { action: "unhide" } });
  }
});

test("QA-075: keyboard focus stays on the Move button after a move", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/taxonomy");
  await expect(page.getByRole("heading", { level: 1, name: "Taxonomy" })).toBeVisible();
  const down = page.getByRole("button", { name: /^Move down: .+$/ }).first();
  const name = (await down.getAttribute("aria-label"))!.replace(/^Move down: /, "");
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: `Moved "${name}" down.` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Move down: ${name}` })).toBeFocused();
  // Move it back with the keyboard too; focus stays on the same item.
  // The list reloads after a move; wait until its buttons are usable again.
  const up = page.getByRole("button", { name: `Move up: ${name}` });
  await expect(up).toBeEnabled();
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: `Moved "${name}" up.` })).toBeVisible();
  // Back at the top, Move up is unavailable, so focus goes to Move down.
  const active = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  expect(active).toMatch(new RegExp(`^Move (up|down): `));
  expect(active).toContain(name);
});

test("QA-074: the duplicate chip stays inside the card at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/vendors?status=all");
  const chips = page.locator("[data-testid='duplicate-chip']");
  test.skip((await chips.count()) === 0, "no possible-duplicate listing in the local DB");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const box of await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(390);
  }
});

test("QA-083: the analytics signups table can be reached with the keyboard", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/analytics");
  const region = page.getByRole("region", { name: "Signups per day (scrollable)" });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
});
