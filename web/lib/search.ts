// Search v2 (PRODUCT_PLAN P2-7) and event-type / category browse (P2-8).
//
// Two result views over the same filters:
//   vendors    one row per approved, published vendor
//   offerings  one row per separately sellable unit or package of such a
//              vendor (never package-only units, add-ons or hidden rows)
//
// Ranking ("recommended"): featured -> rank boost -> rating (Bayesian) ->
// profile completeness -> id. Every ORDER BY ends in an id, so paging is
// stable. Districts match the vendor's home district or any district it
// serves (vendor_service_areas) unless homeOnly is set. A date hides vendors
// whose whole day is blocked or full (vendor_availability, PRODUCT_PLAN 9 #22).

import {
  pool,
  buildVendorWhere,
  escapeLike,
  parseSearchQuery,
  PLACE_ALIASES,
  type VendorRecord,
} from "./db";
import { PRICE_UNITS, PRICE_UNIT_LABELS, type PriceUnit } from "./offering-validation";

export type SearchView = "vendors" | "offerings";
export const SEARCH_SORTS = ["recommended", "rating", "reviews", "priceLow", "priceHigh"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface SearchFilters {
  view: SearchView;
  /** Free text ("photographer in Kochi under 50k"); parsed like the legacy search. */
  query?: string;
  /** Category names (vendors view: the vendor's primary category; offerings view: the offering's). */
  categories?: string[];
  /** Legacy: home location text only (API `location`). */
  location?: string;
  /** Home district or a served district. */
  districtId?: number;
  /** With districtId: only vendors based in that district. */
  homeOnly?: boolean;
  minRating?: number;
  /** Legacy: vendor's displayed starting price (vendors.price). */
  maxPrice?: number;
  /** Offering template code, e.g. "candid-photography". */
  offering?: string;
  /** Event type slug, e.g. "nikah". */
  eventType?: string;
  /** YYYY-MM-DD. */
  date?: string;
  budgetMax?: number;
  /** Unit the budget is in; resolved from the offering / category when omitted. */
  priceUnit?: PriceUnit;
  guests?: number;
  verified?: boolean;
  sort: SearchSort;
  limit?: number;
  offset?: number;
}

export type ParseResult =
  | { ok: true; filters: SearchFilters; page: number; pageSize: number | null }
  | { ok: false; field: string; error: string };

/** Today's date in India (YYYY-MM-DD); events are local. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addYears(isoDate: string, years: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const INT_RE = /^\d{1,10}$/;

/**
 * Reads search params. strict (the API): an invalid value is a 400. Not
 * strict (the search page): an invalid value is ignored, so an old or
 * hand-edited link still shows results.
 */
export async function parseSearchParams(
  sp: URLSearchParams,
  opts: { strict: boolean; defaultPageSize?: number | null }
): Promise<ParseResult> {
  const { strict } = opts;
  const bad = (field: string, error: string): ParseResult => ({ ok: false, field, error });
  const get = (k: string) => sp.get(k)?.trim() || undefined;

  const f: SearchFilters = { view: "vendors", sort: "recommended" };

  const view = get("view");
  if (view === "offerings" || view === "vendors") f.view = view;
  else if (view && strict) return bad("view", "view must be vendors or offerings.");

  const q = get("q")?.replace(/\s+/g, " ");
  if (q) f.query = q.slice(0, 200);

  const categories = sp.getAll("category").map((c) => c.trim()).filter(Boolean);
  if (categories.length) f.categories = categories.slice(0, 20);

  const location = get("location");
  if (location) f.location = location.slice(0, 80);

  const district = get("district");
  if (district) {
    const id = await resolveDistrict(district);
    if (id) f.districtId = id;
    else if (strict) return bad("district", "Unknown district.");
  }
  if (sp.get("homeOnly") === "1" || sp.get("homeOnly") === "true") f.homeOnly = true;

  const minRatingRaw = get("minRating");
  if (minRatingRaw) {
    const n = Number(minRatingRaw);
    if (Number.isFinite(n) && n > 0 && n <= 5) f.minRating = n;
    else if (strict) return bad("minRating", "minRating must be between 0 and 5.");
  }

  const maxPriceRaw = get("maxPrice");
  if (maxPriceRaw) {
    const n = Number(maxPriceRaw);
    if (INT_RE.test(maxPriceRaw) && n > 0) f.maxPrice = n;
    else if (strict) return bad("maxPrice", "maxPrice must be a whole number of rupees.");
  }

  const offering = get("offering");
  if (offering) {
    if (/^[a-z0-9][a-z0-9-]{0,59}$/.test(offering)) f.offering = offering;
    else if (strict) return bad("offering", "Unknown offering.");
  }

  const eventType = get("eventType");
  if (eventType) {
    if (/^[a-z0-9][a-z0-9-]{0,59}$/.test(eventType)) f.eventType = eventType;
    else if (strict) return bad("eventType", "Unknown event type.");
  }

  const date = get("date");
  if (date) {
    const today = todayInIndia();
    if (!validDate(date)) {
      if (strict) return bad("date", "date must be a valid YYYY-MM-DD date.");
    } else if (date < today) {
      if (strict) return bad("date", "date cannot be in the past.");
    } else if (date > addYears(today, 3)) {
      if (strict) return bad("date", "date must be within the next 3 years.");
    } else {
      f.date = date;
    }
  }

  const budgetRaw = get("budgetMax");
  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (INT_RE.test(budgetRaw) && n > 0 && n <= 1_000_000_000) f.budgetMax = n;
    else if (strict) return bad("budgetMax", "budgetMax must be a whole number of rupees.");
  }

  const unit = get("priceUnit");
  if (unit) {
    if ((PRICE_UNITS as readonly string[]).includes(unit)) f.priceUnit = unit as PriceUnit;
    else if (strict) return bad("priceUnit", "Unknown price unit.");
  }

  const guestsRaw = get("guests");
  if (guestsRaw) {
    const n = Number(guestsRaw);
    if (INT_RE.test(guestsRaw) && n >= 1 && n <= 100_000) f.guests = n;
    else if (strict) return bad("guests", "guests must be between 1 and 100000.");
  }

  const verified = sp.get("verified");
  if (verified === "1" || verified === "true") f.verified = true;

  const sort = get("sort");
  if (sort && (SEARCH_SORTS as readonly string[]).includes(sort)) f.sort = sort as SearchSort;
  else if (sort && strict) return bad("sort", "Unknown sort.");

  // Paging: limit/offset, or page (+ optional limit as the page size).
  const limitRaw = get("limit");
  let pageSize: number | null = opts.defaultPageSize === undefined ? DEFAULT_PAGE_SIZE : opts.defaultPageSize;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (INT_RE.test(limitRaw) && n >= 1) pageSize = Math.min(n, MAX_PAGE_SIZE);
    else if (strict) return bad("limit", "limit must be a positive whole number.");
  }
  let page = 1;
  const pageRaw = get("page");
  if (pageRaw) {
    const n = Number(pageRaw);
    if (INT_RE.test(pageRaw) && n >= 1 && n <= 10_000) page = n;
    else if (strict) return bad("page", "page must be a positive whole number.");
  }
  if (pageRaw && pageSize === null) pageSize = DEFAULT_PAGE_SIZE;
  const offsetRaw = get("offset");
  if (pageSize !== null) {
    f.limit = pageSize;
    if (offsetRaw && !pageRaw) {
      const n = Number(offsetRaw);
      if (INT_RE.test(offsetRaw)) f.offset = n;
      else if (strict) return bad("offset", "offset must be a whole number.");
      page = Math.floor((f.offset ?? 0) / pageSize) + 1;
    } else {
      f.offset = (page - 1) * pageSize;
    }
  }
  return { ok: true, filters: f, page, pageSize };
}

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------

/** Kerala districts that share a border (for "try nearby" suggestions). */
export const NEARBY_DISTRICTS: Record<string, string[]> = {
  Thiruvananthapuram: ["Kollam", "Pathanamthitta"],
  Kollam: ["Thiruvananthapuram", "Pathanamthitta", "Alappuzha"],
  Pathanamthitta: ["Kollam", "Alappuzha", "Kottayam", "Idukki"],
  Alappuzha: ["Ernakulam", "Kottayam", "Kollam", "Pathanamthitta"],
  Kottayam: ["Ernakulam", "Alappuzha", "Idukki", "Pathanamthitta"],
  Idukki: ["Ernakulam", "Kottayam", "Thrissur", "Pathanamthitta"],
  Ernakulam: ["Thrissur", "Kottayam", "Alappuzha", "Idukki"],
  Thrissur: ["Ernakulam", "Palakkad", "Malappuram", "Idukki"],
  Palakkad: ["Thrissur", "Malappuram"],
  Malappuram: ["Kozhikode", "Thrissur", "Palakkad", "Wayanad"],
  Kozhikode: ["Malappuram", "Kannur", "Wayanad"],
  Wayanad: ["Kozhikode", "Kannur", "Malappuram"],
  Kannur: ["Kozhikode", "Kasaragod", "Wayanad"],
  Kasaragod: ["Kannur"],
};

/**
 * District id from an id ("7"), a district name ("ernakulam"), an old or
 * city name ("Kochi", "Trichur"), or a town a vendor lists as its location
 * ("Guruvayur" -> Thrissur). null when nothing matches.
 */
export async function resolveDistrict(raw: string): Promise<number | null> {
  const s = raw.trim();
  if (!s || s.length > 80) return null;
  if (/^\d{1,9}$/.test(s)) {
    const r = await pool.query<{ id: number }>("SELECT id FROM districts WHERE id = $1", [Number(s)]);
    return r.rows[0]?.id ?? null;
  }
  const lower = s.toLowerCase();
  const names = PLACE_ALIASES[lower] ?? [lower];
  const r = await pool.query<{ id: number }>(
    `SELECT id FROM (
       SELECT id, 0 AS pri FROM districts WHERE state = 'Kerala' AND LOWER(name) = ANY($1::text[])
       UNION ALL
       SELECT district_id, 1 FROM vendors WHERE district_id IS NOT NULL AND LOWER(location) = $2
     ) x ORDER BY pri, id LIMIT 1`,
    [names, lower]
  );
  return r.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

/** Rating sort that doesn't let one 5-star review outrank 189 reviews at 4.9. */
const bayes = (a: string) => `((${a}.rating * ${a}.reviews_count + 5 * 4.5) / (${a}.reviews_count + 5))`;
const featured = (a: string) => `(${a}.featured_until IS NOT NULL AND ${a}.featured_until > now())`;

/** Rough profile completeness: cover, logo, about, experience, photos, offerings. */
const completeness = (a: string) => `(
  (CASE WHEN ${a}.cover_media_id IS NOT NULL OR ${a}.cover_image_url IS NOT NULL THEN 2 ELSE 0 END)
  + (CASE WHEN ${a}.logo_media_id IS NOT NULL OR ${a}.logo_url IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN length(${a}.about) >= 120 THEN 1 ELSE 0 END)
  + (CASE WHEN ${a}.years_experience IS NOT NULL THEN 1 ELSE 0 END)
  + LEAST((SELECT count(*) FROM media_assets m
            WHERE m.vendor_id = ${a}.id AND m.status = 'approved' AND m.purpose = 'gallery'), 6) / 2.0
  + LEAST((SELECT count(*) FROM services cs WHERE cs.vendor_id = ${a}.id AND cs.active), 3)
)`;

/** A unit or package a customer can book on its own (never package-only, add-on or hidden). */
const sellable = (s: string) =>
  `${s}.active AND ${s}.kind IN ('unit','package') AND ${s}.sale_mode = 'separate'
   AND ${s}.hidden_reason IS NULL AND NOT ${s}.incomplete`;

/** A whole day is closed: a blocked/booked/full "full" slot, or both half-day slots closed. */
function dateClause(vendorAlias: string, p: string) {
  const closed = `(va.status IN ('blocked','booked') OR va.capacity_used >= va.capacity_total)`;
  return `NOT EXISTS (SELECT 1 FROM vendor_availability va
                       WHERE va.vendor_id = ${vendorAlias}.id AND va.date = ${p}::date AND va.slot = 'full' AND ${closed})
      AND (SELECT count(*) FROM vendor_availability va
            WHERE va.vendor_id = ${vendorAlias}.id AND va.date = ${p}::date
              AND va.slot IN ('morning','evening') AND ${closed}) < 2`;
}

type Add = (v: unknown) => string;

/** Vendor-level v2 filters on the `vendors` table (both views). */
function vendorV2Clauses(f: SearchFilters, add: Add): string[] {
  const out: string[] = [];
  if (f.districtId) {
    const p = add(f.districtId);
    out.push(
      `(vendors.district_id = ${p}
        OR (vendors.district_id IS NULL AND LOWER(vendors.location) = (SELECT LOWER(name) FROM districts WHERE id = ${p}))
        ${f.homeOnly ? "" : `OR EXISTS (SELECT 1 FROM vendor_service_areas sa WHERE sa.vendor_id = vendors.id AND sa.district_id = ${p})`})`
    );
  }
  if (f.date) out.push(dateClause("vendors", add(f.date)));
  if (f.verified) out.push("vendors.verified_at IS NOT NULL");
  if (f.guests) out.push(`(vendors.max_guests IS NULL OR vendors.max_guests >= ${add(f.guests)})`);
  return out;
}

/** The unit a budget is compared in: explicit, else the offering's or single category's default, else per event. */
async function resolveBudgetUnit(f: SearchFilters): Promise<string> {
  if (f.priceUnit) return f.priceUnit;
  if (f.offering) {
    const r = await pool.query<{ u: string }>(
      "SELECT default_price_unit AS u FROM offering_templates WHERE code = $1 AND active ORDER BY id LIMIT 1",
      [f.offering]
    );
    if (r.rows[0]) return r.rows[0].u;
  }
  if (f.categories?.length === 1) {
    const r = await pool.query<{ u: string }>("SELECT default_price_unit AS u FROM categories WHERE name = $1", [
      f.categories[0],
    ]);
    if (r.rows[0]) return r.rows[0].u;
  }
  return "event";
}

function stripWhere(where: string) {
  return where.replace(/^WHERE\s+/, "");
}

function pageClause(f: SearchFilters, add: Add) {
  if (f.limit === undefined) return "";
  let out = ` LIMIT ${add(Math.min(f.limit, MAX_PAGE_SIZE))}`;
  if (f.offset) out += ` OFFSET ${add(f.offset)}`;
  return out;
}

// ---------------------------------------------------------------------------
// Vendors view
// ---------------------------------------------------------------------------

export type SearchVendor = VendorRecord & { featured: boolean };

async function vendorsQuery(f: SearchFilters, budgetUnit: string | null) {
  // Legacy filters (q, category, location, rating, maxPrice) keep their exact meaning.
  const base = buildVendorWhere({
    query: f.query,
    categories: f.categories,
    location: f.location,
    minRating: f.minRating,
    maxPrice: f.maxPrice,
  });
  const values = base.values;
  const add: Add = (v) => {
    values.push(v);
    return `$${values.length}`;
  };
  const clauses = [stripWhere(base.where), ...vendorV2Clauses(f, add)];

  if (f.eventType) {
    clauses.push(
      `EXISTS (SELECT 1 FROM event_type_categories ec JOIN event_types et ON et.id = ec.event_type_id AND et.active
                WHERE et.slug = ${add(f.eventType)}
                  AND (ec.category_id = vendors.primary_category_id
                       OR EXISTS (SELECT 1 FROM services es WHERE es.vendor_id = vendors.id AND es.category_id = ec.category_id
                                    AND ${sellable("es")})))`
    );
  }
  if (f.offering || f.budgetMax) {
    const conds = [sellable("s")];
    if (f.offering) conds.push(`t.code = ${add(f.offering)}`);
    if (f.budgetMax && budgetUnit) {
      conds.push(`s.price_unit = ${add(budgetUnit)} AND s.price_mode <> 'on_request' AND s.price_from <= ${add(f.budgetMax)}`);
    }
    clauses.push(
      `EXISTS (SELECT 1 FROM services s LEFT JOIN offering_templates t ON t.id = s.template_id
                WHERE s.vendor_id = vendors.id AND ${conds.join(" AND ")})`
    );
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, values, add };
}

export async function searchVendors(f: SearchFilters): Promise<{ vendors: SearchVendor[]; total: number }> {
  const budgetUnit = f.budgetMax ? await resolveBudgetUnit(f) : null;
  const sortMap: Record<SearchSort, string> = {
    recommended: `${featured("vendors")} DESC, vendors.rank_boost DESC, ${bayes("vendors")} DESC, ${completeness("vendors")} DESC, vendors.id`,
    rating: `${bayes("vendors")} DESC, vendors.reviews_count DESC, vendors.id`,
    reviews: "vendors.reviews_count DESC, vendors.rating DESC, vendors.id",
    priceLow: "vendors.price ASC, vendors.id",
    priceHigh: "vendors.price DESC, vendors.id",
  };
  const list = await vendorsQuery(f, budgetUnit);
  const page = pageClause(f, list.add);
  const count = await vendorsQuery(f, budgetUnit);
  const [rows, total] = await Promise.all([
    pool.query<SearchVendor>(
      `SELECT vendors.*, ${featured("vendors")} AS featured FROM vendors ${list.where}
        ORDER BY ${sortMap[f.sort] ?? sortMap.recommended}${page}`,
      list.values
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM vendors ${count.where}`, count.values),
  ]);
  return { vendors: rows.rows, total: total.rows[0]?.n ?? 0 };
}

// ---------------------------------------------------------------------------
// Offerings view
// ---------------------------------------------------------------------------

export interface SearchOffering {
  id: number;
  title: string;
  kind: "unit" | "package";
  category: string;
  categoryDisplay: string;
  templateCode: string | null;
  templateName: string | null;
  priceFrom: number;
  priceTo: number | null;
  priceMode: string;
  priceUnit: string;
  unitLabel: string | null;
  priceLabel: string;
  vendor: {
    id: number;
    name: string;
    location: string;
    district: string | null;
    category: string;
    rating: string;
    reviewsCount: number;
    verified: boolean;
    featured: boolean;
  };
}

interface OfferingRow {
  id: number;
  title: string;
  kind: "unit" | "package";
  category: string;
  category_display: string;
  template_code: string | null;
  template_name: string | null;
  price_from: number;
  price_to: number | null;
  price_mode: string;
  price_unit: string;
  unit_label: string | null;
  vendor_id: number;
  vendor_name: string;
  vendor_location: string;
  vendor_district: string | null;
  vendor_category: string;
  rating: string;
  reviews_count: number;
  verified: boolean;
  featured: boolean;
}

/** Short price for a card: "₹45,000 / event", "From ₹600 / plate", "₹20,000–₹35,000 / day", "Price on request". */
export function shortPrice(o: { priceMode: string; priceFrom: number; priceTo: number | null; priceUnit: string; unitLabel: string | null }) {
  if (o.priceMode === "on_request") return "Price on request";
  const r = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const unit = o.unitLabel || o.priceUnit;
  const amount = o.priceMode === "range" && o.priceTo != null ? `${r(o.priceFrom)}–${r(o.priceTo)}` : r(o.priceFrom);
  return `${o.priceMode === "from" ? "From " : ""}${amount} / ${unit}`;
}

/** "per plate" etc. for a unit code. */
export function unitPhrase(unit: string): string {
  return PRICE_UNIT_LABELS[unit as PriceUnit] ?? `per ${unit}`;
}

async function offeringsQuery(f: SearchFilters, budgetUnit: string | null) {
  // Vendor-level legacy filters run on the vendors table in a sub-select, so
  // their unqualified column names stay unambiguous.
  const base = buildVendorWhere({ location: f.location, minRating: f.minRating });
  const values = base.values;
  const add: Add = (v) => {
    values.push(v);
    return `$${values.length}`;
  };
  const vendorWhere = [stripWhere(base.where), ...vendorV2Clauses(f, add)].join(" AND ");
  const clauses = [sellable("s"), "c.active", `s.vendor_id IN (SELECT vendors.id FROM vendors WHERE ${vendorWhere})`];

  let maxPrice = f.maxPrice;
  const cats = new Set(f.categories ?? []);
  let parsedCats: string[] = [];
  if (f.query) {
    const parsed = parseSearchQuery(f.query);
    parsedCats = parsed.categories;
    if (parsed.maxPrice !== undefined) maxPrice = Math.min(maxPrice ?? Infinity, parsed.maxPrice);
    if (parsed.minRating !== undefined) clauses.push(`v.rating >= ${add(parsed.minRating)}`);
    for (const term of parsed.terms) {
      const alts = PLACE_ALIASES[term] ?? [term];
      const p = add(alts.map((a) => `%${escapeLike(a)}%`));
      clauses.push(
        `(LOWER(s.title) LIKE ANY(${p}::text[]) OR LOWER(COALESCE(t.name, '')) LIKE ANY(${p}::text[])
          OR LOWER(c.name) LIKE ANY(${p}::text[]) OR LOWER(v.name) LIKE ANY(${p}::text[])
          OR LOWER(v.location) LIKE ANY(${p}::text[]) OR LOWER(COALESCE(d.name, '')) LIKE ANY(${p}::text[])
          OR EXISTS (SELECT 1 FROM unnest(v.tags) tg WHERE LOWER(tg) LIKE ANY(${p}::text[])))`
      );
    }
  }
  if (cats.size) clauses.push(`c.name = ANY(${add([...cats])}::text[])`);
  if (parsedCats.length) clauses.push(`c.name = ANY(${add(parsedCats)}::text[])`);
  if (maxPrice !== undefined && Number.isFinite(maxPrice)) {
    clauses.push(`s.price_mode <> 'on_request' AND s.price_from <= ${add(maxPrice)}`);
  }
  if (f.offering) clauses.push(`t.code = ${add(f.offering)}`);
  if (f.budgetMax && budgetUnit) {
    clauses.push(`s.price_unit = ${add(budgetUnit)} AND s.price_mode <> 'on_request' AND s.price_from <= ${add(f.budgetMax)}`);
  }
  if (f.guests) {
    const g = add(f.guests);
    clauses.push(`(s.guest_max IS NULL OR s.guest_max >= ${g}) AND (s.guest_min IS NULL OR s.guest_min <= ${g})`);
  }
  if (f.eventType) {
    const e = add(f.eventType);
    clauses.push(
      `(s.category_id IN (SELECT ec.category_id FROM event_type_categories ec
                            JOIN event_types et ON et.id = ec.event_type_id AND et.active WHERE et.slug = ${e})
        OR EXISTS (SELECT 1 FROM service_event_types se JOIN event_types et2 ON et2.id = se.event_type_id
                    WHERE se.service_id = s.id AND et2.slug = ${e}))`
    );
  }
  const from = `FROM services s
    JOIN vendors v ON v.id = s.vendor_id
    JOIN categories c ON c.id = s.category_id
    LEFT JOIN offering_templates t ON t.id = s.template_id
    LEFT JOIN districts d ON d.id = v.district_id`;
  return { from, where: `WHERE ${clauses.join(" AND ")}`, values, add };
}

export async function searchOfferings(f: SearchFilters): Promise<{ offerings: SearchOffering[]; total: number }> {
  const budgetUnit = f.budgetMax ? await resolveBudgetUnit(f) : null;
  const tail = "v.id, s.sort_order, s.id";
  const sortMap: Record<SearchSort, string> = {
    recommended: `${featured("v")} DESC, v.rank_boost DESC, ${bayes("v")} DESC, ${completeness("v")} DESC, ${tail}`,
    rating: `${bayes("v")} DESC, v.reviews_count DESC, ${tail}`,
    reviews: `v.reviews_count DESC, v.rating DESC, ${tail}`,
    priceLow: "(s.price_mode = 'on_request'), s.price_from ASC, s.id",
    priceHigh: "(s.price_mode = 'on_request'), s.price_from DESC, s.id",
  };
  const list = await offeringsQuery(f, budgetUnit);
  const page = pageClause(f, list.add);
  const count = await offeringsQuery(f, budgetUnit);
  const [rows, total] = await Promise.all([
    pool.query<OfferingRow>(
      `SELECT s.id, s.title, s.kind, c.name AS category, c.display_name AS category_display,
              t.code AS template_code, t.name AS template_name, s.price_from, s.price_to, s.price_mode,
              s.price_unit, s.unit_label, v.id AS vendor_id, v.name AS vendor_name, v.location AS vendor_location,
              d.name AS vendor_district, v.category AS vendor_category, v.rating, v.reviews_count,
              (v.verified_at IS NOT NULL) AS verified, ${featured("v")} AS featured
         ${list.from} ${list.where}
        ORDER BY ${sortMap[f.sort] ?? sortMap.recommended}${page}`,
      list.values
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n ${count.from} ${count.where}`, count.values),
  ]);
  return {
    offerings: rows.rows.map((r) => {
      const o = {
        priceMode: r.price_mode,
        priceFrom: r.price_from,
        priceTo: r.price_to,
        priceUnit: r.price_unit,
        unitLabel: r.unit_label,
      };
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        category: r.category,
        categoryDisplay: r.category_display,
        templateCode: r.template_code,
        templateName: r.template_name,
        ...o,
        priceLabel: shortPrice(o),
        vendor: {
          id: r.vendor_id,
          name: r.vendor_name,
          location: r.vendor_location,
          district: r.vendor_district,
          category: r.vendor_category,
          rating: r.rating,
          reviewsCount: r.reviews_count,
          verified: r.verified,
          featured: r.featured,
        },
      };
    }),
    total: total.rows[0]?.n ?? 0,
  };
}

/** Result count for the same filters in each nearby district (empty-state suggestions). */
export async function nearbyDistrictCounts(
  f: SearchFilters,
  districts: { id: number; name: string }[]
): Promise<{ id: number; name: string; count: number }[]> {
  if (!f.districtId) return [];
  const here = districts.find((d) => d.id === f.districtId);
  if (!here) return [];
  const names = NEARBY_DISTRICTS[here.name] ?? [];
  const near = names.map((n) => districts.find((d) => d.name === n)).filter((d): d is { id: number; name: string } => !!d);
  const counts = await Promise.all(
    near.map(async (d) => {
      const g = { ...f, districtId: d.id, limit: 1, offset: 0 };
      const r = f.view === "offerings" ? await searchOfferings(g) : await searchVendors(g);
      return { ...d, count: r.total };
    })
  );
  return counts;
}

// ---------------------------------------------------------------------------
// Browse pages (/e/[slug], /c/[slug])
// ---------------------------------------------------------------------------

export interface BrowseVendor {
  id: number;
  name: string;
  location: string;
  category: string;
  rating: string;
  reviews_count: number;
  verified: boolean;
  /**
   * The vendor's one "from" price (vendors.price / price_label, kept by
   * recomputeVendorPrice): the same figure search and the profile show (QA-023).
   */
  price?: number | null;
  price_label?: string | null;
  /** Legacy per-card price (shortlist preview); ignored when price_label is set. */
  from_price?: number | null;
  from_unit?: string | null;
  from_unit_label?: string | null;
  // For the card image (app/search/card-media.ts).
  cover_media_id: number | null;
  cover_image_url: string | null;
  status: VendorRecord["status"];
  published: boolean;
}

export interface CategoryVendors {
  categoryId: number;
  total: number;
  vendors: BrowseVendor[];
}

/**
 * Top vendors (recommended order) for each category: vendors whose primary
 * category it is (the same rule as /search?category=, so "See all N" matches).
 */
export async function topVendorsByCategory(categoryIds: number[], perCategory = 3): Promise<Map<number, CategoryVendors>> {
  const out = new Map<number, CategoryVendors>();
  for (const id of categoryIds) out.set(id, { categoryId: id, total: 0, vendors: [] });
  if (categoryIds.length === 0) return out;
  const r = await pool.query<BrowseVendor & { for_category_id: number; total: number }>(
    `WITH m AS (
       SELECT cat.id AS for_category_id, vendors.*,
              ROW_NUMBER() OVER (PARTITION BY cat.id ORDER BY ${featured("vendors")} DESC, vendors.rank_boost DESC,
                                 ${bayes("vendors")} DESC, ${completeness("vendors")} DESC, vendors.id) AS rn,
              count(*) OVER (PARTITION BY cat.id)::int AS total
         FROM categories cat
         JOIN vendors ON vendors.status = 'approved' AND vendors.published
          AND vendors.category = cat.name
        WHERE cat.id = ANY($1::int[])
     )
     SELECT m.for_category_id, m.total, m.id, m.name, m.location, m.category, m.rating, m.reviews_count,
            m.cover_media_id, m.cover_image_url, m.status, m.published,
            (m.verified_at IS NOT NULL) AS verified, m.price, m.price_label
       FROM m
      WHERE m.rn <= $2
      ORDER BY m.for_category_id, m.rn`,
    [categoryIds, perCategory]
  );
  for (const row of r.rows) {
    const entry = out.get(row.for_category_id);
    if (!entry) continue;
    entry.total = row.total;
    entry.vendors.push(row);
  }
  return out;
}

/** Districts with public vendors of this (primary) category based in or serving them. */
export async function categoryDistrictCounts(categoryId: number): Promise<{ name: string; count: number }[]> {
  const r = await pool.query<{ name: string; count: number }>(
    `SELECT d.name, count(DISTINCT v.id)::int AS count
       FROM vendors v
       JOIN districts d ON d.id = v.district_id
             OR d.id IN (SELECT sa.district_id FROM vendor_service_areas sa WHERE sa.vendor_id = v.id)
      WHERE v.status = 'approved' AND v.published
        AND v.category = (SELECT name FROM categories WHERE id = $1)
      GROUP BY d.name ORDER BY count DESC, d.name`,
    [categoryId]
  );
  return r.rows;
}
