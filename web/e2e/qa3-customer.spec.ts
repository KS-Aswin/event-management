import pg from "pg";
import { test, expect, runTag, signUp, type Creds } from "./helpers";

// qa3 fix round, customer group. Regression specs for:
//   QA-062  /search filter sidebar slid under a two-row header at 768-870px
//   QA-063  multi-vendor send sheet prefilled a date every selected vendor
//           already has an open enquiry for (first Send always 409)
// QA-061 is covered by QA3-UI-1 in qa3-ui.spec.ts. Users are e2e-* (removed by
// the global cleanup).

function client() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("needs a localhost DATABASE_URL");
  return new pg.Client({ connectionString: url });
}

test("QA-062: at tablet widths the sticky filter sidebar sits below the real header height", async ({ page }) => {
  for (const width of [768, 820, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/search?verified=1");
    const clear = page.getByRole("button", { name: "Clear all" }).or(page.getByRole("link", { name: "Clear all" })).first();
    await expect(clear).toBeVisible();
    // Scroll 300px, but not so far that the end of the results column carries
    // the sidebar up with it (normal sticky behaviour when results are short).
    const room = await page.evaluate(() => {
      const aside = document.getElementById("search-filters-panel")!;
      const parent = aside.parentElement!;
      const contentBottom = parent.getBoundingClientRect().bottom - parseFloat(getComputedStyle(parent).paddingBottom);
      const stickyTop = parseFloat(getComputedStyle(aside).top);
      return Math.floor(contentBottom - aside.getBoundingClientRect().height - stickyTop);
    });
    await page.mouse.wheel(0, Math.max(0, Math.min(300, room - 2)));
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const header = document.querySelector("header")!.getBoundingClientRect();
      const el = [...document.querySelectorAll<HTMLElement>("a,button")].find((e) => e.textContent?.trim() === "Clear all" && e.offsetParent)!;
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const cssVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
      return { headerBottom: header.bottom, top: b.top, tappable: !!hit && el.contains(hit), cssVar, headerH: header.height };
    });
    expect(r.tappable, `Clear all must be tappable at ${width}px`).toBe(true);
    expect(r.top, `Clear all below the header at ${width}px`).toBeGreaterThanOrEqual(r.headerBottom);
    expect(Math.abs(r.cssVar - r.headerH), "--header-h is the real header height").toBeLessThanOrEqual(1);
  }
});

test("QA-063: the multi-vendor sheet doesn't prefill a date every selected vendor was already sent", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const cust: Creds = { name: "Qa3 Multi", email: `e2e-cust-qa3c-${tag}@example.com`, password: "e2e-pass-12345" };
  await signUp(page, "customer", cust);

  const c = client();
  await c.connect();
  let names: string[] = [];
  try {
    const userId = (await c.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [cust.email])).rows[0].id;
    const vendors = (
      await c.query<{ id: number; name: string }>(
        "SELECT id, name FROM vendors WHERE status = 'approved' AND published IS NOT FALSE ORDER BY id LIMIT 2"
      )
    ).rows;
    expect(vendors.length).toBe(2);
    names = vendors.map((v) => v.name);
    for (const v of vendors) {
      await c.query("INSERT INTO favorites (customer_id, vendor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, v.id]);
      await c.query(
        `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, message, guest_count)
         VALUES ($1, $2, $3, '+919847012345', (now() AT TIME ZONE 'Asia/Kolkata')::date + 150, 'qa3 multi dup', 120)`,
        [v.id, userId, cust.name]
      );
    }
  } finally {
    await c.end();
  }

  await page.goto("/my/shortlist");
  for (const n of names) await page.getByLabel(`Select ${n}`).check();
  await page.getByRole("button", { name: /Send enquiry to 2/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Other details still come from the earlier enquiry; the duplicate date doesn't.
  await expect(dialog.getByRole("spinbutton", { name: "Guests" })).toHaveValue("120");
  await expect(dialog.getByLabel("Event date")).toHaveValue("");
});
