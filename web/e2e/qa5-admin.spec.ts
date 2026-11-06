import { test, expect, loginAsAdmin } from "./helpers";

// QA round 5 (admin) repro specs. Local DB only (loginAsAdmin refuses a
// non-localhost DATABASE_URL). Marked test.fail until the bugs are fixed.

test.fail("QA-106 (QA5-ADM-1): searching /admin/users for a 10-digit phone number lists the user instead of crashing", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  // lib/admin/ops.ts searchUsers(): an all-digit query also adds `u.id = Number(q)`.
  // 9847011122 is outside the int4 range, so Postgres throws "value out of range
  // for type integer" and the page shows the error boundary ("Something went wrong").
  await page.goto("/admin/users?q=9847011122");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
});
