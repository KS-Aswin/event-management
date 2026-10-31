// Media and review moderation for the admin area (PRODUCT_PLAN 4.5, P1-5,
// P1-6). Every mutation runs in one withTransaction(): the change, exactly
// one admin_audit_log row and (where the vendor is affected) one
// notification commit or roll back together.

import { pool, recomputeVendorRating } from "@/lib/db";
import { assetUrls, type MediaAssetRow, type MediaStatus } from "@/lib/media/repo";
import { getStorage } from "@/lib/storage";
import { audit } from "./audit";
import { notify } from "./notify";
import { HttpError, withTransaction, type TxClient } from "./tx";

/** Distinct open reports at which an approved asset goes back to review. */
export const MEDIA_REPORT_THRESHOLD = 2;
/** Admin-hidden media carry status_reason "admin:<reason>" so the vendor cannot unhide them. */
export const ADMIN_HIDE_PREFIX = "admin:";
const RECENT_DAYS = 14;
const PAGE_SIZE = 48;

// ---------------------------------------------------------------------------
// Media queue
// ---------------------------------------------------------------------------

export type MediaTab = "pre" | "recent" | "reported";
export const MEDIA_TABS: readonly MediaTab[] = ["pre", "recent", "reported"];

export function parseMediaTab(v: unknown): MediaTab {
  return MEDIA_TABS.includes(v as MediaTab) ? (v as MediaTab) : "pre";
}

export interface MediaReportItem {
  id: number;
  reason: string;
  createdAt: string;
}

export interface MediaQueueItem {
  id: number;
  kind: MediaAssetRow["kind"];
  purpose: MediaAssetRow["purpose"];
  status: MediaStatus;
  statusReason: string | null;
  caption: string;
  altText: string;
  width: number | null;
  height: number | null;
  placeholderColor: string | null;
  createdAt: string;
  reviewedAt: string | null;
  thumb: string | null;
  full: string | null;
  externalUrl: string | null;
  vendor: { id: number; name: string; status: string; district: string | null };
  reports: MediaReportItem[];
}

interface QueueRow extends MediaAssetRow {
  reviewed_at: string | null;
  vendor_name: string;
  vendor_status: string;
  district_name: string | null;
  reports: MediaReportItem[] | null;
}

const OPEN_REPORTS_SQL = `
  COALESCE((SELECT json_agg(json_build_object('id', r.id, 'reason', r.reason, 'createdAt', r.created_at)
                            ORDER BY r.created_at)
              FROM media_reports r WHERE r.media_id = m.id AND r.status = 'open'), '[]'::json)`;

function tabWhere(tab: MediaTab): string {
  switch (tab) {
    // Pre-moderation: media waiting with a listing that is not live yet
    // (reported media of live vendors is in "reported").
    case "pre":
      return `m.status = 'pending_review' AND v.status <> 'approved'
              AND NOT EXISTS (SELECT 1 FROM media_reports r WHERE r.media_id = m.id AND r.status = 'open')`;
    // Post-moderation spot check: approved uploads of live vendors in the
    // last 14 days that no admin has looked at yet.
    case "recent":
      return `m.status = 'approved' AND v.status = 'approved' AND m.reviewed_at IS NULL
              AND m.created_at > now() - interval '${RECENT_DAYS} days'
              AND NOT EXISTS (SELECT 1 FROM media_reports r WHERE r.media_id = m.id AND r.status = 'open')`;
    case "reported":
      return `m.status NOT IN ('uploading','processing')
              AND EXISTS (SELECT 1 FROM media_reports r WHERE r.media_id = m.id AND r.status = 'open')`;
  }
}

function toQueueItem(r: QueueRow): MediaQueueItem {
  const urls = assetUrls(r);
  const ytThumb =
    r.kind === "video_link" && r.external_provider === "youtube" && r.external_id
      ? `https://i.ytimg.com/vi/${r.external_id}/hqdefault.jpg`
      : null;
  return {
    id: r.id,
    kind: r.kind,
    purpose: r.purpose,
    status: r.status,
    statusReason: r.status_reason,
    caption: r.caption,
    altText: r.alt_text,
    width: r.width,
    height: r.height,
    placeholderColor: r.placeholder_color,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    thumb: urls.card ?? urls.thumb ?? ytThumb,
    full: urls.full ?? urls.video ?? null,
    externalUrl: r.external_url,
    vendor: { id: r.vendor_id, name: r.vendor_name, status: r.vendor_status, district: r.district_name },
    reports: r.reports ?? [],
  };
}

export interface MediaQueue {
  tab: MediaTab;
  items: MediaQueueItem[];
  total: number;
  counts: Record<MediaTab, number>;
  page: number;
  pageSize: number;
}

export async function listMediaQueue(tab: MediaTab, page = 1): Promise<MediaQueue> {
  const p = Math.max(1, Math.floor(page) || 1);
  const order = tab === "recent" ? "m.created_at DESC, m.id DESC" : "m.created_at ASC, m.id ASC";
  const [rows, counts] = await Promise.all([
    pool.query<QueueRow>(
      `SELECT m.*, v.name AS vendor_name, v.status AS vendor_status, d.name AS district_name,
              ${OPEN_REPORTS_SQL} AS reports
         FROM media_assets m
         JOIN vendors v ON v.id = m.vendor_id
         LEFT JOIN districts d ON d.id = v.district_id
        WHERE ${tabWhere(tab)}
        ORDER BY ${tab === "reported" ? "m.report_count DESC, " : ""}${order}
        LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, (p - 1) * PAGE_SIZE]
    ),
    mediaQueueCounts(),
  ]);
  return { tab, items: rows.rows.map(toQueueItem), total: counts[tab], counts, page: p, pageSize: PAGE_SIZE };
}

export async function mediaQueueCounts(): Promise<Record<MediaTab, number>> {
  const r = await pool.query<{ pre: number; recent: number; reported: number }>(
    `SELECT
       (SELECT count(*)::int FROM media_assets m JOIN vendors v ON v.id = m.vendor_id WHERE ${tabWhere("pre")}) AS pre,
       (SELECT count(*)::int FROM media_assets m JOIN vendors v ON v.id = m.vendor_id WHERE ${tabWhere("recent")}) AS recent,
       (SELECT count(*)::int FROM media_assets m JOIN vendors v ON v.id = m.vendor_id WHERE ${tabWhere("reported")}) AS reported`
  );
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// Media decisions
// ---------------------------------------------------------------------------

export type MediaAction = "approve" | "reject" | "hide" | "remove";
export const MEDIA_ACTIONS: readonly MediaAction[] = ["approve", "reject", "hide", "remove"];
/** Actions that need a written reason (reason dialog). */
export const MEDIA_REASON_REQUIRED: readonly MediaAction[] = ["reject", "hide", "remove"];

interface LockedAsset extends MediaAssetRow {
  reviewed_at: string | null;
  owner_id: number | null;
  vendor_name: string;
  open_reports: number;
}

function snapshot(a: Pick<MediaAssetRow, "status" | "status_reason">, extra: Record<string, unknown> = {}) {
  return { status: a.status, statusReason: a.status_reason, ...extra };
}

/** Clears the vendor's logo/cover (and URL caches) when they point at this asset. */
async function detachVendorImages(client: TxClient, vendorId: number, mediaId: number) {
  await client.query(
    "UPDATE vendors SET logo_media_id = NULL, logo_url = NULL WHERE id = $1 AND logo_media_id = $2",
    [vendorId, mediaId]
  );
  await client.query(
    "UPDATE vendors SET cover_media_id = NULL, cover_image_url = NULL WHERE id = $1 AND cover_media_id = $2",
    [vendorId, mediaId]
  );
}

export interface MediaDecisionResult {
  id: number;
  action: MediaAction;
  status: MediaStatus | "removed";
  auditId: number;
}

/**
 * approve: status approved, marks it checked, dismisses open reports.
 * reject / hide: reason required, closes open reports as actioned, notifies the vendor.
 * remove: deletes the row (objects deleted after commit), notifies the vendor.
 * Throws HttpError 404 (missing), 409 (already handled / still processing).
 */
export async function decideMedia(params: {
  actorId: number;
  mediaId: number;
  action: MediaAction;
  reason: string | null;
  ip?: string | null;
}): Promise<MediaDecisionResult> {
  const { actorId, mediaId, action, reason, ip } = params;
  let toDelete: { driver: string; key: string } | null = null;

  const out = await withTransaction(async (client) => {
    const r = await client.query<LockedAsset>(
      `SELECT m.*, v.owner_id, v.name AS vendor_name,
              (SELECT count(*)::int FROM media_reports x WHERE x.media_id = m.id AND x.status = 'open') AS open_reports
         FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
        WHERE m.id = $1
        FOR UPDATE OF m`,
      [mediaId]
    );
    const a = r.rows[0];
    if (!a) throw new HttpError(404, "Media not found.", "NOT_FOUND");
    if (a.status === "uploading" || a.status === "processing") {
      throw new HttpError(409, "This upload is still processing.", "PROCESSING");
    }
    const before = snapshot(a, { openReports: a.open_reports, reviewed: a.reviewed_at !== null });
    const hasReports = a.open_reports > 0;

    // Optimistic "already handled": nothing left to decide.
    const already =
      (action === "approve" && a.status === "approved" && a.reviewed_at !== null && !hasReports) ||
      (action === "reject" && a.status === "rejected" && !hasReports) ||
      (action === "hide" && a.status === "hidden" && (a.status_reason ?? "").startsWith(ADMIN_HIDE_PREFIX) && !hasReports);
    if (already) throw new HttpError(409, "Someone already handled this item.", "ALREADY_HANDLED");

    const reportStatus = action === "approve" ? "dismissed" : "actioned";
    if (action !== "remove") {
      await client.query("UPDATE media_reports SET status = $2 WHERE media_id = $1 AND status = 'open'", [
        mediaId,
        reportStatus,
      ]);
    }

    let status: MediaStatus | "removed";
    const kindLabel = a.kind === "image" ? "photo" : "video";
    if (action === "approve") {
      status = "approved";
      await client.query(
        `UPDATE media_assets SET status = 'approved', status_reason = NULL, reviewed_by = $2, reviewed_at = now(),
                report_count = 0, updated_at = now() WHERE id = $1`,
        [mediaId, actorId]
      );
    } else if (action === "reject" || action === "hide") {
      status = action === "reject" ? "rejected" : "hidden";
      const stored = action === "reject" ? reason : `${ADMIN_HIDE_PREFIX}${reason}`;
      await client.query(
        `UPDATE media_assets SET status = $2, status_reason = $3, reviewed_by = $4, reviewed_at = now(),
                report_count = 0, is_featured = false, updated_at = now() WHERE id = $1`,
        [mediaId, status, stored, actorId]
      );
      await detachVendorImages(client, a.vendor_id, mediaId);
      await notify(
        client,
        a.owner_id,
        action === "reject" ? "media.rejected" : "media.hidden",
        action === "reject" ? `A ${kindLabel} was not approved` : `A ${kindLabel} was hidden from your profile`,
        reason,
        "/vendor/media",
        { mediaId }
      );
    } else {
      status = "removed";
      await detachVendorImages(client, a.vendor_id, mediaId);
      await client.query("DELETE FROM media_assets WHERE id = $1", [mediaId]);
      if (a.storage_key && a.storage_driver && a.storage_driver !== "url" && a.storage_key.startsWith("vendors/")) {
        toDelete = { driver: a.storage_driver, key: a.storage_key };
      }
      await notify(client, a.owner_id, "media.removed", `A ${kindLabel} was removed from your profile`, reason, "/vendor/media", {
        mediaId,
      });
    }

    const auditId = await audit(client, {
      actorId,
      action: `media.${action}`,
      entityType: "media",
      entityId: mediaId,
      before: { ...before, vendorId: a.vendor_id, vendorName: a.vendor_name, kind: a.kind, purpose: a.purpose },
      after: { status, reportsClosed: action === "remove" ? a.open_reports : hasReports ? a.open_reports : 0 },
      reason,
      ip,
    });
    return { id: mediaId, action, status, auditId };
  });

  // Objects go only after the row is gone for good (commit succeeded).
  const del = toDelete as { driver: string; key: string } | null;
  if (del) {
    try {
      await getStorage(del.driver).deletePrefix(del.key);
    } catch (err) {
      console.warn("[admin] could not delete objects for removed media", mediaId, err);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public media report ("Report photo" in the lightbox)
// ---------------------------------------------------------------------------

export type ReportMediaResult = "ok" | "not_found" | "already_reported" | "own_media";

/**
 * Stores a report on an approved, public asset. Once MEDIA_REPORT_THRESHOLD
 * distinct people have open reports, the asset goes back to pending_review
 * (off public pages) until an admin decides.
 */
export async function reportMedia(params: {
  mediaId: number;
  reporterId: number;
  reason: string;
}): Promise<{ result: ReportMediaResult; status?: MediaStatus }> {
  return withTransaction(async (client) => {
    const r = await client.query<{ id: number; status: MediaStatus; owner_id: number | null }>(
      `SELECT m.id, m.status, v.owner_id FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
        WHERE m.id = $1 AND m.status = 'approved' AND v.status = 'approved' AND v.published
        FOR UPDATE OF m`,
      [params.mediaId]
    );
    const a = r.rows[0];
    if (!a) return { result: "not_found" as const };
    if (a.owner_id === params.reporterId) return { result: "own_media" as const };
    const dup = await client.query(
      "SELECT 1 FROM media_reports WHERE media_id = $1 AND reporter_id = $2 AND status = 'open'",
      [params.mediaId, params.reporterId]
    );
    if (dup.rowCount) return { result: "already_reported" as const };
    await client.query("INSERT INTO media_reports (media_id, reporter_id, reason) VALUES ($1, $2, $3)", [
      params.mediaId,
      params.reporterId,
      params.reason,
    ]);
    const c = await client.query<{ n: number; reporters: number }>(
      `SELECT count(*)::int AS n,
              count(DISTINCT COALESCE(reporter_id::text, 'anon-' || id::text))::int AS reporters
         FROM media_reports WHERE media_id = $1 AND status = 'open'`,
      [params.mediaId]
    );
    const { n, reporters } = c.rows[0];
    const toReview = reporters >= MEDIA_REPORT_THRESHOLD;
    const u = await client.query<{ status: MediaStatus }>(
      `UPDATE media_assets SET report_count = $2,
              status = CASE WHEN $3 THEN 'pending_review' ELSE status END, updated_at = now()
        WHERE id = $1 RETURNING status`,
      [params.mediaId, n, toReview]
    );
    return { result: "ok" as const, status: u.rows[0].status };
  });
}

// ---------------------------------------------------------------------------
// Review moderation
// ---------------------------------------------------------------------------

export type ReviewTab = "open" | "hidden";
export function parseReviewTab(v: unknown): ReviewTab {
  return v === "hidden" ? "hidden" : "open";
}

export interface ReviewReportItem {
  id: number;
  reason: string;
  createdAt: string;
  reporter: string | null;
}

export interface ReviewQueueItem {
  reviewId: number;
  rating: number;
  body: string;
  reviewerName: string;
  verified: boolean;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  vendor: { id: number; name: string; rating: string; reviewsCount: number };
  reports: ReviewReportItem[];
}

export interface ReviewQueue {
  tab: ReviewTab;
  items: ReviewQueueItem[];
  counts: Record<ReviewTab, number>;
}

export async function listReviewQueue(tab: ReviewTab): Promise<ReviewQueue> {
  const where =
    tab === "open"
      ? "EXISTS (SELECT 1 FROM review_reports x WHERE x.review_id = rv.id AND x.status = 'open')"
      : "rv.hidden_at IS NOT NULL";
  const order =
    tab === "open"
      ? "(SELECT min(x.created_at) FROM review_reports x WHERE x.review_id = rv.id AND x.status = 'open') ASC, rv.id ASC"
      : "rv.hidden_at DESC, rv.id DESC";
  const reportFilter = tab === "open" ? "AND x.status = 'open'" : "";
  const [rows, counts] = await Promise.all([
    pool.query<ReviewQueueItem>(
      `SELECT rv.id AS "reviewId", rv.rating, rv.body, rv.reviewer_name AS "reviewerName", rv.verified,
              rv.created_at AS "createdAt", rv.hidden_at AS "hiddenAt", rv.hidden_reason AS "hiddenReason",
              json_build_object('id', v.id, 'name', v.name, 'rating', v.rating::text, 'reviewsCount', v.reviews_count) AS vendor,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'reason', x.reason, 'createdAt', x.created_at,
                                                          'reporter', u.name) ORDER BY x.created_at)
                          FROM review_reports x LEFT JOIN users u ON u.id = x.reporter_id
                         WHERE x.review_id = rv.id ${reportFilter}), '[]'::json) AS reports
         FROM vendor_reviews rv JOIN vendors v ON v.id = rv.vendor_id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT 100`
    ),
    reviewQueueCounts(),
  ]);
  return { tab, items: rows.rows, counts };
}

export async function reviewQueueCounts(): Promise<Record<ReviewTab, number>> {
  const r = await pool.query<{ open: number; hidden: number }>(
    `SELECT (SELECT count(DISTINCT review_id)::int FROM review_reports WHERE status = 'open') AS open,
            (SELECT count(*)::int FROM vendor_reviews WHERE hidden_at IS NOT NULL) AS hidden`
  );
  return r.rows[0];
}

interface LockedReview {
  id: number;
  vendor_id: number;
  rating: number;
  reviewer_name: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  owner_id: number | null;
  vendor_rating: string;
  vendor_reviews_count: number;
}

async function lockReview(client: TxClient, reviewId: number): Promise<LockedReview> {
  const r = await client.query<LockedReview>(
    `SELECT rv.id, rv.vendor_id, rv.rating, rv.reviewer_name, rv.hidden_at, rv.hidden_reason,
            v.owner_id, v.rating::text AS vendor_rating, v.reviews_count AS vendor_reviews_count
       FROM vendor_reviews rv JOIN vendors v ON v.id = rv.vendor_id
      WHERE rv.id = $1
      FOR UPDATE OF rv, v`,
    [reviewId]
  );
  if (!r.rows[0]) throw new HttpError(404, "Review not found.", "NOT_FOUND");
  return r.rows[0];
}

async function vendorRating(client: TxClient, vendorId: number) {
  const r = await client.query<{ rating: string; reviews_count: number }>(
    "SELECT rating::text AS rating, reviews_count FROM vendors WHERE id = $1",
    [vendorId]
  );
  return { rating: r.rows[0].rating, reviewsCount: r.rows[0].reviews_count };
}

export interface ReviewDecisionResult {
  reviewId: number;
  hidden: boolean;
  vendorRating: { rating: string; reviewsCount: number };
  auditId: number;
}

/** Hides a review (reason required), closes its open reports as actioned and recomputes the rating. */
export async function hideReview(params: {
  actorId: number;
  reviewId: number;
  reason: string;
  ip?: string | null;
}): Promise<ReviewDecisionResult> {
  return withTransaction(async (client) => {
    const rv = await lockReview(client, params.reviewId);
    if (rv.hidden_at) throw new HttpError(409, "This review is already hidden.", "ALREADY_HANDLED");
    await client.query(
      "UPDATE vendor_reviews SET hidden_at = now(), hidden_by = $2, hidden_reason = $3 WHERE id = $1",
      [rv.id, params.actorId, params.reason]
    );
    const closed = await client.query(
      `UPDATE review_reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3
        WHERE review_id = $1 AND status = 'open'`,
      [rv.id, params.actorId, params.reason]
    );
    await recomputeVendorRating(client, rv.vendor_id);
    const after = await vendorRating(client, rv.vendor_id);
    await notify(
      client,
      rv.owner_id,
      "review.hidden",
      "A review was removed from your profile",
      "It broke the review policy. Your rating has been updated.",
      "/vendor/reviews",
      { reviewId: rv.id }
    );
    const auditId = await audit(client, {
      actorId: params.actorId,
      action: "review.hide",
      entityType: "review",
      entityId: rv.id,
      before: { hidden: false, vendorId: rv.vendor_id, rating: rv.rating, vendorRating: rv.vendor_rating, reviewsCount: rv.vendor_reviews_count },
      after: { hidden: true, reportsActioned: closed.rowCount ?? 0, vendorRating: after.rating, reviewsCount: after.reviewsCount },
      reason: params.reason,
      ip: params.ip,
    });
    return { reviewId: rv.id, hidden: true, vendorRating: after, auditId };
  });
}

/** Puts a hidden review back and recomputes the rating. */
export async function unhideReview(params: {
  actorId: number;
  reviewId: number;
  reason: string | null;
  ip?: string | null;
}): Promise<ReviewDecisionResult> {
  return withTransaction(async (client) => {
    const rv = await lockReview(client, params.reviewId);
    if (!rv.hidden_at) throw new HttpError(409, "This review is not hidden.", "ALREADY_HANDLED");
    await client.query(
      "UPDATE vendor_reviews SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = $1",
      [rv.id]
    );
    await recomputeVendorRating(client, rv.vendor_id);
    const after = await vendorRating(client, rv.vendor_id);
    const auditId = await audit(client, {
      actorId: params.actorId,
      action: "review.unhide",
      entityType: "review",
      entityId: rv.id,
      before: { hidden: true, hiddenReason: rv.hidden_reason, vendorRating: rv.vendor_rating, reviewsCount: rv.vendor_reviews_count },
      after: { hidden: false, vendorRating: after.rating, reviewsCount: after.reviewsCount },
      reason: params.reason,
      ip: params.ip,
    });
    return { reviewId: rv.id, hidden: false, vendorRating: after, auditId };
  });
}

/**
 * Dismisses an open review report (the review stays). scope "review"
 * dismisses every open report on the same review in one action (one audit row).
 */
export async function dismissReviewReport(params: {
  actorId: number;
  reportId: number;
  scope: "report" | "review";
  note: string | null;
  ip?: string | null;
}): Promise<{ reportId: number; dismissed: number[]; auditId: number }> {
  return withTransaction(async (client) => {
    const r = await client.query<{ id: number; review_id: number; status: string }>(
      "SELECT id, review_id, status FROM review_reports WHERE id = $1 FOR UPDATE",
      [params.reportId]
    );
    const rep = r.rows[0];
    if (!rep) throw new HttpError(404, "Report not found.", "NOT_FOUND");
    if (rep.status !== "open") throw new HttpError(409, "This report was already handled.", "ALREADY_HANDLED");
    const upd = await client.query<{ id: number }>(
      `UPDATE review_reports SET status = 'dismissed', resolved_by = $2, resolved_at = now(), resolution_note = $3
        WHERE status = 'open' AND ${params.scope === "review" ? "review_id = $1" : "id = $1"}
        RETURNING id`,
      [params.scope === "review" ? rep.review_id : rep.id, params.actorId, params.note]
    );
    const dismissed = upd.rows.map((x) => x.id).sort((a, b) => a - b);
    const auditId = await audit(client, {
      actorId: params.actorId,
      action: "report.dismiss",
      entityType: "review_report",
      entityId: rep.id,
      before: { status: "open", reviewId: rep.review_id },
      after: { status: "dismissed", scope: params.scope, dismissed },
      reason: params.note,
      ip: params.ip,
    });
    return { reportId: rep.id, dismissed, auditId };
  });
}
