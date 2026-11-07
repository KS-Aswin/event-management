import { test, expect, checkScreen, loginAsAdmin } from "./helpers";

// P1 admin queues: an admin opens every queue page (and its tabs) at 390px
// and 1440px with no console errors, no horizontal scroll and real tap
// targets. Pages with data or empty states both pass.

const PAGES: { path: string; heading: string | RegExp; name: string }[] = [
  { path: "/admin", heading: "Today", name: "admin-today" },
  { path: "/admin/reviews", heading: /Reviews/, name: "admin-reviews" },
  { path: "/admin/reviews?tab=hidden", heading: /Reviews/, name: "admin-reviews-hidden" },
  { path: "/admin/media", heading: /Media/, name: "admin-media-pre" },
  { path: "/admin/media?tab=recent", heading: /Media/, name: "admin-media-recent" },
  { path: "/admin/media?tab=reported", heading: /Media/, name: "admin-media-reported" },
  { path: "/admin/taxonomy", heading: /Taxonomy/, name: "admin-taxonomy" },
  { path: "/admin/taxonomy/custom", heading: "Custom offerings", name: "admin-custom" },
  { path: "/admin/users", heading: /Users/, name: "admin-users" },
  { path: "/admin/enquiries", heading: /Enquiries/, name: "admin-enquiries" },
  { path: "/admin/audit", heading: /Audit/, name: "admin-audit" },
];

test("admin: every queue page renders cleanly", async ({ page, diag }, testInfo) => {
  test.setTimeout(240_000);
  await loginAsAdmin(page, testInfo);
  for (const p of PAGES) {
    const res = await page.goto(p.path);
    expect(res?.status(), `${p.path} status`).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    // Other suites' fixtures may point at placeholder files that 404 (not this page's fault).
    await checkScreen(page, diag, testInfo, p.name, { ignoreErrors: [/placeholder-\d+-\d+\.jpg/] });
  }
});

test("admin: Today tiles link to their queues", async ({ page }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin");
  for (const href of ["/admin/vendors?tab=pending", "/admin/reviews", "/admin/media", "/admin/taxonomy/custom", "/admin/documents"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeAttached();
  }
});
