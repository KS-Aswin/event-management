import { test, expect } from "./helpers";

// qa5 customer round. Repro specs for bugs found on the local build, fixed in
// fix5. They use the seeded vendor 2.
//   QA5-C1  Quote request for a date more than 3 years ahead: the date input
//           has no max, and the server error reads "Please choose a event
//           date within the next three years." ("a event").
//   QA5-C2  Vendor gallery lightbox: closing it (Escape or Close) leaves
//           focus on <body> instead of the photo button that opened it.
//   QA5-C3  /search result cards: every shortlist button has the same name
//           "Save to shortlist" with no vendor name.

test("QA-100 (QA5-C1): far-future quote date gets a max on the input and grammatical error copy", async ({ page }) => {
  await page.goto("/vendors/2");
  await page.getByRole("button", { name: "Request quote" }).first().click();
  const d = page.locator("dialog[open],[role=dialog]");
  const date = d.locator("[name=eventDate]");
  // max = today (India) + 3 years, the same rule as lib/enquiries-create.ts.
  const min = await date.getAttribute("min");
  expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const max = new Date(`${min}T00:00:00Z`);
  max.setUTCFullYear(max.getUTCFullYear() + 3);
  expect(await date.getAttribute("max")).toBe(max.toISOString().slice(0, 10));
  await date.fill("2035-01-01");
  await d.locator("[name=name]").fill("e2e QA5 Far");
  await d.locator("[name=phone]").fill("9847011177");
  await d.getByRole("button", { name: "Send request" }).click();
  // The browser blocks the out-of-range date: nothing is sent.
  expect(await date.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true);
  await expect(page.getByText(/choose a event date/i)).toHaveCount(0);

  // The server rule (a request that skips the form) has grammatical copy.
  const res = await page.request.post("/api/vendors/2/quotes", {
    data: { name: "e2e QA5 Far", phone: "9847011177", eventDate: "2035-01-01" },
    timeout: 60_000,
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.field).toBe("eventDate");
  expect(body.error).toBe("Choose a date within the next three years.");
});

test("QA-101 (QA5-C2): closing the photo lightbox returns focus to the photo that opened it", async ({ page }) => {
  await page.goto("/vendors/2");
  const opener = page.locator("[aria-label^='Open photo 1']").first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Same with the Close button.
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close photo viewer" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("QA-102 (QA5-C3): search card shortlist buttons name the vendor", async ({ page }) => {
  await page.goto("/search?category=Photography");
  // Each vendor card's button names that card's vendor (test data can hold two
  // vendors with the same name, so compare per card, not for uniqueness).
  const cards = await page.locator("article").evaluateAll((as) =>
    as
      .map((a) => ({
        name: a.querySelector("h2 a")?.textContent?.trim() ?? "",
        label: a.querySelector("button[aria-label*='hortlist']")?.getAttribute("aria-label") ?? null,
      }))
      .filter((c) => c.label !== null)
  );
  expect(cards.length).toBeGreaterThan(1);
  for (const c of cards) expect(c.label).toBe(`Save ${c.name} to shortlist`);

  // Saving flips the name to "Remove <vendor> from shortlist".
  const first = page.locator("article").filter({ has: page.locator("button[aria-label*='hortlist']") }).first();
  await first.getByRole("button", { name: `Save ${cards[0].name} to shortlist` }).click();
  await expect(first.getByRole("button", { name: `Remove ${cards[0].name} from shortlist` })).toBeVisible();
});
