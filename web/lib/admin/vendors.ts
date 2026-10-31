// Admin vendor approval queue, detail and decisions (PRODUCT_PLAN P1-3,
// P1-10 verified badge, P1-11 edit on behalf + claim). Every mutation runs in
// one withTransaction(): the change, its vendor_status_events row, the
// vendor-facing notification and exactly one admin_audit_log row commit or
// roll back together.

import { pool, escapeLike, type VendorRecord, type VendorStatus } from "@/lib/db";
import { assetUrls } from "@/lib/media/repo";
import { audit } from "./audit";
import { notify } from "./notify";
import { HttpError, withTransaction, type TxClient } from "./tx";

// ---------------------------------------------------------------------------
// Queue / list
// ---------------------------------------------------------------------------

export const VENDOR_TABS = [
  { key: "pending", label: "Pending" },
  { key: "rereview", label: "Re-review" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
  { key: "draft", label: "Draft" },
  { key: "all", label: "All" },
] as const;
export type VendorTab = (typeof VENDOR_TABS)[number]["key"];

export function parseVendorTab(v: unknown): VendorTab {
  return VENDOR_TABS.some((t) => t.key === v) ? (v as VendorTab) : "pending";
}

export interface DuplicateHint {
  id: number;
  name: string;
  status: string;
  /** Which signals matched: "phone" (phone/WhatsApp, any district), "name" (same district). */
  match: ("phone" | "name")[];
}

export interface AdminVendorRow {
  id: number;
  name: string;
  status: VendorStatus;
  category: string | null;
  district: string | null;
  district_id: number | null;
  phone: string | null;
  whatsapp: string | null;
  owner_id: number | null;
  owner_email: string | null;
  owner_name: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string | null;
  verified_at: string | null;
  rereview_required: boolean;
  rereview_fields: string[];
  status_reason: string | null;
  pending_media: number;
  duplicates: DuplicateHint[];
}

export interface VendorListFilters {
  tab?: VendorTab;
  q?: string;
  districtId?: number;
  categoryId?: number;
  limit?: number;
  offset?: number;
}

// Last 10 digits of a phone number (Indian mobile), NULL when empty.
const DIGITS = (col: string) => `NULLIF(right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10), '')`;
// Lower-case letters and digits only, NULL when empty.
const NNAME = (col: string) => `NULLIF(regexp_replace(lower(COALESCE(${col}, '')), '[^a-z0-9]', '', 'g'), '')`;

/**
 * Duplicate hints for vendor alias `v` (PRODUCT_PLAN 6 "Admin"): another
 * listing sharing a phone or WhatsApp number (anywhere: a strong signal) or
 * the same normalised name in the same district.
 */
const DUPLICATES_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(json_build_object(
             'id', o.id, 'name', o.name, 'status', o.status,
             'match', array_remove(ARRAY[
               CASE WHEN o.phone_match THEN 'phone' END,
               CASE WHEN o.name_match THEN 'name' END], NULL))
             ORDER BY o.id), '[]'::json) AS duplicates
    FROM (
      SELECT o.id, o.name, o.status,
             (ARRAY[${DIGITS("o.phone")}, ${DIGITS("o.whatsapp")}] && ARRAY[${DIGITS("v.phone")}, ${DIGITS("v.whatsapp")}]
              AND COALESCE(${DIGITS("o.phone")}, ${DIGITS("o.whatsapp")}) IS NOT NULL) AS phone_match,
             (o.district_id = v.district_id AND ${NNAME("o.name")} = ${NNAME("v.name")}) AS name_match
      FROM vendors o
      WHERE o.id <> v.id
    ) o
    WHERE o.phone_match OR o.name_match
  ) dup ON true`;

// ARRAY[NULL] && ARRAY[NULL] is false in Postgres, so NULL numbers never match.

function tabWhere(tab: VendorTab): string | null {
  if (tab === "all") return null;
  if (tab === "rereview") return "v.rereview_required AND v.status = 'approved'";
  return `v.status = '${tab}'`;
}

function listWhere(f: VendorListFilters, values: unknown[]): string[] {
  const where: string[] = [];
  const t = tabWhere(f.tab ?? "pending");
  if (t) where.push(t);
  if (f.districtId) {
    values.push(f.districtId);
    where.push(`v.district_id = $${values.length}`);
  }
  if (f.categoryId) {
    values.push(f.categoryId);
    where.push(
      `(v.primary_category_id = $${values.length} OR EXISTS (SELECT 1 FROM vendor_categories vc WHERE vc.vendor_id = v.id AND vc.category_id = $${values.length}))`
    );
  }
  const q = (f.q ?? "").trim().slice(0, 100);
  if (q) {
    const parts: string[] = [];
    values.push(`%${escapeLike(q)}%`);
    const like = `$${values.length}`;
    parts.push(`v.name ILIKE ${like}`, `v.legal_name ILIKE ${like}`, `u.email ILIKE ${like}`);
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 5) {
      values.push(`%${digits}%`);
      const d = `$${values.length}`;
      parts.push(
        `regexp_replace(COALESCE(v.phone, ''), '\\D', '', 'g') LIKE ${d}`,
        `regexp_replace(COALESCE(v.whatsapp, ''), '\\D', '', 'g') LIKE ${d}`
      );
    }
    if (/^#?\d{1,9}$/.test(q)) {
      values.push(Number(q.replace("#", "")));
      parts.push(`v.id = $${values.length}`);
    }
    where.push(`(${parts.join(" OR ")})`);
  }
  return where;
}

/** The queue: pending is oldest-submitted first (FIFO), other tabs newest first. */
export async function listAdminVendors(f: VendorListFilters): Promise<{ rows: AdminVendorRow[]; total: number }> {
  const values: unknown[] = [];
  const where = listWhere(f, values);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const tab = f.tab ?? "pending";
  const order =
    tab === "pending"
      ? "v.submitted_at ASC NULLS LAST, v.id ASC"
      : tab === "rereview"
        ? "v.rereview_requested_at ASC NULLS LAST, v.id ASC"
        : "COALESCE(v.updated_at, v.created_at) DESC, v.id DESC";
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const from = `FROM vendors v
    LEFT JOIN users u ON u.id = v.owner_id
    LEFT JOIN categories c ON c.id = v.primary_category_id
    LEFT JOIN districts d ON d.id = v.district_id`;
  const [rows, count] = await Promise.all([
    pool.query<AdminVendorRow>(
      `SELECT v.id, v.name, v.status, COALESCE(c.name, v.category) AS category,
              COALESCE(d.name, v.location) AS district, v.district_id, v.phone, v.whatsapp,
              v.owner_id, u.email AS owner_email, u.name AS owner_name,
              v.submitted_at, v.created_at, v.updated_at, v.verified_at, v.rereview_required, v.rereview_fields,
              v.status_reason,
              (SELECT COUNT(*)::int FROM media_assets m WHERE m.vendor_id = v.id AND m.status = 'pending_review') AS pending_media,
              dup.duplicates
       ${from}
       ${DUPLICATES_LATERAL}
       ${whereSql}
       ORDER BY ${order}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    ),
    pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n ${from} ${whereSql}`, values),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.n ?? 0 };
}

/** Count per tab (for the tab badges). */
export async function countVendorTabs(): Promise<Record<VendorTab, number>> {
  const r = await pool.query<{ status: string; n: number; rereview: number }>(
    `SELECT status, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE rereview_required AND status = 'approved')::int AS rereview
     FROM vendors GROUP BY status`
  );
  const out = Object.fromEntries(VENDOR_TABS.map((t) => [t.key, 0])) as Record<VendorTab, number>;
  for (const row of r.rows) {
    if (row.status in out) out[row.status as VendorTab] = row.n;
    out.all += row.n;
    out.rereview += row.rereview;
  }
  return out;
}

export async function findFilterOptions() {
  const [districts, categories] = await Promise.all([
    pool.query<{ id: number; name: string }>("SELECT id, name FROM districts WHERE state = 'Kerala' ORDER BY name"),
    pool.query<{ id: number; name: string }>("SELECT id, name FROM categories ORDER BY name"),
  ]);
  return { districts: districts.rows, categories: categories.rows };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface AdminVendorDetail {
  vendor: VendorRecord & {
    category_name: string | null;
    district_name: string | null;
    admin_notes: string | null;
    verified_by_name: string | null;
    reviewed_by_name: string | null;
  };
  owner: { id: number; email: string; name: string; role: string; status: string } | null;
  additionalCategories: string[];
  serviceAreas: string[];
  offerings: {
    id: number;
    title: string;
    kind: string;
    category: string;
    template_name: string | null;
    custom_name: string | null;
    custom_status: string | null;
    active: boolean;
    hidden_reason: string | null;
    price_mode: string;
    price_from: number;
    price_to: number | null;
    price_unit: string;
  }[];
  media: {
    id: number;
    kind: string;
    purpose: string;
    status: string;
    status_reason: string | null;
    caption: string;
    alt_text: string;
    report_count: number;
    thumb: string | null;
    full: string | null;
    external_url: string | null;
    created_at: string;
  }[];
  documents: {
    id: number;
    doc_type: string;
    number: string | null;
    status: string;
    expires_at: string | null;
    note: string | null;
    created_at: string;
  }[];
  statusEvents: { id: number; from_status: string; to_status: string; reason: string | null; changed_by_name: string | null; created_at: string }[];
  auditTrail: {
    id: number;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_name: string | null;
    reason: string | null;
    before: unknown;
    after: unknown;
    created_at: string;
  }[];
  duplicates: DuplicateHint[];
}

export async function getAdminVendorDetail(id: number): Promise<AdminVendorDetail | null> {
  const v = await pool.query<AdminVendorDetail["vendor"] & { duplicates: DuplicateHint[] }>(
    `SELECT v.*, c.name AS category_name, d.name AS district_name,
            vb.name AS verified_by_name, rb.name AS reviewed_by_name, dup.duplicates
     FROM vendors v
     LEFT JOIN categories c ON c.id = v.primary_category_id
     LEFT JOIN districts d ON d.id = v.district_id
     LEFT JOIN users vb ON vb.id = v.verified_by
     LEFT JOIN users rb ON rb.id = v.reviewed_by
     ${DUPLICATES_LATERAL}
     WHERE v.id = $1`,
    [id]
  );
  const row = v.rows[0];
  if (!row) return null;
  const { duplicates, ...vendor } = row;

  const [owner, cats, areas, offerings, media, docs, events, trail] = await Promise.all([
    vendor.owner_id
      ? pool.query("SELECT id, email, name, role, status FROM users WHERE id = $1", [vendor.owner_id])
      : Promise.resolve({ rows: [] }),
    pool.query<{ name: string }>(
      "SELECT c.name FROM vendor_categories vc JOIN categories c ON c.id = vc.category_id WHERE vc.vendor_id = $1 ORDER BY c.name",
      [id]
    ),
    pool.query<{ name: string }>(
      "SELECT d.name FROM vendor_service_areas a JOIN districts d ON d.id = a.district_id WHERE a.vendor_id = $1 ORDER BY d.name",
      [id]
    ),
    pool.query<AdminVendorDetail["offerings"][number]>(
      `SELECT s.id, s.title, s.kind, c.name AS category, t.name AS template_name, s.custom_name,
              (SELECT r.status FROM custom_offering_requests r WHERE r.service_id = s.id ORDER BY r.id DESC LIMIT 1) AS custom_status,
              s.active, s.hidden_reason, s.price_mode, s.price_from, s.price_to, s.price_unit
       FROM services s
       JOIN categories c ON c.id = s.category_id
       LEFT JOIN offering_templates t ON t.id = s.template_id
       WHERE s.vendor_id = $1
       ORDER BY s.sort_order, s.id`,
      [id]
    ),
    pool.query(
      `SELECT id, kind, purpose, status, status_reason, caption, alt_text, report_count, storage_driver, storage_key,
              variants, external_url, external_provider, external_id, created_at
       FROM media_assets WHERE vendor_id = $1 AND status NOT IN ('uploading', 'processing')
       ORDER BY (status = 'pending_review') DESC, sort_order, id`,
      [id]
    ),
    pool.query<AdminVendorDetail["documents"][number]>(
      `SELECT id, doc_type, number, status, expires_at, note, created_at
       FROM vendor_documents WHERE vendor_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
    pool.query<AdminVendorDetail["statusEvents"][number]>(
      `SELECT e.id, e.from_status, e.to_status, e.reason, u.name AS changed_by_name, e.created_at
       FROM vendor_status_events e LEFT JOIN users u ON u.id = e.changed_by
       WHERE e.vendor_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 50`,
      [id]
    ),
    pool.query<AdminVendorDetail["auditTrail"][number]>(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, u.name AS actor_name, a.reason, a.before, a.after, a.created_at
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE (a.entity_type = 'vendor' AND a.entity_id = $1::text)
          OR (a.entity_type = 'media' AND a.entity_id IN (SELECT id::text FROM media_assets WHERE vendor_id = $1::int))
       ORDER BY a.id DESC LIMIT 50`,
      [id]
    ),
  ]);

  return {
    vendor,
    owner: (owner.rows[0] as AdminVendorDetail["owner"]) ?? null,
    additionalCategories: cats.rows.map((r) => r.name),
    serviceAreas: areas.rows.map((r) => r.name),
    offerings: offerings.rows,
    media: media.rows.map((m) => {
      const urls = assetUrls(m);
      const ytThumb =
        m.kind === "video_link" && m.external_provider === "youtube" && m.external_id
          ? `https://i.ytimg.com/vi/${m.external_id}/hqdefault.jpg`
          : null;
      return {
        id: m.id,
        kind: m.kind,
        purpose: m.purpose,
        status: m.status,
        status_reason: m.status_reason,
        caption: m.caption,
        alt_text: m.alt_text,
        report_count: m.report_count ?? 0,
        thumb: urls.thumb ?? ytThumb,
        full: urls.full ?? urls.video ?? m.external_url ?? null,
        external_url: m.external_url,
        created_at: m.created_at,
      };
    }),
    documents: docs.rows,
    statusEvents: events.rows,
    auditTrail: trail.rows,
    duplicates: duplicates ?? [],
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const DECISION_ACTIONS = ["approve", "request_changes", "reject", "suspend", "unsuspend", "clear_rereview"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** Statuses each action may start from. */
const ALLOWED_FROM: Record<DecisionAction, VendorStatus[]> = {
  approve: ["pending", "changes_requested", "rejected"],
  request_changes: ["pending", "approved"],
  reject: ["pending", "changes_requested"],
  suspend: ["draft", "pending", "changes_requested", "approved", "rejected"],
  unsuspend: ["suspended"],
  clear_rereview: ["approved"],
};

/** Actions that need a reason (reason dialog in the UI). */
export const REASON_REQUIRED: Record<DecisionAction, boolean> = {
  approve: false,
  request_changes: true,
  reject: true,
  suspend: true,
  unsuspend: false,
  clear_rereview: false,
};

export function allowedActions(status: VendorStatus, rereview: boolean): DecisionAction[] {
  return DECISION_ACTIONS.filter(
    (a) => ALLOWED_FROM[a].includes(status) && (a !== "clear_rereview" || rereview)
  );
}

/** Marks a user suspended because their listing was suspended (reversed by unsuspend). */
export const LISTING_SUSPENSION_PREFIX = "Listing suspended: ";

const NOTE: Record<Exclude<DecisionAction, "clear_rereview">, { kind: string; title: string; body: (r: string | null) => string }> = {
  approve: {
    kind: "vendor.approved",
    title: "Your listing is live",
    body: () => "Customers can now find you in search and send enquiries.",
  },
  request_changes: {
    kind: "vendor.changes_requested",
    title: "Changes requested on your listing",
    body: (r) => `Our team asked for a few changes before your listing goes live: ${r}`,
  },
  reject: {
    kind: "vendor.rejected",
    title: "Your listing wasn't approved",
    body: (r) => `Reason: ${r}`,
  },
  suspend: {
    kind: "vendor.suspended",
    title: "Your listing is suspended",
    body: (r) => `Reason: ${r}`,
  },
  unsuspend: {
    kind: "vendor.unsuspended",
    title: "Your listing is no longer suspended",
    body: () => "You can sign in again.",
  },
};

type VendorRow = VendorRecord & { admin_notes?: string | null };

async function lockVendor(client: TxClient, id: number): Promise<VendorRow> {
  const r = await client.query<VendorRow>("SELECT * FROM vendors WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rows[0]) throw new HttpError(404, "Vendor not found.", "NOT_FOUND");
  return r.rows[0];
}

function statusSnapshot(v: VendorRow) {
  return {
    status: v.status,
    status_reason: v.status_reason ?? null,
    rereview_required: !!v.rereview_required,
    rereview_fields: v.rereview_fields ?? [],
  };
}

export interface DecisionInput {
  actorId: number;
  vendorId: number;
  action: DecisionAction;
  reason: string | null;
  expectedStatus?: VendorStatus | null;
  ip?: string | null;
}

export async function decideVendor(input: DecisionInput) {
  const { actorId, vendorId, action, reason, ip } = input;
  if (REASON_REQUIRED[action] && !reason) throw new HttpError(400, "Please give a reason (3 to 1000 characters).", "VALIDATION");

  return withTransaction(async (client) => {
    const v = await lockVendor(client, vendorId);
    if (input.expectedStatus && input.expectedStatus !== v.status) {
      throw new HttpError(409, "Already handled: this listing's status changed. Reload to see it.", "ALREADY_HANDLED");
    }
    if (!ALLOWED_FROM[action].includes(v.status) || (action === "clear_rereview" && !v.rereview_required)) {
      throw new HttpError(409, `Already handled: can't ${action.replace("_", " ")} a ${v.status.replace("_", " ")} listing.`, "ALREADY_HANDLED");
    }

    const from = v.status;
    let to: VendorStatus = from;
    let extraSet = "";
    let approvedMedia = 0;
    switch (action) {
      case "approve":
        to = "approved";
        extraSet = `, status_reason = NULL, rereview_required = false, rereview_fields = '{}', rereview_requested_at = NULL,
                     onboarding_completed_at = COALESCE(onboarding_completed_at, now())`;
        break;
      case "request_changes":
        to = "changes_requested";
        extraSet = ", status_reason = $3";
        break;
      case "reject":
        to = "rejected";
        extraSet = ", status_reason = $3";
        break;
      case "suspend":
        to = "suspended";
        extraSet = ", status_reason = $3";
        break;
      case "unsuspend": {
        const prev = await client.query<{ from_status: string }>(
          `SELECT from_status FROM vendor_status_events WHERE vendor_id = $1 AND to_status = 'suspended'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [vendorId]
        );
        const p = prev.rows[0]?.from_status as VendorStatus | undefined;
        to = p && p !== "suspended" ? p : "approved";
        extraSet = ", status_reason = NULL";
        break;
      }
      case "clear_rereview":
        extraSet = ", rereview_required = false, rereview_fields = '{}', rereview_requested_at = NULL";
        break;
    }

    // Optimistic: only if the status is still what we locked.
    const params: unknown[] = [vendorId, from];
    if (extraSet.includes("$3")) params.push(reason);
    params.push(actorId);
    const actorParam = `$${params.length}`;
    const upd = await client.query<VendorRow>(
      `UPDATE vendors SET status = '${to}', reviewed_at = now(), reviewed_by = ${actorParam}, updated_at = now() ${extraSet}
       WHERE id = $1 AND status = $2 RETURNING *`,
      params
    );
    const after = upd.rows[0];
    if (!after) throw new HttpError(409, "Already handled.", "ALREADY_HANDLED");

    if (action === "approve") {
      const m = await client.query(
        `UPDATE media_assets SET status = 'approved', status_reason = NULL, reviewed_by = $2, reviewed_at = now(), updated_at = now()
         WHERE vendor_id = $1 AND status = 'pending_review'`,
        [vendorId, actorId]
      );
      approvedMedia = m.rowCount ?? 0;
    }

    // The owner's login follows the listing (P1-3 AC: suspending blocks login).
    let ownerSuspended = false;
    let ownerRestored = false;
    if (v.owner_id && action === "suspend") {
      const u = await client.query(
        `UPDATE users SET status = 'suspended', suspended_at = now(), suspended_reason = $2,
                session_version = session_version + 1
         WHERE id = $1 AND role = 'vendor' AND status = 'active'`,
        [v.owner_id, (LISTING_SUSPENSION_PREFIX + (reason ?? "")).slice(0, 1000)]
      );
      ownerSuspended = (u.rowCount ?? 0) > 0;
    }
    if (v.owner_id && action === "unsuspend") {
      // Only lift a suspension this listing caused (not one set in Users).
      const u = await client.query(
        `UPDATE users SET status = 'active', suspended_at = NULL, suspended_reason = NULL
         WHERE id = $1 AND status = 'suspended' AND suspended_reason LIKE $2`,
        [v.owner_id, `${LISTING_SUSPENSION_PREFIX}%`]
      );
      ownerRestored = (u.rowCount ?? 0) > 0;
    }

    if (to !== from) {
      await client.query(
        "INSERT INTO vendor_status_events (vendor_id, from_status, to_status, reason, changed_by) VALUES ($1, $2, $3, $4, $5)",
        [vendorId, from, to, reason, actorId]
      );
    }
    if (action !== "clear_rereview") {
      const n = NOTE[action];
      await notify(client, v.owner_id, n.kind, n.title, n.body(reason), "/vendor", { vendorId });
    }
    await audit(client, {
      actorId,
      action: `vendor.${action}`,
      entityType: "vendor",
      entityId: vendorId,
      before: statusSnapshot(v),
      after: {
        ...statusSnapshot(after),
        ...(approvedMedia ? { approved_media: approvedMedia } : {}),
        ...(ownerSuspended ? { owner_suspended: v.owner_id } : {}),
        ...(ownerRestored ? { owner_restored: v.owner_id } : {}),
      },
      reason,
      ip,
    });
    return { vendor: after, from, to, approvedMedia, ownerSuspended, ownerRestored };
  });
}

// ---------------------------------------------------------------------------
// Verified badge
// ---------------------------------------------------------------------------

export async function setVendorVerified(actorId: number, vendorId: number, verified: boolean, ip?: string | null) {
  return withTransaction(async (client) => {
    const v = await lockVendor(client, vendorId);
    const isVerified = !!v.verified_at;
    if (isVerified === verified) {
      throw new HttpError(409, verified ? "Already verified." : "Not verified.", "ALREADY_HANDLED");
    }
    if (verified && v.status !== "approved") {
      throw new HttpError(409, "Approve the listing before giving it the Verified badge.", "NOT_APPROVED");
    }
    const upd = await client.query<VendorRow>(
      verified
        ? "UPDATE vendors SET verified_at = now(), verified_by = $2, updated_at = now() WHERE id = $1 RETURNING *"
        : "UPDATE vendors SET verified_at = NULL, verified_by = NULL, updated_at = now() WHERE id = $1 RETURNING *",
      verified ? [vendorId, actorId] : [vendorId]
    );
    const after = upd.rows[0];
    if (verified) {
      await notify(client, v.owner_id, "vendor.verified", "You're now a Verified business", "The Verified badge now shows on your public profile.", "/vendor", { vendorId });
    }
    await audit(client, {
      actorId,
      action: verified ? "vendor.verify" : "vendor.unverify",
      entityType: "vendor",
      entityId: vendorId,
      before: { verified_at: v.verified_at ?? null },
      after: { verified_at: after.verified_at ?? null },
      ip,
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Edit on the vendor's behalf (P1-11)
// ---------------------------------------------------------------------------

/** camelCase patch key -> vendors column. */
export const EDITABLE_COLUMNS: Record<string, string> = {
  name: "name",
  vendorType: "vendor_type",
  about: "about",
  yearsExperience: "years_experience",
  yearEstablished: "year_established",
  teamSize: "team_size",
  languages: "languages",
  tags: "tags",
  phone: "phone",
  whatsapp: "whatsapp",
  districtId: "district_id",
  primaryCategoryId: "primary_category_id",
  location: "location",
  addressLine: "address_line",
  landmark: "landmark",
  pincode: "pincode",
  legalName: "legal_name",
  gstin: "gstin",
  fssaiNo: "fssai_no",
  instagramUrl: "instagram_url",
  youtubeUrl: "youtube_url",
  websiteUrl: "website_url",
  travelOutsideKerala: "travel_outside_kerala",
  maxEventsPerDay: "max_events_per_day",
  maxGuests: "max_guests",
  adminNotes: "admin_notes",
};

function same(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

export async function editVendor(actorId: number, vendorId: number, patch: Record<string, unknown>, ip?: string | null) {
  return withTransaction(async (client) => {
    const v = await lockVendor(client, vendorId);
    const current = v as unknown as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [vendorId];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const [key, col] of Object.entries(EDITABLE_COLUMNS)) {
      if (!(key in patch)) continue;
      const next = patch[key];
      if (same(current[col], next)) continue;
      before[col] = current[col] ?? null;
      after[col] = next ?? null;
      values.push(next ?? null);
      sets.push(`${col} = $${values.length}${col === "vendor_type" ? "::vendor_type" : ""}`);
    }
    // Keep the legacy text columns in step (search reads them).
    if ("primary_category_id" in after) {
      const c = await client.query<{ name: string }>("SELECT name FROM categories WHERE id = $1", [after.primary_category_id]);
      if (!c.rows[0]) throw new HttpError(400, "Choose a category from the list.", "VALIDATION");
      values.push(c.rows[0].name);
      sets.push(`category = $${values.length}`);
    }
    if ("district_id" in after && !("location" in after)) {
      const d = await client.query<{ name: string }>("SELECT name FROM districts WHERE id = $1", [after.district_id]);
      if (!d.rows[0]) throw new HttpError(400, "Choose a district from the list.", "VALIDATION");
      values.push(d.rows[0].name);
      sets.push(`location = $${values.length}`);
    }
    if ("years_experience" in after) {
      values.push(after.years_experience == null ? "" : `${after.years_experience} yrs`);
      sets.push(`experience = $${values.length}`);
    }
    if (!sets.length) return { vendor: v, changed: false as const, fields: [] as string[] };

    sets.push("updated_at = now()");
    const upd = await client.query<VendorRow>(`UPDATE vendors SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, values);
    const fields = Object.keys(after);
    const publicFields = fields.filter((f) => f !== "admin_notes");
    if (publicFields.length) {
      await notify(
        client,
        v.owner_id,
        "vendor.edited",
        "Our team updated your listing",
        `Changed: ${publicFields.map((f) => f.replace(/_/g, " ")).join(", ")}.`,
        "/vendor/profile",
        { vendorId, fields: publicFields }
      );
    }
    await audit(client, { actorId, action: "vendor.edit", entityType: "vendor", entityId: vendorId, before, after, ip });
    return { vendor: upd.rows[0], changed: true as const, fields };
  });
}

// ---------------------------------------------------------------------------
// Assign owner / claim (P1-11)
// ---------------------------------------------------------------------------

export async function assignVendorOwner(
  actorId: number,
  vendorId: number,
  target: { userId?: number; email?: string },
  ip?: string | null
) {
  return withTransaction(async (client) => {
    const v = await lockVendor(client, vendorId);
    if (v.owner_id) throw new HttpError(409, "This listing already has an owner.", "HAS_OWNER");
    const u = await client.query<{ id: number; email: string; name: string; role: string; status: string }>(
      target.userId
        ? "SELECT id, email, name, role, status FROM users WHERE id = $1 FOR UPDATE"
        : "SELECT id, email, name, role, status FROM users WHERE lower(email) = lower($1) FOR UPDATE",
      [target.userId ?? target.email]
    );
    const user = u.rows[0];
    if (!user) throw new HttpError(404, "No account with that email.", "USER_NOT_FOUND");
    if (user.role !== "vendor") throw new HttpError(409, "That account is not a vendor account.", "NOT_VENDOR");
    if (user.status !== "active") throw new HttpError(409, "That account is suspended or deleted.", "USER_INACTIVE");
    const owns = await client.query("SELECT id FROM vendors WHERE owner_id = $1 LIMIT 1", [user.id]);
    if (owns.rows[0]) throw new HttpError(409, "That account already owns a listing (one listing per account).", "ALREADY_OWNS");

    const upd = await client.query<VendorRow>(
      `UPDATE vendors SET owner_id = $2, onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
              onboarding_step = GREATEST(onboarding_step, 6), updated_at = now()
       WHERE id = $1 AND owner_id IS NULL RETURNING *`,
      [vendorId, user.id]
    );
    if (!upd.rows[0]) throw new HttpError(409, "Already handled.", "ALREADY_HANDLED");
    await notify(client, user.id, "vendor.claimed", `You now manage ${v.name}`, "Our team linked this listing to your account.", "/vendor", { vendorId });
    await audit(client, {
      actorId,
      action: "vendor.assign_owner",
      entityType: "vendor",
      entityId: vendorId,
      before: { owner_id: null },
      after: { owner_id: user.id, owner_email: user.email },
      ip,
    });
    return { vendor: upd.rows[0], owner: { id: user.id, email: user.email, name: user.name } };
  });
}

// ---------------------------------------------------------------------------
// Per-item media decision from the vendor detail strip
// ---------------------------------------------------------------------------

export async function decideVendorMedia(
  actorId: number,
  vendorId: number,
  mediaId: number,
  action: "approve" | "reject",
  reason: string | null,
  ip?: string | null
) {
  if (action === "reject" && !reason) throw new HttpError(400, "Please give a reason (3 to 1000 characters).", "VALIDATION");
  return withTransaction(async (client) => {
    const r = await client.query<{ id: number; status: string; status_reason: string | null; owner_id: number | null }>(
      `SELECT m.id, m.status, m.status_reason, v.owner_id FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
       WHERE m.id = $1 AND m.vendor_id = $2 FOR UPDATE OF m`,
      [mediaId, vendorId]
    );
    const m = r.rows[0];
    if (!m) throw new HttpError(404, "Media not found.", "NOT_FOUND");
    const okFrom = action === "approve" ? ["pending_review"] : ["pending_review", "approved"];
    if (!okFrom.includes(m.status)) throw new HttpError(409, "Already handled.", "ALREADY_HANDLED");
    const to = action === "approve" ? "approved" : "rejected";
    await client.query(
      `UPDATE media_assets SET status = $2, status_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
       WHERE id = $1`,
      [mediaId, to, action === "reject" ? reason : null, actorId]
    );
    if (action === "reject") {
      await notify(client, m.owner_id, "media.rejected", "A photo was not approved", `Reason: ${reason}`, "/vendor/media", { vendorId, mediaId });
    }
    await audit(client, {
      actorId,
      action: `media.${action}`,
      entityType: "media",
      entityId: mediaId,
      before: { status: m.status, status_reason: m.status_reason },
      after: { status: to, status_reason: action === "reject" ? reason : null, vendor_id: vendorId },
      reason,
      ip,
    });
    return { id: mediaId, status: to };
  });
}
