import type { TxClient } from "./tx";

/**
 * Audit action names: "<entity>.<verb>", e.g. vendor.approve,
 * vendor.request_changes, vendor.reject, vendor.suspend, vendor.unsuspend,
 * vendor.verify, vendor.edit, vendor.assign_owner, review.hide,
 * review.unhide, report.dismiss, media.approve, media.reject,
 * category.create, template.update, custom_offering.promote, user.suspend,
 * user.force_logout, document.verify, contact.block ...
 */
export interface AuditEntry {
  /** The acting admin (session.userId from requireAdmin()). */
  actorId: number;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Client IP if known (x-forwarded-for first hop). */
  ip?: string | null;
}

const MAX_REASON = 2000;

function json(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v);
}

/**
 * Writes exactly one admin_audit_log row with the given transaction client.
 * Call it inside the SAME withTransaction() as the mutation it records, so
 * the change and its audit row commit or roll back together (P1-2). The
 * table is append-only (DB trigger): never update or delete rows.
 * Returns the new row id.
 */
export async function audit(client: TxClient, entry: AuditEntry): Promise<number> {
  if (!Number.isInteger(entry.actorId)) throw new Error("audit(): actorId is required");
  if (!entry.action || !entry.entityType) throw new Error("audit(): action and entityType are required");
  const reason = entry.reason ? String(entry.reason).slice(0, MAX_REASON) : null;
  const r = await client.query<{ id: string }>(
    `INSERT INTO admin_audit_log (actor_id, action, entity_type, entity_id, before, after, reason, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) RETURNING id`,
    [
      entry.actorId,
      entry.action,
      entry.entityType,
      String(entry.entityId),
      json(entry.before),
      json(entry.after),
      reason,
      entry.ip ?? null,
    ]
  );
  return Number(r.rows[0].id);
}

/** First x-forwarded-for hop (or x-real-ip) of a request, for AuditEntry.ip. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim().slice(0, 64) || null;
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? null;
}
