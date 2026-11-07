// Vendor insights (PRODUCT_PLAN P2-14, section 9 #28): plain SQL over the
// raw vendor_events rows and the vendor's own quote_requests, for the last
// 7 / 30 / 90 days, with the same-length period before it for comparison.
//
//   views          vendor_events kind = 'profile_view' (deduped per session)
//   whatsappClicks vendor_events kind = 'whatsapp_click'
//   phoneReveals   vendor_events kind = 'phone_reveal'
//   enquiries      quote_requests created in the period
//   booked         of those enquiries, the ones now booked
//   bookedRate     booked / enquiries (null with no enquiries)
//   replied        of those enquiries, the ones that moved past "new"

import { pool } from "@/lib/db";

export const INSIGHT_RANGES = [7, 30, 90] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];

export function parseRange(v: unknown): InsightRange | null {
  if (v === null || v === undefined || v === "") return 30;
  const n = Number(v);
  return (INSIGHT_RANGES as readonly number[]).includes(n) ? (n as InsightRange) : null;
}

export interface InsightCounts {
  views: number;
  whatsappClicks: number;
  phoneReveals: number;
  enquiries: number;
  replied: number;
  booked: number;
  bookedRate: number | null;
}

export interface VendorInsights {
  range: InsightRange;
  current: InsightCounts;
  previous: InsightCounts;
  /** Enquiries in the period by their current status. */
  byStatus: Record<string, number>;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export async function getVendorInsights(vendorId: number, range: InsightRange): Promise<VendorInsights> {
  const [events, quotes, statuses] = await Promise.all([
    pool.query<{ period: "cur" | "prev"; kind: string; n: number }>(
      `SELECT CASE WHEN created_at >= now() - make_interval(days => $2) THEN 'cur' ELSE 'prev' END AS period,
              kind, count(*)::int AS n
         FROM vendor_events
        WHERE vendor_id = $1 AND created_at >= now() - make_interval(days => $2 * 2) AND created_at <= now()
        GROUP BY 1, 2`,
      [vendorId, range]
    ),
    pool.query<{ period: "cur" | "prev"; enquiries: number; replied: number; booked: number }>(
      `SELECT CASE WHEN created_at >= now() - make_interval(days => $2) THEN 'cur' ELSE 'prev' END AS period,
              count(*)::int AS enquiries,
              count(*) FILTER (WHERE status <> 'pending')::int AS replied,
              count(*) FILTER (WHERE status = 'booked')::int AS booked
         FROM quote_requests
        WHERE vendor_id = $1 AND created_at >= now() - make_interval(days => $2 * 2) AND created_at <= now()
        GROUP BY 1`,
      [vendorId, range]
    ),
    pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM quote_requests
        WHERE vendor_id = $1 AND created_at >= now() - make_interval(days => $2) AND created_at <= now()
        GROUP BY status`,
      [vendorId, range]
    ),
  ]);

  const build = (period: "cur" | "prev"): InsightCounts => {
    const ev = (kind: string) => events.rows.find((r) => r.period === period && r.kind === kind)?.n ?? 0;
    const q = quotes.rows.find((r) => r.period === period);
    const enquiries = q?.enquiries ?? 0;
    const booked = q?.booked ?? 0;
    return {
      views: ev("profile_view"),
      whatsappClicks: ev("whatsapp_click"),
      phoneReveals: ev("phone_reveal"),
      enquiries,
      replied: q?.replied ?? 0,
      booked,
      bookedRate: ratio(booked, enquiries),
    };
  };

  return {
    range,
    current: build("cur"),
    previous: build("prev"),
    byStatus: Object.fromEntries(statuses.rows.map((r) => [r.status, r.n])),
  };
}
