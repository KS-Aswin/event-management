import { test, expect, loginAsAdmin } from "./helpers";

// QA round 5 (admin) repro specs. Local DB only (loginAsAdmin refuses a
// non-localhost DATABASE_URL). QA-106 is fixed (fix5): a normal test now.

test("QA-106 (QA5-ADM-1): searching /admin/users for a 10-digit phone number lists the user instead of crashing", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  // lib/admin/ops.ts searchUsers(): an all-digit query also matched `u.id = Number(q)`.
  // 9847011122 is outside the int4 range, so Postgres threw "value out of range
  // for type integer" and the page showed the error boundary. The id clause is
  // now only added when the number fits int4.
  await page.goto("/admin/users?q=9847011122");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
});

test("QA-106 (QA5-ADM-1b): a digit string just past the int4 range does not crash the search", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/users?q=2147483648");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
});
