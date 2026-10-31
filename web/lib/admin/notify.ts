import type { TxClient } from "./tx";

/**
 * In-app notification kinds written by the admin area. The vendor sees
 * these on their workspace (title/body/link live in notifications.payload).
 */
export type NotificationKind =
  | "vendor.approved"
  | "vendor.changes_requested"
  | "vendor.rejected"
  | "vendor.suspended"
  | "vendor.unsuspended"
  | "vendor.verified"
  | "vendor.edited"
  | "vendor.claimed"
  | "media.approved"
  | "media.rejected"
  | "review.hidden"
  | "offering.promoted"
  | "offering.merged"
  | "offering.rejected"
  | "document.verified"
  | "document.rejected"
  | "account.suspended"
  | (string & {});

export interface NotificationPayload {
  title: string;
  body?: string | null;
  /** In-app path, e.g. "/vendor" or "/vendor/media". */
  link?: string | null;
  [extra: string]: unknown;
}

/**
 * Inserts one notifications row for userId inside the caller's transaction.
 * Pass the vendor's owner_id; a seeded listing with no owner (null) is a
 * no-op and returns null.
 */
export async function notify(
  client: TxClient,
  userId: number | null | undefined,
  kind: NotificationKind,
  title: string,
  body?: string | null,
  link?: string | null,
  extra?: Record<string, unknown>
): Promise<number | null> {
  if (userId === null || userId === undefined) return null;
  const payload: NotificationPayload = { ...(extra ?? {}), title, body: body ?? null, link: link ?? null };
  const r = await client.query<{ id: string }>(
    "INSERT INTO notifications (user_id, kind, payload) VALUES ($1, $2, $3::jsonb) RETURNING id",
    [userId, kind, JSON.stringify(payload)]
  );
  return Number(r.rows[0].id);
}
