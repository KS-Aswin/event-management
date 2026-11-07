// In-app notifications for enquiry events (PRODUCT_PLAN P2-13). Every
// helper takes the caller's transaction client, so the notification commits
// or rolls back with the event that caused it. No pool import here (lib/db.ts
// imports this file), only the type-only notify() helper.

import type { PoolClient } from "pg";
import { notify } from "@/lib/admin/notify";
import { maskMessageContacts } from "@/lib/enquiry-status";

type Client = Pick<PoolClient, "query">;

export interface EnquiryParties {
  id: number;
  status: string;
  customerId: number | null;
  customerName: string;
  vendorId: number;
  vendorName: string;
  vendorOwnerId: number | null;
}

export async function loadParties(client: Client, quoteId: number): Promise<EnquiryParties | null> {
  const r = await client.query<{
    id: number;
    status: string;
    customer_id: number | null;
    name: string;
    vendor_id: number;
    vendor_name: string;
    owner_id: number | null;
  }>(
    `SELECT q.id, q.status, q.customer_id, q.name, q.vendor_id, v.name AS vendor_name, v.owner_id
       FROM quote_requests q JOIN vendors v ON v.id = q.vendor_id WHERE q.id = $1`,
    [quoteId]
  );
  const p = r.rows[0];
  if (!p) return null;
  return {
    id: p.id,
    status: p.status,
    customerId: p.customer_id,
    customerName: p.name,
    vendorId: p.vendor_id,
    vendorName: p.vendor_name,
    vendorOwnerId: p.owner_id,
  };
}

export const customerLink = (id: number) => `/my/enquiries/${id}`;
export const vendorLink = (id: number) => `/vendor/leads/${id}`;

/**
 * One unread notification per (user, kind, enquiry): a second message while
 * the first is still unread refreshes it instead of stacking up, so the bell
 * count stays meaningful.
 */
export async function notifyOnce(
  client: Client,
  userId: number | null,
  kind: string,
  quoteId: number,
  title: string,
  body: string | null,
  link: string
): Promise<void> {
  if (userId === null) return;
  const payload = JSON.stringify({ title, body, link, quoteId });
  const up = await client.query(
    `UPDATE notifications SET payload = $4::jsonb, created_at = now()
      WHERE user_id = $1 AND kind = $2 AND read_at IS NULL AND payload->>'quoteId' = $3`,
    [userId, kind, String(quoteId), payload]
  );
  if (up.rowCount) return;
  await notify(client, userId, kind, title, body, link, { quoteId });
}

/** First line of a message for a notification body (masked like the thread). */
export function preview(body: string): string {
  const t = maskMessageContacts(body).text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

/**
 * Tells the other side about a status change. `actor` is who made it.
 * Vendor -> customer: booked, declined. Customer -> vendor: booked,
 * withdrawn, accepted (accepting an offer has its own message in
 * lib/enquiry-thread.ts, so it isn't repeated here).
 */
export async function notifyStatusChange(
  client: Client,
  quoteId: number,
  to: string,
  actor: "vendor" | "customer" | "system"
): Promise<void> {
  if (actor === "system") return;
  const p = await loadParties(client, quoteId);
  if (!p) return;
  if (actor === "vendor") {
    if (to === "booked") {
      await notify(client, p.customerId, "enquiry.booked", `${p.vendorName} confirmed your booking`, null, customerLink(quoteId), { quoteId });
    } else if (to === "declined") {
      await notify(
        client,
        p.customerId,
        "enquiry.declined",
        `${p.vendorName} can't take this enquiry`,
        "Try another vendor from your shortlist or search.",
        customerLink(quoteId),
        { quoteId }
      );
    }
    return;
  }
  if (to === "booked") {
    await notify(client, p.vendorOwnerId, "lead.booked", `${p.customerName} marked the enquiry as booked`, null, vendorLink(quoteId), { quoteId });
  } else if (to === "withdrawn") {
    await notify(client, p.vendorOwnerId, "lead.withdrawn", `${p.customerName} withdrew their enquiry`, null, vendorLink(quoteId), { quoteId });
  }
}
