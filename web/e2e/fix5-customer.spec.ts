import pg from "pg";
import { test, expect, runTag, signUp, type Creds } from "./helpers";

// fix5 customer: QA-100 on the multi-vendor sheet (/my/shortlist "Send
// enquiry to N"). The event date input is capped at today + 3 years, the same
// rule the server applies (lib/enquiries-create.ts). The single-vendor sheet
// is covered by e2e/qa5-customer.spec.ts. The customer is custtest-fix5-*
// (not e2e-*, which another suite's global setup deletes) and is removed in
// afterAll.

let customer: Creds | undefined;

test.afterAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || !customer) return;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const ids = (await c.query("SELECT id FROM users WHERE email = $1", [customer.email])).rows.map((r) => r.id);
    if (ids.length) {
      await c.query("DELETE FROM quote_requests WHERE customer_id = ANY($1::int[])", [ids]);
      await c.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    }
  } finally {
    await c.end();
  }
});

test("QA-100: the multi-vendor enquiry sheet caps the event date at three years ahead", async ({ page }, testInfo) => {
  customer = {
    name: "Fix5 Customer",
    email: `custtest-fix5-customer-${runTag(testInfo)}-${Date.now()}@example.com`,
    password: "fix5-customer-password-1",
  };
  const res = await page.request.get("/api/vendors?limit=2&sort=rating", { timeout: 60_000 });
  expect(res.ok()).toBeTruthy();
  const vendors = ((await res.json()) as { vendors: { id: number; name: string }[] }).vendors;
  expect(vendors.length).toBe(2);

  await signUp(page, "customer", customer);
  for (const v of vendors) {
    const saved = await page.request.post(`/api/vendors/${v.id}/favorite`, { timeout: 60_000 });
    expect(saved.ok()).toBeTruthy();
  }

  await page.goto("/my/shortlist");
  for (const v of vendors) await page.getByLabel(`Select ${v.name}`).check();
  await page.getByRole("button", { name: "Send enquiry to 2" }).click();
  const dialog = page.getByRole("dialog");
  const date = dialog.getByLabel("Event date");
  const min = await date.getAttribute("min");
  expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const max = new Date(`${min}T00:00:00Z`);
  max.setUTCFullYear(max.getUTCFullYear() + 3);
  expect(await date.getAttribute("max")).toBe(max.toISOString().slice(0, 10));
});
