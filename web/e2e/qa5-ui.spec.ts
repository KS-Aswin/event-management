import { test, expect, signUp, runTag, type Creds } from "./helpers";

// QA round 5 (cross-cutting UI). Reproduces QA5-UI-1: a customer name that is
// one long unbroken word (allowed: 80 characters max) makes /my scroll
// sideways at 390px. The same name also overflows the vendor's /vendor,
// /vendor/leads, /vendor/leads/[id] and the admin's /admin/users/[id].
// Marked test.fail until the headings/names wrap (overflow-wrap:anywhere).

test.fail("QA-109 (QA5-UI-1): long unbroken customer name does not make /my scroll sideways at 390", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tag = runTag(testInfo);
  const creds: Creds = {
    name: `qa5Venkatasubramaniankrishnamoorthyparameswaranpillai${tag}`.slice(0, 80),
    email: `e2e-qa5-ui-longname-${tag}@example.com`,
    password: "qa5-ui-password-1",
  };
  await signUp(page, "customer", creds);
  await page.goto("/my");
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
});
