// Admin "ops" queries: Today inbox (P1-4), users (P1-9), enquiry monitor and
// blocked contacts (P1-13) and the audit log viewer (P1-2).
// Every mutation runs in withTransaction() and writes exactly one audit row.

import { pool } from "@/lib/db";
import { normalisePhone } from "@/app/api/_lib/validation";
import { withTransaction, HttpError, type TxClient } from "./tx";
import { audit } from "./audit";
import { notify } from "./notify";

export const PAGE_SIZE = 25;

/** Spam rule (P1-13): the same phone sending to more than SPAM_VENDORS vendors within SPAM_WINDOW. */
export const SPAM_VENDORS = 10;
export const SPAM_WINDOW = "1 hour";
/** How far back the enquiry monitor looks for spam bursts. */
const SPAM_LOOKBACK = "30 days";

type Iso = string;

function pageOf(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Today (P1-4)
// ---------------------------------------------------------------------------

export interface TodayOldest {
  id: number;
  label: string;
  sub?: string | null;
  at: Iso;
  href: string;
}

export interface TodayTile {
  key: string;
  label: string;
  count: number;
  /** Short note under the number (e.g. "3 reported"). */
  note?: string | null;
  href: string;
  /** Queues have an oldest waiting item; the activity tiles show the newest. */
  itemLabel: "Oldest" | "Latest";
  item: TodayOldest | null;
  /** true when this is a queue that needs work (count > 0 is highlighted). */
  queue: boolean;
}

export interface TodaySummary {
  tiles: TodayTile[];
  generatedAt: Iso;
}

type Row = Record<string, unknown>;
type J = { id: number; label: string; sub?: string | null; at: Iso; vendor_id?: number | null } | null;

/**
 * All Today tiles in ONE round trip: a single SELECT of scalar subqueries
 * (each hits an index from migrations 004/005).
 */
export async function getTodaySummary(): Promise<TodaySummary> {
  const { rows } = await pool.query<Row>(
    `SELECT
       now() AS generated_at,
       (SELECT count(*)::int FROM vendors WHERE status = 'pending') AS pending_n,
       (SELECT json_build_object('id', id, 'label', name, 'at', COALESCE(submitted_at, created_at))
          FROM vendors WHERE status = 'pending'
          ORDER BY COALESCE(submitted_at, created_at), id LIMIT 1) AS pending_item,
       (SELECT count(*)::int FROM vendors WHERE rereview_required) AS rereview_n,
       (SELECT json_build_object('id', id, 'label', name, 'sub', array_to_string(rereview_fields, ', '),
                                 'at', COALESCE(rereview_requested_at, updated_at))
          FROM vendors WHERE rereview_required
          ORDER BY rereview_requested_at NULLS LAST, id LIMIT 1) AS rereview_item,
       (SELECT count(*)::int FROM vendors WHERE status = 'changes_requested') AS changes_n,
       (SELECT json_build_object('id', id, 'label', name, 'sub', status_reason,
                                 'at', COALESCE(reviewed_at, updated_at))
          FROM vendors WHERE status = 'changes_requested'
          ORDER BY COALESCE(reviewed_at, updated_at), id LIMIT 1) AS changes_item,
       (SELECT count(*)::int FROM review_reports WHERE status = 'open') AS reports_n,
       (SELECT json_build_object('id', rr.id, 'label', v.name, 'sub', rr.reason, 'at', rr.created_at, 'vendor_id', v.id)
          FROM review_reports rr JOIN vendor_reviews r ON r.id = rr.review_id JOIN vendors v ON v.id = r.vendor_id
          WHERE rr.status = 'open' ORDER BY rr.created_at, rr.id LIMIT 1) AS reports_item,
       (SELECT count(*)::int FROM media_assets WHERE status = 'pending_review') AS media_n,
       (SELECT count(DISTINCT media_id)::int FROM media_reports WHERE status = 'open') AS media_reported_n,
       (SELECT json_build_object('id', m.id, 'label', v.name, 'sub', m.kind, 'at', m.created_at, 'vendor_id', v.id)
          FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
          WHERE m.status = 'pending_review' ORDER BY m.created_at, m.id LIMIT 1) AS media_item,
       (SELECT count(*)::int FROM custom_offering_requests WHERE status = 'pending') AS custom_n,
       (SELECT count(DISTINCT normalised_name)::int FROM custom_offering_requests WHERE status = 'pending') AS custom_groups_n,
       (SELECT json_build_object('id', c.id, 'label', c.raw_name, 'sub', v.name, 'at', c.created_at, 'vendor_id', v.id)
          FROM custom_offering_requests c JOIN vendors v ON v.id = c.vendor_id
          WHERE c.status = 'pending' ORDER BY c.created_at, c.id LIMIT 1) AS custom_item,
       (SELECT count(*)::int FROM vendor_documents WHERE status = 'pending') AS docs_n,
       (SELECT json_build_object('id', d.id, 'label', v.name, 'sub', d.doc_type, 'at', d.created_at, 'vendor_id', v.id)
          FROM vendor_documents d JOIN vendors v ON v.id = d.vendor_id
          WHERE d.status = 'pending' ORDER BY d.created_at, d.id LIMIT 1) AS docs_item,
       (SELECT count(*)::int FROM quote_requests WHERE created_at > now() - interval '7 days') AS enq_n,
       (SELECT json_build_object('id', q.id, 'label', v.name, 'sub', q.name, 'at', q.created_at, 'vendor_id', v.id)
          FROM quote_requests q JOIN vendors v ON v.id = q.vendor_id
          ORDER BY q.created_at DESC, q.id DESC LIMIT 1) AS enq_item,
       (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_n,
       (SELECT json_build_object('id', id, 'label', name, 'sub', role::text, 'at', created_at)
          FROM users ORDER BY created_at DESC, id DESC LIMIT 1) AS users_item,
       (SELECT count(*)::int FROM vendors WHERE status = 'approved') AS approved_n,
       (SELECT json_build_object('id', id, 'label', name, 'at', reviewed_at)
          FROM vendors WHERE status = 'approved' AND reviewed_at IS NOT NULL
          ORDER BY reviewed_at DESC, id DESC LIMIT 1) AS approved_item`
  );
  const r = rows[0];
  const n = (k: string) => Number(r[k] ?? 0);
  const item = (k: string, href: (j: NonNullable<J>) => string): TodayOldest | null => {
    const j = r[k] as J;
    if (!j || !j.at) return null;
    return { id: j.id, label: j.label, sub: j.sub ?? null, at: new Date(j.at).toISOString(), href: href(j) };
  };
  const vendorHref = (j: NonNullable<J>) => `/admin/vendors/${j.vendor_id ?? j.id}`;
  const reported = n("media_reported_n");
  const groups = n("custom_groups_n");

  const tiles: TodayTile[] = [
    {
      key: "vendors_pending", label: "Vendors to review", count: n("pending_n"), queue: true,
      href: "/admin/vendors?status=pending", itemLabel: "Oldest", item: item("pending_item", vendorHref),
    },
    {
      key: "rereview", label: "Re-review after edits", count: n("rereview_n"), queue: true,
      href: "/admin/vendors?rereview=1", itemLabel: "Oldest", item: item("rereview_item", vendorHref),
    },
    {
      key: "changes_requested", label: "Waiting on vendor changes", count: n("changes_n"), queue: false,
      href: "/admin/vendors?status=changes_requested", itemLabel: "Oldest", item: item("changes_item", vendorHref),
    },
    {
      key: "review_reports", label: "Reported reviews", count: n("reports_n"), queue: true,
      href: "/admin/reviews", itemLabel: "Oldest", item: item("reports_item", () => "/admin/reviews"),
    },
    {
      key: "media", label: "Media to check", count: n("media_n"), queue: true,
      note: reported ? `${reported} reported` : null,
      href: "/admin/media", itemLabel: "Oldest", item: item("media_item", () => "/admin/media"),
    },
    {
      key: "custom_offerings", label: "Custom offerings", count: n("custom_n"), queue: true,
      note: groups ? `${groups} ${groups === 1 ? "group" : "groups"}` : null,
      href: "/admin/taxonomy/custom", itemLabel: "Oldest", item: item("custom_item", () => "/admin/taxonomy/custom"),
    },
    {
      key: "documents", label: "Documents to verify", count: n("docs_n"), queue: true,
      href: "/admin/vendors?documents=pending", itemLabel: "Oldest", item: item("docs_item", vendorHref),
    },
    {
      key: "enquiries_7d", label: "Enquiries, last 7 days", count: n("enq_n"), queue: false,
      href: "/admin/enquiries", itemLabel: "Latest", item: item("enq_item", () => "/admin/enquiries"),
    },
    {
      key: "users_7d", label: "New users, last 7 days", count: n("users_n"), queue: false,
      href: "/admin/users?joined=7d", itemLabel: "Latest", item: item("users_item", (j) => `/admin/users/${j.id}`),
    },
    {
      key: "vendors_approved", label: "Live vendors", count: n("approved_n"), queue: false,
      href: "/admin/vendors?status=approved", itemLabel: "Latest", item: item("approved_item", vendorHref),
    },
  ];
  return { tiles, generatedAt: new Date(r.generated_at as string).toISOString() };
}

// ---------------------------------------------------------------------------
// Users (P1-9)
// ---------------------------------------------------------------------------

export const USER_ROLES = ["customer", "vendor", "admin"] as const;
export const USER_STATUSES = ["active", "suspended", "deleted"] as const;

export interface UserListFilters {
  q?: string;
  role?: string;
  status?: string;
  joined?: string; // "7d" | "30d"
  page?: unknown;
}

export interface UserListRow {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  phone_e164: string | null;
  created_at: Iso;
  last_login_at: Iso | null;
  listing_id: number | null;
  listing_name: string | null;
  listing_status: string | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

function paged<T>(rows: T[], total: number, page: number): Paged<T> {
  return { rows, total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function cleanUserFilters(sp: Record<string, unknown>): UserListFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const role = s("role");
  const status = s("status");
  const joined = s("joined");
  return {
    q: s("q").slice(0, 120) || undefined,
    role: (USER_ROLES as readonly string[]).includes(role) ? role : undefined,
    status: (USER_STATUSES as readonly string[]).includes(status) ? status : undefined,
    joined: joined === "7d" || joined === "30d" ? joined : undefined,
    page: sp.page,
  };
}

/** Search by name, email or phone (digits match users.phone_e164 and the listing phone). */
export async function searchUsers(f: UserListFilters): Promise<Paged<UserListRow>> {
  const page = pageOf(f.page);
  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  if (f.q) {
    const like = add(`%${likeEscape(f.q.toLowerCase())}%`);
    const parts = [`lower(u.name) LIKE ${like}`, `lower(u.email) LIKE ${like}`];
    const digits = f.q.replace(/\D/g, "");
    if (digits.length >= 4) {
      const d = add(`%${digits}%`);
      parts.push(`u.phone_e164 LIKE ${d}`, `regexp_replace(COALESCE(v.phone, ''), '\\D', '', 'g') LIKE ${d}`);
    }
    if (/^\d+$/.test(f.q)) parts.push(`u.id = ${add(Number(f.q))}`);
    where.push(`(${parts.join(" OR ")})`);
  }
  if (f.role) where.push(`u.role = ${add(f.role)}`);
  if (f.status) where.push(`u.status = ${add(f.status)}`);
  if (f.joined) where.push(`u.created_at > now() - ${add(f.joined === "7d" ? "7 days" : "30 days")}::interval`);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM users u LEFT JOIN LATERAL (
      SELECT id, name, status, phone FROM vendors WHERE owner_id = u.id ORDER BY id LIMIT 1) v ON true`;
  const totalP = pool.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${w}`, vals);
  const rowsP = pool.query<UserListRow>(
    `SELECT u.id, u.name, u.email, u.role::text AS role, u.status, u.phone_e164, u.created_at, u.last_login_at,
            v.id AS listing_id, v.name AS listing_name, v.status AS listing_status
     ${from} ${w}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    vals
  );
  const [total, rows] = await Promise.all([totalP, rowsP]);
  return paged(rows.rows, total.rows[0].n, page);
}

export interface UserDetail extends UserListRow {
  suspended_at: Iso | null;
  suspended_reason: string | null;
  session_version: number;
  enquiries_sent: number;
  enquiries_received: number;
  reviews_written: number;
  audit: AuditRow[];
}

export async function getUserDetail(id: number): Promise<UserDetail | null> {
  const { rows } = await pool.query<UserDetail>(
    `SELECT u.id, u.name, u.email, u.role::text AS role, u.status, u.phone_e164, u.created_at, u.last_login_at,
            u.suspended_at, u.suspended_reason, u.session_version,
            v.id AS listing_id, v.name AS listing_name, v.status AS listing_status,
            (SELECT count(*)::int FROM quote_requests q WHERE q.customer_id = u.id) AS enquiries_sent,
            (SELECT count(*)::int FROM quote_requests q WHERE v.id IS NOT NULL AND q.vendor_id = v.id) AS enquiries_received,
            (SELECT count(*)::int FROM vendor_reviews r WHERE r.customer_id = u.id) AS reviews_written
     FROM users u
     LEFT JOIN LATERAL (SELECT id, name, status FROM vendors WHERE owner_id = u.id ORDER BY id LIMIT 1) v ON true
     WHERE u.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const a = await listAudit({ entityType: "user", entityId: String(id), page: 1 });
  return { ...rows[0], audit: a.rows.slice(0, 10) };
}

export type UserAction = "suspend" | "unsuspend" | "force_logout";
export const USER_ACTIONS: UserAction[] = ["suspend", "unsuspend", "force_logout"];

interface LockedUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  session_version: number;
  suspended_reason: string | null;
}

interface ListingChange {
  id: number;
  from: string;
  to: string;
  eventId: number;
}

/**
 * suspend / unsuspend / force_logout another user (P1-9). Rules:
 * - acting on yourself is 409 (SELF_ACTION);
 * - suspending an admin locks every active admin row first (fixed order,
 *   so two admins suspending each other cannot deadlock) and refuses when
 *   the actor is no longer active or the target is the last active admin
 *   (409 LAST_ADMIN);
 * - suspend bumps session_version (cookies die at once) and suspends the
 *   user's listing so it leaves public pages; unsuspend restores the
 *   listing's previous status if nobody changed it since.
 */
export async function applyUserAction(params: {
  actorId: number;
  targetId: number;
  action: UserAction;
  reason: string | null;
  ip: string | null;
}): Promise<{ id: number; status: string; session_version: number; listing: ListingChange | null }> {
  const { actorId, targetId, action, reason, ip } = params;
  if (actorId === targetId) {
    throw new HttpError(409, "You can't do this to your own account.", "SELF_ACTION");
  }
  try {
    return await withTransaction(async (client) => {
      const peek = await client.query<{ role: string }>("SELECT role::text AS role FROM users WHERE id = $1", [targetId]);
      if (!peek.rows[0]) throw new HttpError(404, "User not found.");

      if (action === "suspend" && peek.rows[0].role === "admin") {
        const admins = await client.query<{ id: number }>(
          "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE"
        );
        const ids = admins.rows.map((a) => a.id);
        if (!ids.includes(actorId)) throw new HttpError(409, "Your admin account is no longer active.", "ACTOR_INACTIVE");
        if (ids.filter((i) => i !== targetId).length < 1) {
          throw new HttpError(409, "You can't suspend the last active admin.", "LAST_ADMIN");
        }
      }

      const t = await client.query<LockedUser>(
        `SELECT id, name, email, role::text AS role, status, session_version, suspended_reason
         FROM users WHERE id = $1 FOR UPDATE`,
        [targetId]
      );
      const user = t.rows[0];
      if (!user) throw new HttpError(404, "User not found.");
      if (user.status === "deleted") throw new HttpError(409, "This account was deleted.", "DELETED");

      const before = { status: user.status, session_version: user.session_version, suspended_reason: user.suspended_reason };

      if (action === "force_logout") {
        const u = await client.query<{ session_version: number }>(
          "UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version",
          [targetId]
        );
        const after = { status: user.status, session_version: u.rows[0].session_version };
        await audit(client, { actorId, action: "user.force_logout", entityType: "user", entityId: targetId, before, after, reason, ip });
        return { id: targetId, ...after, listing: null };
      }

      if (action === "suspend") {
        if (user.status === "suspended") throw new HttpError(409, "This account is already suspended.", "ALREADY");
        const u = await client.query<{ session_version: number }>(
          `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = $2,
                  session_version = session_version + 1
           WHERE id = $1 RETURNING session_version`,
          [targetId, reason]
        );
        let listing: ListingChange | null = null;
        const v = await client.query<{ id: number; status: string }>(
          "SELECT id, status FROM vendors WHERE owner_id = $1 ORDER BY id LIMIT 1 FOR UPDATE",
          [targetId]
        );
        const vendor = v.rows[0];
        if (vendor && vendor.status !== "suspended") {
          await client.query(
            "UPDATE vendors SET status = 'suspended', status_reason = $2, updated_at = now() WHERE id = $1",
            [vendor.id, `Account suspended: ${reason}`]
          );
          const ev = await client.query<{ id: number }>(
            `INSERT INTO vendor_status_events (vendor_id, from_status, to_status, reason, changed_by)
             VALUES ($1, $2, 'suspended', $3, $4) RETURNING id`,
            [vendor.id, vendor.status, `Account suspended: ${reason}`, actorId]
          );
          listing = { id: vendor.id, from: vendor.status, to: "suspended", eventId: ev.rows[0].id };
        }
        await notify(
          client,
          targetId,
          "account.suspended",
          "Your account has been suspended",
          reason,
          null,
          listing ? { vendorId: listing.id } : undefined
        );
        const after = { status: "suspended", session_version: u.rows[0].session_version, suspended_reason: reason, listing };
        await audit(client, { actorId, action: "user.suspend", entityType: "user", entityId: targetId, before, after, reason, ip });
        return { id: targetId, status: "suspended", session_version: after.session_version, listing };
      }

      // unsuspend
      if (user.status !== "suspended") throw new HttpError(409, "This account is not suspended.", "ALREADY");
      await client.query(
        "UPDATE users SET status = 'active', suspended_at = NULL, suspended_reason = NULL WHERE id = $1",
        [targetId]
      );
      let listing: ListingChange | null = null;
      // Restore the listing only if it is still in the state our suspension left it.
      const last = await client.query<{ after: { listing?: ListingChange | null } | null }>(
        `SELECT after FROM admin_audit_log WHERE action = 'user.suspend' AND entity_type = 'user' AND entity_id = $1
         ORDER BY id DESC LIMIT 1`,
        [String(targetId)]
      );
      const prev = last.rows[0]?.after?.listing;
      if (prev && Number.isInteger(prev.id)) {
        const cur = await client.query<{ status: string; last_event: number | null }>(
          `SELECT v.status, (SELECT max(id) FROM vendor_status_events e WHERE e.vendor_id = v.id) AS last_event
           FROM vendors v WHERE v.id = $1 AND v.owner_id = $2 FOR UPDATE OF v`,
          [prev.id, targetId]
        );
        const c = cur.rows[0];
        if (c && c.status === "suspended" && Number(c.last_event) === prev.eventId) {
          await client.query(
            "UPDATE vendors SET status = $2, status_reason = NULL, updated_at = now() WHERE id = $1",
            [prev.id, prev.from]
          );
          const ev = await client.query<{ id: number }>(
            `INSERT INTO vendor_status_events (vendor_id, from_status, to_status, reason, changed_by)
             VALUES ($1, 'suspended', $2, $3, $4) RETURNING id`,
            [prev.id, prev.from, "Account reinstated", actorId]
          );
          listing = { id: prev.id, from: "suspended", to: prev.from, eventId: ev.rows[0].id };
        }
      }
      await notify(
        client,
        targetId,
        "account.unsuspended",
        "Your account is active again",
        listing ? "Your listing has been restored." : null,
        null
      );
      const after = { status: "active", session_version: user.session_version, listing };
      await audit(client, { actorId, action: "user.unsuspend", entityType: "user", entityId: targetId, before, after, reason, ip });
      return { id: targetId, status: "active", session_version: user.session_version, listing };
    });
  } catch (err) {
    // Two admins acting on each other at the same moment: Postgres picks a
    // deadlock victim; report it as a conflict, not a 500.
    if ((err as { code?: string })?.code === "40P01") {
      throw new HttpError(409, "Someone else changed this account at the same time. Reload and try again.", "CONFLICT");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Blocked contacts and enquiry monitor (P1-13)
// ---------------------------------------------------------------------------

/** Normalised blocked_contacts.value: +91XXXXXXXXXX for a phone, lower-case email. Null if invalid. */
export function normaliseContact(raw: unknown): { value: string; kind: "phone" | "email" } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 254) return null;
  if (s.includes("@")) {
    const e = s.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { value: e, kind: "email" } : null;
  }
  const p = normalisePhone(s);
  return p ? { value: p, kind: "phone" } : null;
}

/**
 * True when an enquiry must be refused: the phone, the contact email, or the
 * signed-in user's email / phone is on blocked_contacts.
 */
export async function isEnquiryBlocked(params: {
  phone?: string | null;
  email?: string | null;
  userId?: number | null;
}): Promise<boolean> {
  const values = [params.phone, params.email?.trim().toLowerCase()].filter((v): v is string => !!v);
  const { rows } = await pool.query<{ blocked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM blocked_contacts WHERE value = ANY($1::text[]))
         OR EXISTS (SELECT 1 FROM users u JOIN blocked_contacts b
                      ON b.value = lower(u.email) OR b.value = u.phone_e164
                    WHERE u.id = $2) AS blocked`,
    [values, params.userId ?? null]
  );
  return rows[0]?.blocked === true;
}

export interface BlockedContact {
  id: number;
  value: string;
  reason: string;
  created_at: Iso;
  created_by: number | null;
  created_by_name: string | null;
}

export async function listBlockedContacts(): Promise<BlockedContact[]> {
  const { rows } = await pool.query<BlockedContact>(
    `SELECT b.id, b.value, b.reason, b.created_at, b.created_by, u.name AS created_by_name
     FROM blocked_contacts b LEFT JOIN users u ON u.id = b.created_by
     ORDER BY b.created_at DESC, b.id DESC LIMIT 500`
  );
  return rows;
}

export async function blockContact(params: {
  actorId: number;
  value: string;
  reason: string;
  ip: string | null;
}): Promise<BlockedContact> {
  return withTransaction(async (client) => {
    const r = await client.query<BlockedContact>(
      `INSERT INTO blocked_contacts (value, reason, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (value) DO NOTHING
       RETURNING id, value, reason, created_at, created_by`,
      [params.value, params.reason, params.actorId]
    );
    const row = r.rows[0];
    if (!row) throw new HttpError(409, "This contact is already blocked.", "ALREADY");
    await audit(client, {
      actorId: params.actorId,
      action: "contact.block",
      entityType: "blocked_contact",
      entityId: row.id,
      after: { value: row.value },
      reason: params.reason,
      ip: params.ip,
    });
    return { ...row, created_by_name: null };
  });
}

export async function unblockContact(params: {
  actorId: number;
  id: number;
  reason: string | null;
  ip: string | null;
}): Promise<{ id: number; value: string }> {
  return withTransaction(async (client) => {
    const r = await client.query<{ id: number; value: string; reason: string }>(
      "DELETE FROM blocked_contacts WHERE id = $1 RETURNING id, value, reason",
      [params.id]
    );
    const row = r.rows[0];
    if (!row) throw new HttpError(404, "That block was already removed.");
    await audit(client, {
      actorId: params.actorId,
      action: "contact.unblock",
      entityType: "blocked_contact",
      entityId: row.id,
      before: { value: row.value, reason: row.reason },
      reason: params.reason,
      ip: params.ip,
    });
    return { id: row.id, value: row.value };
  });
}

export interface EnquiryFilters {
  q?: string;
  spam?: boolean;
  range?: "24h" | "7d" | "30d" | "all";
  page?: unknown;
}

export function cleanEnquiryFilters(sp: Record<string, unknown>): EnquiryFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const range = s("range");
  return {
    q: s("q").slice(0, 120) || undefined,
    spam: s("spam") === "1",
    range: range === "24h" || range === "7d" || range === "all" ? range : "30d",
    page: sp.page,
  };
}

export interface EnquiryRow {
  id: number;
  created_at: Iso;
  status: string;
  name: string;
  phone: string;
  contact_email: string | null;
  event_date: string | null;
  message: string | null;
  vendor_id: number;
  vendor_name: string;
  district: string | null;
  customer_id: number | null;
  customer_email: string | null;
  spam: boolean;
  blocked: boolean;
}

export interface SpamSignal {
  phone: string;
  vendors: number;
  enquiries: number;
  first_at: Iso;
  last_at: Iso;
  blocked: boolean;
}

// Phones that sent to more than SPAM_VENDORS distinct vendors inside any
// SPAM_WINDOW, looking back SPAM_LOOKBACK (uses idx_quote_requests_phone_created).
const SPAM_PHONES_CTE = `spam_phones AS (
  SELECT DISTINCT a.phone
  FROM quote_requests a
  JOIN quote_requests b ON b.phone = a.phone
   AND b.created_at >= a.created_at AND b.created_at < a.created_at + interval '${SPAM_WINDOW}'
  WHERE a.created_at > now() - interval '${SPAM_LOOKBACK}'
  GROUP BY a.id, a.phone
  HAVING count(DISTINCT b.vendor_id) > ${SPAM_VENDORS}
)`;

export async function listSpamSignals(): Promise<SpamSignal[]> {
  const { rows } = await pool.query<SpamSignal>(
    `WITH ${SPAM_PHONES_CTE}
     SELECT q.phone, count(DISTINCT q.vendor_id)::int AS vendors, count(*)::int AS enquiries,
            min(q.created_at) AS first_at, max(q.created_at) AS last_at,
            EXISTS (SELECT 1 FROM blocked_contacts b WHERE b.value = q.phone) AS blocked
     FROM quote_requests q JOIN spam_phones s ON s.phone = q.phone
     WHERE q.created_at > now() - interval '${SPAM_LOOKBACK}'
     GROUP BY q.phone ORDER BY max(q.created_at) DESC LIMIT 50`
  );
  return rows;
}

export async function getEnquiryVolume(): Promise<{ d1: number; d7: number; d30: number; blocked: number }> {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS d1,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS d7,
            count(*)::int AS d30,
            (SELECT count(*)::int FROM blocked_contacts) AS blocked
     FROM quote_requests WHERE created_at > now() - interval '30 days'`
  );
  return rows[0];
}

export async function listEnquiries(f: EnquiryFilters): Promise<Paged<EnquiryRow>> {
  const page = pageOf(f.page);
  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  const range = f.range ?? "30d";
  if (range !== "all") {
    where.push(`q.created_at > now() - ${add(range === "24h" ? "24 hours" : range === "7d" ? "7 days" : "30 days")}::interval`);
  }
  if (f.q) {
    const like = add(`%${likeEscape(f.q.toLowerCase())}%`);
    const parts = [`lower(q.name) LIKE ${like}`, `lower(v.name) LIKE ${like}`, `lower(COALESCE(q.contact_email, '')) LIKE ${like}`];
    const digits = f.q.replace(/\D/g, "");
    if (digits.length >= 4) parts.push(`q.phone LIKE ${add(`%${digits}%`)}`);
    where.push(`(${parts.join(" OR ")})`);
  }
  if (f.spam) where.push("sp.phone IS NOT NULL");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM quote_requests q
     JOIN vendors v ON v.id = q.vendor_id
     LEFT JOIN districts d ON d.id = COALESCE(q.district_id, v.district_id)
     LEFT JOIN users c ON c.id = q.customer_id
     LEFT JOIN spam_phones sp ON sp.phone = q.phone`;
  const totalP = pool.query<{ n: number }>(`WITH ${SPAM_PHONES_CTE} SELECT count(*)::int AS n ${from} ${w}`, vals);
  const rowsP = pool.query<EnquiryRow>(
    `WITH ${SPAM_PHONES_CTE}
     SELECT q.id, q.created_at, q.status, q.name, q.phone, q.contact_email, to_char(q.event_date, 'YYYY-MM-DD') AS event_date,
            left(q.message, 160) AS message, v.id AS vendor_id, v.name AS vendor_name, COALESCE(d.name, v.location) AS district,
            q.customer_id, c.email AS customer_email,
            (sp.phone IS NOT NULL) AS spam,
            EXISTS (SELECT 1 FROM blocked_contacts b
                    WHERE b.value IN (q.phone, lower(COALESCE(q.contact_email, '')), lower(COALESCE(c.email, '')))) AS blocked
     ${from} ${w}
     ORDER BY q.created_at DESC, q.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    vals
  );
  const [total, rows] = await Promise.all([totalP, rowsP]);
  return paged(rows.rows, total.rows[0].n, page);
}

// ---------------------------------------------------------------------------
// Audit log viewer (P1-2)
// ---------------------------------------------------------------------------

export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Actor id, or text matched against the actor's email / name. */
  actor?: string;
  page?: unknown;
}

export function cleanAuditFilters(sp: Record<string, unknown>): AuditFilters {
  const s = (k: string, max = 120) => (typeof sp[k] === "string" ? (sp[k] as string).trim().slice(0, max) : "");
  return {
    action: s("action", 80) || undefined,
    entityType: s("entity", 80) || undefined,
    entityId: s("entityId", 80) || undefined,
    actor: s("actor") || undefined,
    page: sp.page,
  };
}

export interface AuditRow {
  id: number;
  created_at: Iso;
  actor_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
}

export async function listAudit(f: AuditFilters): Promise<Paged<AuditRow>> {
  const page = pageOf(f.page);
  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (v: unknown) => {
    vals.push(v);
    return `$${vals.length}`;
  };
  if (f.action) where.push(`a.action = ${add(f.action)}`);
  if (f.entityType) where.push(`a.entity_type = ${add(f.entityType)}`);
  if (f.entityId) where.push(`a.entity_id = ${add(f.entityId)}`);
  if (f.actor) {
    if (/^\d+$/.test(f.actor)) where.push(`a.actor_id = ${add(Number(f.actor))}`);
    else {
      const like = add(`%${likeEscape(f.actor.toLowerCase())}%`);
      where.push(`(lower(u.email) LIKE ${like} OR lower(u.name) LIKE ${like})`);
    }
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = "FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id";
  const totalP = pool.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${w}`, vals);
  const rowsP = pool.query<AuditRow>(
    `SELECT a.id::int AS id, a.created_at, a.actor_id, u.name AS actor_name, u.email AS actor_email,
            a.action, a.entity_type, a.entity_id, a.before, a.after, a.reason, a.ip
     ${from} ${w}
     ORDER BY a.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    vals
  );
  const [total, rows] = await Promise.all([totalP, rowsP]);
  return paged(rows.rows, total.rows[0].n, page);
}

/** Distinct actions and entity types for the filter menus. */
export async function auditFacets(): Promise<{ actions: string[]; entityTypes: string[] }> {
  const [a, e] = await Promise.all([
    pool.query<{ v: string }>("SELECT DISTINCT action AS v FROM admin_audit_log ORDER BY 1 LIMIT 200"),
    pool.query<{ v: string }>("SELECT DISTINCT entity_type AS v FROM admin_audit_log ORDER BY 1 LIMIT 100"),
  ]);
  return { actions: a.rows.map((r) => r.v), entityTypes: e.rows.map((r) => r.v) };
}

// Re-exported for routes that need a raw client type.
export type { TxClient };
