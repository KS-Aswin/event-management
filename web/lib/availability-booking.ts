// Booking <-> calendar hook (PRODUCT_PLAN P2-6). Called by updateVendorLead
// inside the status-change transaction, so the calendar always moves with
// the lead. Pool-free on purpose: lib/db.ts imports this file.
//
// capacity_used counts booked leads honestly (it may exceed capacity_total
// when a vendor books more than planned; the calendar shows that as full).
// A manual block stays "blocked" whatever is booked on the day.

import type { PoolClient } from "pg";

type Client = Pick<PoolClient, "query">;

/** Marks one more booking on (vendor, date, slot): creates the row or increments capacity_used. */
export async function recordBooking(
  client: Client,
  vendorId: number,
  date: string,
  slot: string,
  leadId: number
): Promise<void> {
  await client.query(
    `INSERT INTO vendor_availability (vendor_id, date, slot, status, quote_request_id, source, capacity_total, capacity_used)
     SELECT $1, $2::date, $3, CASE WHEN v.max_events_per_day <= 1 THEN 'booked' ELSE 'limited' END,
            $4, 'booking', v.max_events_per_day, 1
     FROM vendors v WHERE v.id = $1
     ON CONFLICT (vendor_id, date, slot) DO UPDATE SET
       capacity_used = vendor_availability.capacity_used + 1,
       status = CASE WHEN vendor_availability.status = 'blocked' THEN 'blocked'
                     WHEN vendor_availability.capacity_used + 1 >= vendor_availability.capacity_total THEN 'booked'
                     ELSE 'limited' END,
       quote_request_id = COALESCE(vendor_availability.quote_request_id, EXCLUDED.quote_request_id),
       updated_at = now()`,
    [vendorId, date, slot, leadId]
  );
}

/** Un-booking frees one place again; a row that only existed for bookings is removed when empty. */
export async function releaseBooking(
  client: Client,
  vendorId: number,
  date: string,
  slot: string,
  leadId: number
): Promise<void> {
  await client.query(
    `UPDATE vendor_availability SET
       capacity_used = GREATEST(capacity_used - 1, 0),
       status = CASE WHEN status = 'blocked' THEN 'blocked'
                     WHEN GREATEST(capacity_used - 1, 0) >= capacity_total THEN 'booked'
                     ELSE 'limited' END,
       quote_request_id = CASE WHEN quote_request_id = $4 THEN NULL ELSE quote_request_id END,
       updated_at = now()
     WHERE vendor_id = $1 AND date = $2::date AND slot = $3`,
    [vendorId, date, slot, leadId]
  );
  await client.query(
    `DELETE FROM vendor_availability
     WHERE vendor_id = $1 AND date = $2::date AND slot = $3
       AND source = 'booking' AND capacity_used = 0 AND status <> 'blocked'`,
    [vendorId, date, slot]
  );
}
