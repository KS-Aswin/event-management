// In-app notifications, read side (the admin area writes them with
// lib/admin/notify.ts). Every query is scoped to the caller's own user id.

import { pool } from "@/lib/db";

export interface InAppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  kind: string;
  payload: { title?: unknown; body?: unknown; link?: unknown } | null;
  read_at: Date | null;
  created_at: Date;
}

/** Only in-app paths are used as links (never an absolute or protocol URL). */
function safeLink(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null;
}

function toItem(r: Row): InAppNotification {
  const p = r.payload ?? {};
  return {
    id: Number(r.id),
    kind: r.kind,
    title: typeof p.title === "string" && p.title ? p.title : "Update from Vela",
    body: typeof p.body === "string" && p.body ? p.body : null,
    link: safeLink(p.link),
    readAt: r.read_at ? r.read_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

export interface NotificationPage {
  items: InAppNotification[];
  /** Unread notifications in total (not just on this page). */
  unread: number;
  /** Notifications matching the filter in total (all, or unread only). */
  total: number;
}

/** Most notifications one request returns. */
export const NOTIFICATIONS_MAX_LIMIT = 50;

/**
 * The caller's notifications, newest first. `offset` pages through older
 * ones (QA-095: the bell and the vendor home only show the newest few, the
 * /notifications page lists them all); `unreadOnly` limits it to unread.
 */
export async function listNotifications(
  userId: number,
  limit = 10,
  { offset = 0, unreadOnly = false }: { offset?: number; unreadOnly?: boolean } = {}
): Promise<NotificationPage> {
  const n = Math.min(Math.max(1, Math.floor(limit) || 10), NOTIFICATIONS_MAX_LIMIT);
  const skip = Math.min(Math.max(0, Math.floor(offset) || 0), 1_000_000);
  const [rows, counts] = await Promise.all([
    pool.query<Row>(
      `SELECT id, kind, payload, read_at, created_at FROM notifications
        WHERE user_id = $1 AND ($4::boolean IS FALSE OR read_at IS NULL)
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, n, skip, unreadOnly]
    ),
    pool.query<{ total: number; unread: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread
         FROM notifications WHERE user_id = $1`,
      [userId]
    ),
  ]);
  const c = counts.rows[0];
  return { items: rows.rows.map(toItem), unread: c.unread, total: unreadOnly ? c.unread : c.total };
}

/** Marks the given ids (or all, when ids is null) read. Returns how many changed. */
export async function markNotificationsRead(userId: number, ids: number[] | null): Promise<number> {
  const r = ids
    ? await pool.query(
        "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])",
        [userId, ids]
      )
    : await pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return r.rowCount ?? 0;
}
