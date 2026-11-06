// Customer area data (PRODUCT_PLAN P2-1, /my/reviews): header counts, the
// next-event card, "still needed" categories, recommendations and review
// prompts. Every query is scoped to the signed-in customer's own rows.

import { pool } from "@/lib/db";

/** Enquiries that are still alive (not closed by either side or by time). */
const LIVE = "q.status IN ('pending','responded','accepted','booked')";

export interface NavCounts {
  /** Unread vendor messages plus offers waiting for an answer. */
  enquiries: number;
  shortlist: number;
}

export async function navCounts(customerId: number): Promise<NavCounts> {
  const r = await pool.query<{ unread: number; offers: number; shortlist: number }>(
    `SELECT
       (SELECT count(*)::int FROM quote_messages m JOIN quote_requests q ON q.id = m.quote_request_id
         WHERE q.customer_id = $1 AND m.read_at IS NULL AND m.sender_role <> 'customer') AS unread,
       (SELECT count(*)::int FROM quote_offers o JOIN quote_requests q ON q.id = o.quote_request_id
         WHERE q.customer_id = $1 AND o.status = 'sent' AND q.status = 'responded'
           AND (o.valid_until IS NULL OR o.valid_until >= CURRENT_DATE)) AS offers,
       (SELECT count(*)::int FROM favorites WHERE customer_id = $1) AS shortlist`,
    [customerId]
  );
  const row = r.rows[0];
  return { enquiries: (row?.unread ?? 0) + (row?.offers ?? 0), shortlist: row?.shortlist ?? 0 };
}

export interface NextEvent {
  date: string;
  /** Whole days from today (India), 0 = today. */
  daysAway: number;
  eventTypeId: number | null;
  eventTypeSlug: string | null;
  eventTypeName: string | null;
  districtId: number | null;
  districtName: string | null;
  guestCount: number | null;
  enquiries: number;
  booked: number;
  /** Categories this event already has a live enquiry for. */
  coveredCategoryIds: number[];
}

/**
 * The customer's next event: the earliest upcoming event date among their
 * live enquiries. Enquiries for the same date and event type count as one
 * event (a family asking a caterer and a photographer for the same wedding).
 */
export async function findNextEvent(customerId: number): Promise<NextEvent | null> {
  const first = await pool.query<{
    date: string;
    days_away: number;
    event_type_id: number | null;
    slug: string | null;
    type_name: string | null;
    district_id: number | null;
    district_name: string | null;
    guest_count: number | null;
  }>(
    `SELECT q.event_date::text AS date, (q.event_date - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS days_away,
            q.event_type_id, et.slug, et.name AS type_name, q.district_id, d.name AS district_name, q.guest_count
       FROM quote_requests q
       LEFT JOIN event_types et ON et.id = q.event_type_id
       LEFT JOIN districts d ON d.id = q.district_id
      WHERE q.customer_id = $1 AND ${LIVE}
        AND q.event_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY q.event_date, (q.event_type_id IS NULL), q.created_at DESC
      LIMIT 1`,
    [customerId]
  );
  const e = first.rows[0];
  if (!e) return null;

  const agg = await pool.query<{ enquiries: number; booked: number; covered: number[] }>(
    `SELECT count(*)::int AS enquiries,
            count(*) FILTER (WHERE q.status = 'booked')::int AS booked,
            COALESCE(array_agg(DISTINCT c.cid) FILTER (WHERE c.cid IS NOT NULL), '{}') AS covered
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(v.primary_category_id, (SELECT id FROM categories WHERE name = v.category)) AS cid
         UNION
         SELECT s.category_id FROM quote_request_services qs JOIN services s ON s.id = qs.service_id
          WHERE qs.quote_request_id = q.id
       ) c ON true
      WHERE q.customer_id = $1 AND ${LIVE} AND q.event_date = $2::date
        AND q.event_type_id IS NOT DISTINCT FROM $3`,
    [customerId, e.date, e.event_type_id]
  );
  const a = agg.rows[0];
  return {
    date: e.date,
    daysAway: e.days_away,
    eventTypeId: e.event_type_id,
    eventTypeSlug: e.slug,
    eventTypeName: e.type_name,
    districtId: e.district_id,
    districtName: e.district_name,
    guestCount: e.guest_count,
    enquiries: a?.enquiries ?? 0,
    booked: a?.booked ?? 0,
    coveredCategoryIds: a?.covered ?? [],
  };
}

export interface RecommendedVendor {
  id: number;
  name: string;
  category: string;
  location: string;
  rating: string;
  reviews_count: number;
  verified: boolean;
  from_price: number | null;
  from_unit: string | null;
  from_unit_label: string | null;
  cover_media_id: number | null;
  cover_image_url: string | null;
  status: "approved";
  published: boolean;
}

/**
 * Discovery for the customer home: public vendors in the recommended order
 * (featured, boost, Bayesian rating), skipping ones already shortlisted or
 * enquired. With a district, vendors based in or serving it come first.
 */
export async function recommendedVendors(
  customerId: number,
  opts: { districtId?: number | null; categoryIds?: number[]; limit?: number } = {}
): Promise<RecommendedVendor[]> {
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 12);
  const r = await pool.query<RecommendedVendor>(
    `SELECT v.id, v.name, v.category, v.location, v.rating, v.reviews_count, (v.verified_at IS NOT NULL) AS verified,
            p.price_from AS from_price, p.price_unit AS from_unit, p.unit_label AS from_unit_label,
            v.cover_media_id, v.cover_image_url, v.status, v.published
       FROM vendors v
       LEFT JOIN LATERAL (
         SELECT s.price_from, s.price_unit, s.unit_label FROM services s
          WHERE s.vendor_id = v.id AND s.active AND s.kind IN ('unit','package') AND s.sale_mode = 'separate'
            AND s.hidden_reason IS NULL AND NOT s.incomplete AND s.price_mode <> 'on_request' AND s.price_from > 0
          ORDER BY s.price_from, s.id LIMIT 1
       ) p ON true
      WHERE v.status = 'approved' AND v.published
        AND v.owner_id IS DISTINCT FROM $1
        AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.customer_id = $1 AND f.vendor_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM quote_requests q WHERE q.customer_id = $1 AND q.vendor_id = v.id)
        AND (cardinality($3::int[]) = 0 OR v.primary_category_id = ANY($3::int[]))
      ORDER BY (CASE WHEN $2::int IS NOT NULL AND (v.district_id = $2
                  OR EXISTS (SELECT 1 FROM vendor_service_areas sa WHERE sa.vendor_id = v.id AND sa.district_id = $2))
                THEN 0 ELSE 1 END),
               (v.featured_until IS NOT NULL AND v.featured_until > now()) DESC, v.rank_boost DESC,
               ((v.rating * v.reviews_count + 5 * 4.5) / (v.reviews_count + 5)) DESC, v.id
      LIMIT $4`,
    [customerId, opts.districtId ?? null, opts.categoryIds ?? [], limit]
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Reviews (/my/reviews)
// ---------------------------------------------------------------------------

export interface MyReview {
  id: number;
  vendorId: number;
  vendorName: string;
  vendorAvailable: boolean;
  rating: number;
  body: string;
  verified: boolean;
  hidden: boolean;
  vendorReply: string | null;
  createdAt: string;
}

export interface ReviewPrompt {
  enquiryId: number;
  vendorId: number;
  vendorName: string;
  category: string;
  eventDate: string;
  eventTypeName: string | null;
  status: "accepted" | "booked";
}

export async function listMyReviews(customerId: number): Promise<MyReview[]> {
  const r = await pool.query<{
    id: number;
    vendor_id: number;
    vendor_name: string;
    available: boolean;
    rating: number;
    body: string;
    verified: boolean | null;
    hidden: boolean;
    vendor_reply: string | null;
    created_at: Date;
  }>(
    `SELECT r.id, r.vendor_id, v.name AS vendor_name, (v.status = 'approved' AND v.published) AS available,
            r.rating, r.body, r.verified, (r.hidden_at IS NOT NULL) AS hidden, r.vendor_reply, r.created_at
       FROM vendor_reviews r JOIN vendors v ON v.id = r.vendor_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 200`,
    [customerId]
  );
  return r.rows.map((x) => ({
    id: x.id,
    vendorId: x.vendor_id,
    vendorName: x.vendor_name,
    vendorAvailable: x.available,
    rating: x.rating,
    body: x.body,
    verified: !!x.verified,
    hidden: x.hidden,
    vendorReply: x.vendor_reply,
    createdAt: x.created_at.toISOString(),
  }));
}

/**
 * "Rate your vendor": accepted or booked enquiries whose event date has
 * passed (9 #20, so the review can be verified) with no review from this
 * customer for that vendor yet. One prompt per vendor, latest event first.
 */
export async function listReviewPrompts(customerId: number): Promise<ReviewPrompt[]> {
  const r = await pool.query<{
    id: number;
    vendor_id: number;
    vendor_name: string;
    category: string;
    event_date: string;
    event_type_name: string | null;
    status: "accepted" | "booked";
  }>(
    `SELECT DISTINCT ON (q.vendor_id) q.id, q.vendor_id, v.name AS vendor_name, v.category, q.event_date::text AS event_date,
            et.name AS event_type_name, q.status
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id AND v.status = 'approved' AND v.published
       LEFT JOIN event_types et ON et.id = q.event_type_id
      WHERE q.customer_id = $1 AND q.status IN ('accepted','booked')
        AND q.event_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
        AND v.owner_id IS DISTINCT FROM $1
        AND NOT EXISTS (SELECT 1 FROM vendor_reviews r WHERE r.customer_id = $1 AND r.vendor_id = q.vendor_id)
      ORDER BY q.vendor_id, (q.status = 'booked') DESC, q.event_date DESC`,
    [customerId]
  );
  return r.rows
    .map((x) => ({
      enquiryId: x.id,
      vendorId: x.vendor_id,
      vendorName: x.vendor_name,
      category: x.category,
      eventDate: x.event_date,
      eventTypeName: x.event_type_name,
      status: x.status,
    }))
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
}
