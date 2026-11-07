import type { TxClient } from "./tx";

/** Statuses whose status_reason is the admin's note to the vendor. */
const REASON_STATUSES = new Set(["changes_requested", "rejected"]);

/**
 * QA-085: the status_reason that went with `restored` before the listing's
 * latest suspension, so lifting a suspension brings back the admin's
 * change-request or rejection note together with the status.
 *
 * It is the reason of the most recent vendor_status_events row that moved the
 * listing INTO `restored` before that suspension. Rows coming out of
 * 'suspended' are skipped (their reason is "Account reinstated" or an
 * unsuspend note, not the admin's note). Other statuses carry no vendor-facing
 * reason, so they get null as before.
 */
export async function reasonBeforeSuspension(
  client: TxClient,
  vendorId: number,
  restored: string
): Promise<string | null> {
  if (!REASON_STATUSES.has(restored)) return null;
  const r = await client.query<{ reason: string | null }>(
    `SELECT e.reason FROM vendor_status_events e
      WHERE e.vendor_id = $1 AND e.to_status = $2 AND e.from_status <> 'suspended'
        AND e.id < COALESCE(
          (SELECT max(s.id) FROM vendor_status_events s WHERE s.vendor_id = $1 AND s.to_status = 'suspended'),
          2147483647)
      ORDER BY e.id DESC LIMIT 1`,
    [vendorId, restored]
  );
  return r.rows[0]?.reason ?? null;
}
