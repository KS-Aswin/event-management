import pg from "pg";
import { test, expect, runTag, signUp, type Creds } from "./helpers";

// qa4 customer round. Repro specs for bugs found on the local build
// (marked test.fail until fixed):
//   QA4-C1  /my/enquiries/[id]: after the vendor replies with a message only
//           (status "responded", no offer), the Offer card says "No offer was
//           sent for this enquiry." (past tense, reads as closed) although the
//           enquiry is still open and an offer can still come. The guest
//           tracking page says "No offer yet ..." for the same state.
// Users are e2e-* (removed by the global cleanup).

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

test("QA4-C1: open enquiry with a message-only vendor reply doesn't say 'No offer was sent'", async ({ page }, testInfo) => {
  const tag = runTag(testInfo);
  const cust: Creds = { name: "Qa4 Offerless", email: `e2e-qa4-customer-spec-${tag}@example.com`, password: "e2e-pass-12345" };
  await signUp(page, "customer", cust);

  const c = client();
  await c.connect();
  let enquiryId: number;
  try {
    const u = await c.query("SELECT id FROM users WHERE email = $1", [cust.email]);
    const v = await c.query("SELECT id, owner_id FROM vendors WHERE status = 'approved' AND owner_id IS NOT NULL ORDER BY id LIMIT 1");
    const q = await c.query(
      `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, status, guest_count, message)
       VALUES ($1, $2, 'Qa4 Offerless', '+919847044444', (now() + interval '120 days')::date, 'responded', 50, 'qa4 spec enquiry')
       RETURNING id`,
      [v.rows[0].id, u.rows[0].id]
    );
    enquiryId = q.rows[0].id;
    await c.query(
      "INSERT INTO quote_messages (quote_request_id, sender_role, sender_user_id, body) VALUES ($1, 'vendor', $2, 'qa4 message-only reply')",
      [enquiryId, v.rows[0].owner_id]
    );
  } finally {
    await c.end();
  }

  await page.goto(`/my/enquiries/${enquiryId}`);
  await expect(page.getByText("qa4 message-only reply")).toBeVisible();
  // The enquiry is open (Withdraw is offered), so the offer copy must not read as final.
  await expect(page.getByRole("button", { name: "Withdraw enquiry" })).toBeVisible();
  await expect(page.getByText("No offer was sent for this enquiry.")).toHaveCount(0);
});
