import { test, expect, checkScreen, isMobile, loginAsAdmin } from "./helpers";

// QA round 1 admin layout fixes.
// QA-020: at 390px a vendor row gives the name the whole first line; the
//         category and district go underneath instead of squeezing it.
// QA-028: audit-log entity links are at least 44px tall on a phone.
// Uses the seeded vendors and whatever audit rows exist (local DB).

test("admin vendors list: names are not cut short by category text (QA-020)", async ({ page, diag }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/vendors?status=all");
  await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
  const names = page.getByTestId("vendor-row-name");
  const n = await names.count();
  test.skip(n === 0, "no vendors in the local DB");

  const rows = await names.evaluateAll((els) =>
    els.map((el) => {
      const row = el.closest("a")!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? "").trim(),
        truncated: el.scrollWidth > el.clientWidth + 1,
        width: r.width,
        rowWidth: row.width,
      };
    })
  );
  // Short and medium names (the seeded ones) fit in full at both widths.
  for (const r of rows.filter((x) => x.text.length <= 26)) {
    expect.soft(r.truncated, `"${r.text}" is truncated`).toBe(false);
  }
  if (isMobile(page)) {
    // A long name may truncate, but only against the row edge, never because
    // category / status text shares its line.
    for (const r of rows.filter((x) => x.truncated)) {
      expect.soft(r.width, `"${r.text}" only gets ${Math.round(r.width)}px`).toBeGreaterThan(r.rowWidth * 0.6);
    }
  }
  await checkScreen(page, diag, testInfo, "qa1-admin-vendors");
});

test("admin audit log: entity links are 44px tap targets on phones (QA-028)", async ({ page, diag }, testInfo) => {
  await loginAsAdmin(page, testInfo);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  const links = page.getByTestId("audit-entity-link");
  test.skip((await links.count()) === 0, "no linked audit entries in the local DB");
  if (isMobile(page)) {
    const boxes = await links.evaluateAll((els) => els.slice(0, 10).map((e) => e.getBoundingClientRect().height));
    for (const h of boxes) expect.soft(h).toBeGreaterThanOrEqual(44);
  }
  await checkScreen(page, diag, testInfo, "qa1-admin-audit");
});
