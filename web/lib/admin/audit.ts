import type { TxClient } from "./tx";
import { clientIp as requestClientIp } from "@/lib/client-ip";

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
  /** Client IP if known (see clientIp below). */
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

/**
 * Client IP of a request, for AuditEntry.ip. Same rules as rate limiting
 * (lib/client-ip.ts, QA-005): a client-typed X-Forwarded-For first hop is not
 * trusted in production, so the audit log can't be given a forged IP.
 */
export function clientIp(req: Request): string | null {
  const ip = requestClientIp(req.headers);
  return ip === "unknown" ? null : ip;
}
