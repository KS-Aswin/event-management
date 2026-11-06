import { test, expect } from "./helpers";

// qa5 customer round. Repro specs for bugs found on the local build
// (marked test.fail until fixed). Both use the seeded vendor 2.
//   QA5-C1  Quote request for a date more than 3 years ahead: the date input
//           has no max, and the server error reads "Please choose a event
//           date within the next three years." ("a event").
//   QA5-C2  Vendor gallery lightbox: closing it (Escape or Close) leaves
//           focus on <body> instead of the photo button that opened it.
//   QA5-C3  /search result cards: every shortlist button has the same name
//           "Save to shortlist" with no vendor name.

test.fail("QA-100 (QA5-C1): far-future quote date gets a max on the input and grammatical error copy", async ({ page }) => {
  await page.goto("/vendors/2");
  await page.getByRole("button", { name: "Request quote" }).first().click();
  const d = page.locator("dialog[open],[role=dialog]");
  const date = d.locator("[name=eventDate]");
  expect(await date.getAttribute("max")).toBeTruthy();
  await date.fill("2035-01-01");
  await d.locator("[name=name]").fill("e2e QA5 Far");
  await d.locator("[name=phone]").fill("9847011177");
  await d.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/choose a event date/)).toHaveCount(0);
});

test.fail("QA-101 (QA5-C2): closing the photo lightbox returns focus to the photo that opened it", async ({ page }) => {
  await page.goto("/vendors/2");
  const opener = page.locator("[aria-label^='Open photo 1']").first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test.fail("QA-102 (QA5-C3): search card shortlist buttons name the vendor", async ({ page }) => {
  await page.goto("/search?category=Photography");
  const labels = await page.locator("button[aria-label*='hortlist']").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  expect(labels.length).toBeGreaterThan(1);
  expect(new Set(labels).size).toBe(labels.length);
});
