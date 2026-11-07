import { test, expect } from "./helpers";

// QA round 5 (security/a11y/links/perf). Each test reproduces a bug found in
// qa5; QA-111 was fixed in the fix5 round.

// QA5-SEC-A11Y-1: on the guest tracking page /enquiry/[token], the vendor
// name inside "Your enquiry to <vendor>" is a link with no underline whose
// colour (#0f6d52) is only 2.55:1 against the surrounding text (axe
// link-in-text-block, WCAG 1.4.1). Same pattern QA-083 fixed on /signup.
test("QA-111 (QA5-SEC-A11Y-1): vendor link in the /enquiry/[token] heading is distinguishable without colour", async ({ page }) => {
  const list = await page.request.get("/api/vendors");
  const vendors = ((await list.json()) as { vendors?: Array<{ id: number }> }).vendors ?? [];
  expect(vendors.length).toBeGreaterThan(0);
  const vendorId = vendors[0].id;
  const res = await page.request.post(`/api/vendors/${vendorId}/quotes`, {
    data: {
      name: "QA5 Test Guest",
      phone: "9876500005",
      eventDate: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
      message: "QA5 a11y repro",
      contactEmail: `e2e-qa5-a11y-${Date.now()}@example.com`,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { enquiry: { trackingPath: string } };
  await page.goto(body.enquiry.trackingPath);
  const link = page.locator(`a[href="/vendors/${vendorId}"]`).first();
  await expect(link).toBeVisible();
  const deco = await link.evaluate((a) => getComputedStyle(a).textDecorationLine);
  expect(deco).toContain("underline");
});

// QA5-SEC-A11Y-2 (/admin/reviews star rating: aria-label on a span with no
// role, while the star glyphs are aria-hidden, so the rating is not announced)
// needs a reported review in the admin queue; it is covered by the axe repro
// in the qa5 notes rather than a spec here.
