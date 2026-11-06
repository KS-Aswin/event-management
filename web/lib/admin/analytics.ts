// Admin analytics (P1-12): read-only aggregate queries for /admin/analytics
// and GET /api/admin/analytics. No mutations here, so no audit rows.
//
// Definitions (also shown on the page):
//  - Day buckets are calendar days in India time (Asia/Kolkata).
//  - Enquiry district = the district the customer gave, else the vendor's district.
//    Enquiry category = the vendor's primary category.
//  - First vendor response = the earliest of: the vendor's first message in the
//    thread, the first quote offer, or the first status change away from
//    "pending" to anything other than withdrawn / expired.
//  - Response rate = enquiries with a first vendor response / all enquiries
//    received in the range (withdrawn ones included).
//  - Supply gap (always the last 90 days) = enquiries ÷ approved, published
//    vendors whose own district and primary category match.

import { pool } from "@/lib/db";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const SUPPLY_GAP_DAYS = 90;
export const TOP_ROWS = 20;
const TZ = "Asia/Kolkata";

export function parseRange(v: unknown): RangeDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

export const LISTING_STATUSES = ["draft", "pending", "changes_requested", "approved", "rejected", "suspended"] as const;

export interface SignupDay {
  day: string; // YYYY-MM-DD (India time)
  customer: number;
  vendor: number;
  admin: number;
}

export interface EnquiryCell {
  district: string;
  category: string;
  eventType: string;
  enquiries: number;
}

export interface SupplyGapRow {
  district: string;
  category: string;
  enquiries: number;
  approvedVendors: number;
  /** enquiries per approved vendor; null when there are no vendors (infinite gap). */
  ratio: number | null;
}

export interface AnalyticsSummary {
  days: RangeDays;
  generatedAt: string;
  signups: { byDay: SignupDay[]; totals: { customer: number; vendor: number; admin: number; all: number } };
  listings: { status: string; count: number }[];
  listingsTotal: number;
  enquiries: { total: number; rows: EnquiryCell[]; more: number };
  response: {
    total: number;
    responded: number;
    /** 0..1, null when there were no enquiries. */
    rate: number | null;
    /** Median minutes from enquiry to first vendor response, null when none responded. */
    medianMinutes: number | null;
  };
  engagement: { profileViews: number; whatsappClicks: number; phoneReveals: number };
  supplyGap: SupplyGapRow[];
}

export async function getAnalytics(days: RangeDays): Promise<AnalyticsSummary> {
  const interval = `${days} days`;
  const [signups, listings, enquiries, response, engagement, gap] = await Promise.all([
    pool.query<{ day: string; customer: number; vendor: number; admin: number }>(
      `WITH d AS (
         SELECT generate_series((now() AT TIME ZONE $2)::date - ($1::int - 1), (now() AT TIME ZONE $2)::date, interval '1 day')::date AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COUNT(u.id) FILTER (WHERE u.role = 'customer')::int AS customer,
              COUNT(u.id) FILTER (WHERE u.role = 'vendor')::int AS vendor,
              COUNT(u.id) FILTER (WHERE u.role::text = 'admin')::int AS admin
         FROM d LEFT JOIN users u ON (u.created_at AT TIME ZONE $2)::date = d.day
        GROUP BY d.day ORDER BY d.day`,
      [days, TZ]
    ),
    pool.query<{ status: string; count: number }>(
      "SELECT status::text AS status, COUNT(*)::int AS count FROM vendors GROUP BY status"
    ),
    pool.query<{ district: string; category: string; event_type: string; enquiries: number; total: number; cells: number }>(
      `WITH e AS (
         SELECT COALESCE(dq.name, dv.name, 'Not given') AS district,
                COALESCE(c.display_name, c.name, NULLIF(v.category, ''), 'Uncategorised') AS category,
                COALESCE(et.name, 'Not given') AS event_type
           FROM quote_requests q
           JOIN vendors v ON v.id = q.vendor_id
           LEFT JOIN districts dq ON dq.id = q.district_id
           LEFT JOIN districts dv ON dv.id = v.district_id
           LEFT JOIN categories c ON c.id = v.primary_category_id
           LEFT JOIN event_types et ON et.id = q.event_type_id
          WHERE q.created_at >= now() - $1::interval
       ), g AS (
         SELECT district, category, event_type, COUNT(*)::int AS enquiries FROM e GROUP BY 1, 2, 3
       )
       SELECT g.*, (SELECT COUNT(*)::int FROM e) AS total, (SELECT COUNT(*)::int FROM g) AS cells
         FROM g ORDER BY enquiries DESC, district, category, event_type LIMIT $2`,
      [interval, TOP_ROWS]
    ),
    pool.query<{ total: number; responded: number; median_minutes: number | null }>(
      `WITH q AS (
         SELECT q.id, q.created_at,
                LEAST(
                  (SELECT min(m.created_at) FROM quote_messages m
                    WHERE m.quote_request_id = q.id AND m.sender_role = 'vendor'),
                  (SELECT min(o.created_at) FROM quote_offers o WHERE o.quote_request_id = q.id),
                  (SELECT min(s.created_at) FROM quote_status_events s
                    WHERE s.quote_id = q.id AND s.from_status = 'pending'
                      AND s.to_status NOT IN ('pending', 'withdrawn', 'expired'))
                ) AS first_response
           FROM quote_requests q
          WHERE q.created_at >= now() - $1::interval
       )
       SELECT COUNT(*)::int AS total,
              COUNT(first_response)::int AS responded,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (first_response - created_at)) / 60.0
              ) FILTER (WHERE first_response IS NOT NULL) AS median_minutes
         FROM q`,
      [interval]
    ),
    pool.query<{ views: number; wa: number; phone: number }>(
      `SELECT COUNT(*) FILTER (WHERE kind = 'profile_view')::int AS views,
              COUNT(*) FILTER (WHERE kind = 'whatsapp_click')::int AS wa,
              COUNT(*) FILTER (WHERE kind = 'phone_reveal')::int AS phone
         FROM vendor_events WHERE created_at >= now() - $1::interval`,
      [interval]
    ),
    pool.query<{ district: string; category: string; enquiries: number; approved_vendors: number }>(
      `WITH e AS (
         SELECT COALESCE(q.district_id, v.district_id) AS district_id, v.primary_category_id AS category_id, COUNT(*)::int AS enquiries
           FROM quote_requests q JOIN vendors v ON v.id = q.vendor_id
          WHERE q.created_at >= now() - $1::interval
            AND COALESCE(q.district_id, v.district_id) IS NOT NULL AND v.primary_category_id IS NOT NULL
          GROUP BY 1, 2
       ), s AS (
         SELECT district_id, primary_category_id AS category_id, COUNT(*)::int AS n
           FROM vendors WHERE status = 'approved' AND published
            AND district_id IS NOT NULL AND primary_category_id IS NOT NULL
          GROUP BY 1, 2
       )
       SELECT d.name AS district, COALESCE(c.display_name, c.name) AS category,
              e.enquiries, COALESCE(s.n, 0)::int AS approved_vendors
         FROM e
         JOIN districts d ON d.id = e.district_id
         JOIN categories c ON c.id = e.category_id
         LEFT JOIN s ON s.district_id = e.district_id AND s.category_id = e.category_id
        ORDER BY (COALESCE(s.n, 0) = 0) DESC, e.enquiries::numeric / NULLIF(s.n, 0) DESC NULLS LAST,
                 e.enquiries DESC, d.name, 2
        LIMIT $2`,
      [`${SUPPLY_GAP_DAYS} days`, TOP_ROWS]
    ),
  ]);

  const byDay = signups.rows.map((r) => ({ day: r.day, customer: r.customer, vendor: r.vendor, admin: r.admin }));
  const totals = byDay.reduce(
    (t, r) => ({
      customer: t.customer + r.customer,
      vendor: t.vendor + r.vendor,
      admin: t.admin + r.admin,
      all: t.all + r.customer + r.vendor + r.admin,
    }),
    { customer: 0, vendor: 0, admin: 0, all: 0 }
  );

  const statusCounts = new Map(listings.rows.map((r) => [r.status, r.count]));
  const listingRows = [
    ...LISTING_STATUSES.map((s) => ({ status: s as string, count: statusCounts.get(s) ?? 0 })),
    ...listings.rows.filter((r) => !(LISTING_STATUSES as readonly string[]).includes(r.status)),
  ];

  const enqTotal = enquiries.rows[0]?.total ?? 0;
  const cells = enquiries.rows[0]?.cells ?? 0;
  const r = response.rows[0] ?? { total: 0, responded: 0, median_minutes: null };
  const e = engagement.rows[0] ?? { views: 0, wa: 0, phone: 0 };

  return {
    days,
    generatedAt: new Date().toISOString(),
    signups: { byDay, totals },
    listings: listingRows,
    listingsTotal: listingRows.reduce((n, x) => n + x.count, 0),
    enquiries: {
      total: enqTotal,
      rows: enquiries.rows.map((x) => ({ district: x.district, category: x.category, eventType: x.event_type, enquiries: x.enquiries })),
      more: Math.max(0, cells - enquiries.rows.length),
    },
    response: {
      total: r.total,
      responded: r.responded,
      rate: r.total > 0 ? r.responded / r.total : null,
      medianMinutes: r.median_minutes == null ? null : Math.round(Number(r.median_minutes)),
    },
    engagement: { profileViews: e.views, whatsappClicks: e.wa, phoneReveals: e.phone },
    supplyGap: gap.rows.map((g) => ({
      district: g.district,
      category: g.category,
      enquiries: g.enquiries,
      approvedVendors: g.approved_vendors,
      ratio: g.approved_vendors > 0 ? Math.round((g.enquiries / g.approved_vendors) * 10) / 10 : null,
    })),
  };
}
