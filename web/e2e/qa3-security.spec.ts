import { test, expect, signUp, loginAsAdmin, runTag } from "./helpers";

// QA round 3 (security/a11y/links/perf). Reproduces bugs found in qa3; each
// test is test.fail until the bug is fixed.
//
// QA3-SEC-1 (QA-056 leftover): a vendor with an open session whose listing is
// suspended should see the admin's reason on /login?suspended=1. The fix sets a
// signed "vela_suspended" note only when proxy.ts clears the cookie on /login.
// But any API call the open page makes first (the notification bell polls
// /api/notifications) gets 403 and clears vela_session WITHOUT that note, so
// the next page load shows only the generic "This account is suspended" text.
test.fail("QA3-SEC-1: suspension reason survives a background API call after suspension", async ({ browser, page }, testInfo) => {
  const tag = runTag(testInfo);
  const creds = { name: "E2E QA3 Susp", email: `e2e-qa3-susp-${tag}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: "e2e-qa3-password-1" };
  await signUp(page, "vendor", creds);

  // Give the vendor an approved listing directly (onboarding is covered elsewhere).
  const created = await page.request.post("/api/vendor/listing", { data: { name: "E2E QA3 Suspend", primaryCategoryId: 8, districtId: 1 } });
  expect(created.status()).toBe(201);
  const vendorId = (await created.json()).listing.id as number;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("UPDATE vendors SET status = 'approved', published = true WHERE id = $1", [vendorId]);
  } finally {
    await client.end();
  }

  // Admin suspends the listing with a reason, in a separate browser context.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await loginAsAdmin(adminPage, testInfo);
  const decided = await adminPage.request.post(`/api/admin/vendors/${vendorId}/decision`, {
    data: { action: "suspend", reason: "QA3 fake reviews on the listing", expectedStatus: "approved" },
  });
  expect(decided.status()).toBe(200);
  await adminCtx.close();

  // The vendor's open page polls notifications before they click anywhere.
  const poll = await page.request.get("/api/notifications?limit=15");
  expect(poll.status()).toBe(403);

  await page.goto("/vendor/leads");
  await page.waitForURL(/\/login\?suspended=1/);
  await expect(page.getByText("QA3 fake reviews on the listing")).toBeVisible();
});
