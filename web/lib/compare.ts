// Compare view data (PRODUCT_PLAN P2-10, /my/compare?ids=): 2-4 public
// vendors side by side. Only approved, published vendors are returned.

import { pool } from "@/lib/db";

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

/** Fewest replies before a median response time is shown. */
const MIN_RESPONSE_SAMPLES = 3;

export interface AttributeField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

export interface CompareVendor {
  id: number;
  name: string;
  category: string;
  categoryId: number | null;
  location: string;
  rating: number;
  reviewsCount: number;
  verified: boolean;
  yearsExperience: number | null;
  teamSize: number | null;
  maxGuests: number | null;
  languages: string[];
  fromPrice: number | null;
  fromUnit: string | null;
  offeringCount: number;
  /** Median minutes to the first vendor reply (last 180 days), null when too few. */
  responseMinutes: number | null;
  attributes: Record<string, unknown>;
  coverMediaId: number | null;
  coverImageUrl: string | null;
}

/** "1,2,3" -> distinct positive ids, or an error message. */
export function parseCompareIds(raw: string | string[] | undefined): { ok: true; ids: number[] } | { ok: false; error: string } {
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const ids: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,10}$/.test(p) || Number(p) < 1 || Number(p) > 2147483647) return { ok: false, error: "That compare link isn't valid." };
    if (!ids.includes(Number(p))) ids.push(Number(p));
  }
  if (ids.length < COMPARE_MIN) return { ok: false, error: `Choose at least ${COMPARE_MIN} vendors to compare.` };
  if (ids.length > COMPARE_MAX) return { ok: false, error: `You can compare up to ${COMPARE_MAX} vendors at a time.` };
  return { ok: true, ids };
}

export async function findCompareVendors(ids: number[]): Promise<CompareVendor[]> {
  if (ids.length === 0) return [];
  const r = await pool.query<{
    id: number;
    name: string;
    category: string;
    category_id: number | null;
    location: string;
    rating: string;
    reviews_count: number;
    verified: boolean;
    years_experience: number | null;
    year_established: number | null;
    team_size: number | null;
    max_guests: number | null;
    languages: string[] | null;
    attributes: Record<string, unknown> | null;
    from_price: number | null;
    from_unit: string | null;
    offering_count: number;
    response_minutes: number | null;
    samples: number;
    cover_media_id: number | null;
    cover_image_url: string | null;
  }>(
    `SELECT v.id, v.name, v.category, COALESCE(v.primary_category_id, c.id) AS category_id, v.location, v.rating, v.reviews_count,
            (v.verified_at IS NOT NULL) AS verified, v.years_experience, v.year_established, v.team_size, v.max_guests,
            v.languages, v.attributes, p.price_from AS from_price, COALESCE(p.unit_label, p.price_unit) AS from_unit,
            (SELECT count(*)::int FROM services s WHERE s.vendor_id = v.id AND s.active AND s.kind IN ('unit','package')
                AND s.sale_mode = 'separate' AND s.hidden_reason IS NULL AND NOT s.incomplete) AS offering_count,
            rt.minutes AS response_minutes, rt.samples, v.cover_media_id, v.cover_image_url
       FROM vendors v
       LEFT JOIN categories c ON c.name = v.category
       LEFT JOIN LATERAL (
         SELECT s.price_from, s.price_unit, s.unit_label FROM services s
          WHERE s.vendor_id = v.id AND s.active AND s.kind IN ('unit','package') AND s.sale_mode = 'separate'
            AND s.hidden_reason IS NULL AND NOT s.incomplete AND s.price_mode <> 'on_request' AND s.price_from > 0
          ORDER BY s.price_from, s.id LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.mins)::int AS minutes, count(*)::int AS samples
           FROM (
             SELECT EXTRACT(EPOCH FROM (LEAST(
                      (SELECT min(m.created_at) FROM quote_messages m WHERE m.quote_request_id = q.id AND m.sender_role = 'vendor'),
                      (SELECT min(o.created_at) FROM quote_offers o WHERE o.quote_request_id = q.id),
                      (SELECT min(e.created_at) FROM quote_status_events e
                        WHERE e.quote_id = q.id AND e.from_status = 'pending' AND e.to_status IN ('responded','declined'))
                    ) - q.created_at)) / 60 AS mins
               FROM quote_requests q
              WHERE q.vendor_id = v.id AND q.created_at > now() - interval '180 days'
           ) x
          WHERE x.mins IS NOT NULL AND x.mins >= 0
       ) rt ON true
      WHERE v.id = ANY($1::int[]) AND v.status = 'approved' AND v.published`,
    [ids]
  );
  const thisYear = new Date().getFullYear();
  const byId = new Map(
    r.rows.map((x) => [
      x.id,
      {
        id: x.id,
        name: x.name,
        category: x.category,
        categoryId: x.category_id,
        location: x.location,
        rating: Number(x.rating) || 0,
        reviewsCount: x.reviews_count ?? 0,
        verified: x.verified,
        yearsExperience:
          x.years_experience ?? (x.year_established && x.year_established <= thisYear ? thisYear - x.year_established : null),
        teamSize: x.team_size,
        maxGuests: x.max_guests,
        languages: x.languages ?? [],
        fromPrice: x.from_price,
        fromUnit: x.from_unit,
        offeringCount: x.offering_count,
        responseMinutes: x.samples >= MIN_RESPONSE_SAMPLES ? x.response_minutes : null,
        attributes: x.attributes ?? {},
        coverMediaId: x.cover_media_id,
        coverImageUrl: x.cover_image_url,
      } satisfies CompareVendor,
    ])
  );
  // Keep the order the customer picked.
  return ids.map((id) => byId.get(id)).filter((v): v is CompareVendor => !!v);
}

/** The attribute schema of a category, for the "key attributes" rows. */
export async function categoryAttributeFields(categoryId: number): Promise<AttributeField[]> {
  const r = await pool.query<{ attribute_schema: unknown }>("SELECT attribute_schema FROM categories WHERE id = $1", [categoryId]);
  const schema = r.rows[0]?.attribute_schema;
  if (!Array.isArray(schema)) return [];
  return schema
    .filter((f): f is AttributeField => !!f && typeof f === "object" && typeof f.key === "string" && typeof f.label === "string")
    .map((f) => ({ key: f.key, label: f.label, type: String(f.type ?? "text"), options: Array.isArray(f.options) ? f.options : undefined }));
}

/** "Usually replies within 2 hours" style label. */
export function responseLabel(minutes: number | null): string {
  if (minutes === null) return "Not enough replies yet";
  if (minutes < 60) return "Within an hour";
  const h = Math.round(minutes / 60);
  if (h < 24) return `Within ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `Within ${d} day${d === 1 ? "" : "s"}`;
}

/** Human value for one attribute; null = not given. */
export function attributeValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-IN");
  if (Array.isArray(v)) {
    const parts = v.filter((x) => x !== null && x !== undefined && x !== "").map((x) => String(x).replace(/[-_]/g, " "));
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object") return null;
  return String(v);
}
