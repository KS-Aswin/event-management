// Reviews v2 (PRODUCT_PLAN P2-11, section 6, section 9 #20).
//
// Writing: only a customer who sent the vendor an enquiry may review. The
// review is "verified" when that enquiry is accepted or booked AND its event
// date has passed (Indian date); otherwise it is posted unverified.
// Replying: the vendor posts one public reply per review (a second POST is a
// 409); the reply can be edited for 7 days after it was first posted.

import { pool, recomputeVendorRating, type ReviewRecord } from "@/lib/db";
import { notify } from "@/lib/admin/notify";
import { todayIst } from "@/lib/availability";

export const REPLY_MIN = 2;
export const REPLY_MAX = 1000;
export const REPLY_EDIT_DAYS = 7;

export interface ReviewEnquiry {
  id: number;
  status: string;
  eventDate: string | null;
  eventTypeId: number | null;
}

/** Whether a review linked to this enquiry is verified (pure; dates are YYYY-MM-DD). */
export function isVerifiedEnquiry(e: { status: string; eventDate: string | null }, today: string = todayIst()): boolean {
  return (e.status === "booked" || e.status === "accepted") && !!e.eventDate && e.eventDate < today;
}

/** The enquiry a review is linked to: the first one that verifies it, else the latest. */
export function pickReviewEnquiry(list: ReviewEnquiry[], today: string = todayIst()): ReviewEnquiry | null {
  return list.find((e) => isVerifiedEnquiry(e, today)) ?? list[0] ?? null;
}

export type CreateReviewV2Result =
  | { ok: true; review: ReviewRecord }
  | { ok: false; reason: "vendor_not_found" | "own_listing" | "already_reviewed" | "no_enquiry" | "enquiry_not_found" };

export async function createReviewV2(p: {
  vendorId: number;
  customerId: number;
  reviewerName: string;
  rating: number;
  body: string;
  enquiryId?: number | null;
}): Promise<CreateReviewV2Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const v = await client.query<{ id: number; name: string; owner_id: number | null }>(
      "SELECT id, name, owner_id FROM vendors WHERE id = $1 FOR UPDATE",
      [p.vendorId]
    );
    const vendor = v.rows[0];
    if (!vendor) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "vendor_not_found" };
    }
    if (vendor.owner_id === p.customerId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "own_listing" };
    }
    const dup = await client.query("SELECT 1 FROM vendor_reviews WHERE vendor_id = $1 AND customer_id = $2", [p.vendorId, p.customerId]);
    if (dup.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_reviewed" };
    }

    const e = await client.query<{ id: number; status: string; event_date: string | null; event_type_id: number | null }>(
      `SELECT id, status, event_date::text AS event_date, event_type_id FROM quote_requests
        WHERE vendor_id = $1 AND customer_id = $2 AND ($3::int IS NULL OR id = $3)
        ORDER BY created_at DESC, id DESC`,
      [p.vendorId, p.customerId, p.enquiryId ?? null]
    );
    const enquiries = e.rows.map((r) => ({ id: r.id, status: r.status, eventDate: r.event_date, eventTypeId: r.event_type_id }));
    if (!enquiries.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: p.enquiryId ? "enquiry_not_found" : "no_enquiry" };
    }
    const today = todayIst();
    const linked = pickReviewEnquiry(enquiries, today)!;
    const verified = isVerifiedEnquiry(linked, today);

    let review: ReviewRecord;
    try {
      const ins = await client.query<ReviewRecord>(
        `INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body, verified, quote_request_id, event_type_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [p.vendorId, p.customerId, p.reviewerName, p.rating, p.body, verified, linked.id, linked.eventTypeId]
      );
      review = ins.rows[0];
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "already_reviewed" };
      }
      throw err;
    }
    await recomputeVendorRating(client, p.vendorId);
    await notify(
      client,
      vendor.owner_id,
      "review.new",
      `New ${p.rating}-star review`,
      `${p.reviewerName} reviewed ${vendor.name}. You can reply publicly.`,
      "/vendor/reviews",
      { reviewId: review.id }
    );
    await client.query("COMMIT");
    return { ok: true, review };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Vendor side
// ---------------------------------------------------------------------------

export interface VendorReviewItem {
  id: number;
  reviewerName: string;
  rating: number;
  body: string;
  createdAt: string;
  verified: boolean;
  hidden: boolean;
  eventType: string | null;
  enquiryId: number | null;
  reply: string | null;
  replyAt: string | null;
  replyEditedAt: string | null;
  /** The reply can still be edited (within 7 days of first posting). */
  replyEditable: boolean;
}

export async function listVendorReviews(vendorId: number): Promise<VendorReviewItem[]> {
  const r = await pool.query<{
    id: number;
    reviewer_name: string;
    rating: number;
    body: string;
    created_at: Date;
    verified: boolean;
    hidden_at: Date | null;
    event_type: string | null;
    quote_request_id: number | null;
    vendor_reply: string | null;
    vendor_reply_at: Date | null;
    vendor_reply_edited_at: Date | null;
    editable: boolean;
  }>(
    `SELECT r.id, r.reviewer_name, r.rating, r.body, r.created_at, r.verified, r.hidden_at,
            et.name AS event_type, r.quote_request_id, r.vendor_reply, r.vendor_reply_at, r.vendor_reply_edited_at,
            (r.vendor_reply_at IS NOT NULL AND r.vendor_reply_at > now() - make_interval(days => $2)) AS editable
       FROM vendor_reviews r LEFT JOIN event_types et ON et.id = r.event_type_id
      WHERE r.vendor_id = $1
      ORDER BY (r.vendor_reply IS NULL AND r.hidden_at IS NULL) DESC, r.created_at DESC, r.id DESC
      LIMIT 200`,
    [vendorId, REPLY_EDIT_DAYS]
  );
  return r.rows.map((x) => ({
    id: x.id,
    reviewerName: x.reviewer_name,
    rating: Number(x.rating),
    body: x.body,
    createdAt: x.created_at.toISOString(),
    verified: x.verified,
    hidden: !!x.hidden_at,
    eventType: x.event_type,
    enquiryId: x.quote_request_id,
    reply: x.vendor_reply,
    replyAt: x.vendor_reply_at ? x.vendor_reply_at.toISOString() : null,
    replyEditedAt: x.vendor_reply_edited_at ? x.vendor_reply_edited_at.toISOString() : null,
    replyEditable: x.editable,
  }));
}

export type ReplyResult =
  | { ok: true; reply: { reviewId: number; body: string; replyAt: string; editedAt: string | null } }
  | { ok: false; status: 403 | 404 | 409; code: string; error: string };

/**
 * mode 'create': the first reply (409 REPLY_EXISTS when there is one).
 * mode 'edit': change the reply within 7 days of first posting
 * (404 NO_REPLY, 409 EDIT_WINDOW_CLOSED).
 */
export async function saveReviewReply(vendorId: number, reviewId: number, text: string, mode: "create" | "edit"): Promise<ReplyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      vendor_id: number;
      customer_id: number | null;
      hidden_at: Date | null;
      vendor_reply: string | null;
      vendor_name: string;
      window_open: boolean;
    }>(
      `SELECT r.vendor_id, r.customer_id, r.hidden_at, r.vendor_reply, v.name AS vendor_name,
              (r.vendor_reply_at > now() - make_interval(days => $2)) AS window_open
         FROM vendor_reviews r JOIN vendors v ON v.id = r.vendor_id WHERE r.id = $1 FOR UPDATE OF r`,
      [reviewId, REPLY_EDIT_DAYS]
    );
    const row = cur.rows[0];
    const fail = async (status: 403 | 404 | 409, code: string, error: string): Promise<ReplyResult> => {
      await client.query("ROLLBACK");
      return { ok: false, status, code, error };
    };
    if (!row) return fail(404, "NOT_FOUND", "Review not found.");
    if (row.vendor_id !== vendorId) return fail(403, "FORBIDDEN", "This review isn't on your listing.");
    if (row.hidden_at) return fail(409, "REVIEW_HIDDEN", "Vela has hidden this review, so it can't be replied to.");

    let saved;
    if (mode === "create") {
      if (row.vendor_reply !== null) {
        return fail(409, "REPLY_EXISTS", "You've already replied to this review. Edit your reply instead.");
      }
      saved = await client.query<{ vendor_reply: string; vendor_reply_at: Date; vendor_reply_edited_at: Date | null }>(
        `UPDATE vendor_reviews SET vendor_reply = $2, vendor_reply_at = now(), vendor_reply_edited_at = NULL
          WHERE id = $1 RETURNING vendor_reply, vendor_reply_at, vendor_reply_edited_at`,
        [reviewId, text]
      );
      await notify(
        client,
        row.customer_id,
        "review.reply",
        `${row.vendor_name} replied to your review`,
        text.length > 140 ? `${text.slice(0, 137)}…` : text,
        `/vendors/${vendorId}#review-${reviewId}`,
        { reviewId }
      );
    } else {
      if (row.vendor_reply === null) return fail(404, "NO_REPLY", "There's no reply to edit yet.");
      if (!row.window_open) {
        return fail(409, "EDIT_WINDOW_CLOSED", `Replies can be edited for ${REPLY_EDIT_DAYS} days after posting.`);
      }
      saved = await client.query<{ vendor_reply: string; vendor_reply_at: Date; vendor_reply_edited_at: Date | null }>(
        `UPDATE vendor_reviews SET vendor_reply = $2, vendor_reply_edited_at = now()
          WHERE id = $1 RETURNING vendor_reply, vendor_reply_at, vendor_reply_edited_at`,
        [reviewId, text]
      );
    }
    await client.query("COMMIT");
    const s = saved.rows[0];
    return {
      ok: true,
      reply: {
        reviewId,
        body: s.vendor_reply,
        replyAt: s.vendor_reply_at.toISOString(),
        editedAt: s.vendor_reply_edited_at ? s.vendor_reply_edited_at.toISOString() : null,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Whether this customer may review the vendor (has sent it an enquiry). */
export async function customerHasEnquiry(vendorId: number, customerId: number): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM quote_requests WHERE vendor_id = $1 AND customer_id = $2 LIMIT 1", [vendorId, customerId]);
  return (r.rowCount ?? 0) > 0;
}

export interface ReviewBreakdown {
  /** Visible (not hidden) reviews on Vela. */
  count: number;
  /** Count per star, 5 down to 1. */
  stars: { star: number; count: number }[];
}

/**
 * The star breakdown of a vendor's visible reviews, counted in the database
 * (not from the first page of reviews the profile lists), so it always adds
 * up to the review count shown next to it (QA-010).
 */
export async function reviewBreakdown(vendorId: number): Promise<ReviewBreakdown> {
  const r = await pool.query<{ rating: number; n: number }>(
    "SELECT rating, count(*)::int AS n FROM vendor_reviews WHERE vendor_id = $1 AND hidden_at IS NULL GROUP BY rating",
    [vendorId]
  );
  const by = new Map(r.rows.map((x) => [Number(x.rating), x.n]));
  const stars = [5, 4, 3, 2, 1].map((star) => ({ star, count: by.get(star) ?? 0 }));
  return { count: stars.reduce((a, s) => a + s.count, 0), stars };
}
