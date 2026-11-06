import type { Page } from "@playwright/test";
import { test, expect } from "./helpers";

// QA1 fix round, public pages: layout and accessibility checks that the API
// tests can't see. Uses the seeded vendors only (no accounts are created).
// QA-009 fixed CTA bar vs footer, QA-011 /e cards at 390px, QA-016 quote
// dialog focus loop, QA-025 WHERE select at 390px, QA-026 star contrast,
// QA-027 mobile filter sheet is a modal dialog.

async function firstVendorPath(page: Page): Promise<string> {
  await page.goto("/search");
  const href = await page.locator('main a[href^="/vendors/"]').first().getAttribute("href");
  expect(href, "search lists at least one vendor").toBeTruthy();
  return href!.split("#")[0];
}

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const parseRgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

for (const width of [390, 768]) {
  test(`QA-009: the vendor action bar never covers the footer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const path = await firstVendorPath(page);
    await page.goto(path);
    const bar = page.getByTestId("vendor-mobile-cta");
    await expect(bar).toBeVisible();
    // Mid-page the bar is pinned to the bottom of the screen.
    const mid = await bar.boundingBox();
    expect(Math.round(mid!.y + mid!.height)).toBeLessThanOrEqual(page.viewportSize()!.height + 1);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const privacy = page.locator("footer").getByRole("link", { name: "Privacy" });
    await expect(privacy).toBeInViewport();
    const box = (await privacy.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(box.y, "the footer starts below the bar, not under it").toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
    // And the link is what a tap there hits.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.textContent?.trim() ?? null,
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    expect(hit).toBe("Privacy");
  });
}

test("QA-011: /e cards shrink for a long vendor name; no sideways scroll at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e/hindu-wedding");
  const name = page.locator('main a[href^="/vendors/"] .font-semibold').first();
  await expect(name).toBeVisible();
  // A real business name with one long word (or an unbroken string).
  await name.evaluate((el) => {
    el.textContent = "Sreevalsam" + "Kalyanamandapam".repeat(4);
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const card = await page.locator("main li.card").first().boundingBox();
  expect(card!.x + card!.width).toBeLessThanOrEqual(390);
});

test("QA-016: Tab stays inside the quote dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const path = await firstVendorPath(page);
  await page.goto(path);
  await page.locator("aside").getByRole("button", { name: "Request quote" }).click();
  const dialog = page.getByRole("dialog", { name: /Request a quote from/ });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      const a = document.activeElement;
      return !!d && !!a && a !== document.body && d.contains(a);
    });
    expect(inside, `focus left the dialog after ${i + 1} Tab presses`).toBe(true);
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.querySelector("dialog[open]")?.contains(document.activeElement))).toBe(true);
  }
});

test("QA-025: the WHERE select shows 'Anywhere in Kerala' in full at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const select = page.getByRole("combobox", { name: "Where: district" });
  await expect(select).toBeVisible();
  for (const label of ["Anywhere in Kerala", "Thiruvananthapuram"]) {
    const fits = await select.evaluate((el: HTMLSelectElement, text) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const textW = ctx.measureText(text).width;
      // Room for the text: the box minus padding and the native arrow (~20px).
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
      return { textW, room };
    }, label);
    expect(fits.textW, `${label} fits`).toBeLessThanOrEqual(fits.room);
  }
});

test("QA-026: rating stars have at least 3:1 contrast", async ({ page }) => {
  const path = await firstVendorPath(page);
  await page.goto(path);
  const star = page.locator(".text-gold").first();
  await expect(star).toBeAttached();
  const color = parseRgb(await star.evaluate((el) => getComputedStyle(el).color));
  for (const bg of [[255, 255, 255], [246, 247, 248]]) {
    expect(contrast(color, bg)).toBeGreaterThanOrEqual(3);
  }
});

test("QA-027: the mobile filter sheet is a labelled modal dialog that returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search");
  const toggle = page.getByRole("button", { name: /^Filters/ });
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "Refine results" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
  // On desktop the same panel is a plain sidebar, not a dialog.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
