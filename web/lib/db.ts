import { Pool, type PoolClient } from "pg";
import {
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  formatVendorPriceLabel,
  normaliseCustomName,
  parseAttributeSchema,
  type AttributeField,
  type OfferingRules,
  type ParsedOfferingFields,
} from "./offering-validation";

// Reuse a single pool across hot reloads in dev (Next.js re-evaluates
// modules on every request in dev mode without this guard, which would
// otherwise leak a new connection pool per request).
declare global {
  // eslint-disable-next-line no-var
  var _velaPgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  const p = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast when the database is unreachable instead of hanging requests.
    connectionTimeoutMillis: 5_000,
  });
  // An idle client losing its connection (DB restart, network blip) emits
  // 'error' on the pool; without a listener Node would crash the server.
  p.on("error", (err) => {
    console.error("pg pool idle client error", err);
  });
  return p;
}

export const pool = global._velaPgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global._velaPgPool = pool;
}

export type UserRole = "customer" | "vendor" | "admin";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  email_notifications: boolean;
  sms_notifications: boolean;
  created_at: string;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [email.toLowerCase().trim()]
  );
  return result.rows[0] ?? null;
}

export async function createUser(params: {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.name, params.email.toLowerCase().trim(), params.passwordHash, params.role]
  );
  return result.rows[0];
}

export async function findUserById(id: number): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT * FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateUser(
  id: number,
  fields: { name?: string; email?: string; emailNotifications?: boolean; smsNotifications?: boolean }
): Promise<UserRecord | null> {
  // Emails are stored lowercased (login looks them up lowercased too), so a
  // mixed-case change can never lock the user out.
  const email = fields.email ? fields.email.trim().toLowerCase() : null;
  const result = await pool.query<UserRecord>(
    `UPDATE users SET
       name = COALESCE($2, name),
       email = COALESCE($3, email),
       email_notifications = COALESCE($4, email_notifications),
       sms_notifications = COALESCE($5, sms_notifications)
     WHERE id = $1
     RETURNING *`,
    [id, fields.name ?? null, email, fields.emailNotifications ?? null, fields.smsNotifications ?? null]
  );
  // null when the user row no longer exists (e.g. a stale cookie).
  return result.rows[0] ?? null;
}

export interface VendorRecord {
  id: number;
  owner_id: number | null;
  name: string;
  category: string;
  location: string;
  price: number;
  price_label: string;
  rating: string; // numeric comes back as string from pg
  reviews_count: number;
  experience: string;
  tags: string[];
  about: string;
  created_at: string;
  // Profile fields added in migration 002.
  vendor_type: "company" | "individual";
  district_id: number | null;
  phone: string | null;
  whatsapp: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  status: VendorStatus;
  published?: boolean;
  // Migration 004 (vendor workspace). Optional so older call sites and test
  // fixtures that build a VendorRecord by hand keep compiling.
  primary_category_id?: number | null;
  legal_name?: string | null;
  year_established?: number | null;
  years_experience?: number | null;
  team_size?: number | null;
  languages?: string[];
  address_line?: string | null;
  landmark?: string | null;
  pincode?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  website_url?: string | null;
  gstin?: string | null;
  fssai_no?: string | null;
  travel_outside_kerala?: boolean;
  max_events_per_day?: number;
  max_guests?: number | null;
  attributes?: Record<string, unknown>;
  onboarding_step?: number;
  onboarding_completed_at?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  status_reason?: string | null;
  verified_at?: string | null;
  founding_vendor?: boolean;
  logo_media_id?: number | null;
  cover_media_id?: number | null;
  rereview_required?: boolean;
  rereview_fields?: string[];
  rereview_requested_at?: string | null;
  updated_at?: string;
}

export const VENDOR_STATUSES = ["draft", "pending", "changes_requested", "approved", "rejected", "suspended"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export interface VendorFilters {
  query?: string;
  categories?: string[];
  location?: string;
  minRating?: number;
  sort?: "rating" | "reviews" | "priceLow" | "priceHigh";
  // Optional additions (all backward compatible):
  /** Only vendors whose starting price is at most this many rupees. */
  maxPrice?: number;
  /** Only vendors in this district (falls back to location text when district_id is null). */
  districtId?: number;
  /** Page size; omit for all rows. */
  limit?: number;
  offset?: number;
}

/** Where a vendor is publicly visible: approved by the team and published by the vendor. */
const PUBLIC_VENDOR = "status = 'approved' AND published";

/** Rating sort that doesn't let one 5-star review outrank 189 reviews at 4.9. */
const BAYESIAN_RATING = "((rating * reviews_count + 5 * 4.5) / (reviews_count + 5))";

/** Escape LIKE wildcards (Postgres' default LIKE escape character is backslash). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// --- Natural-language search parsing ----------------------------------------

const SEARCH_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "in", "at", "near", "nearby", "around", "for", "of", "to", "from",
  "with", "on", "me", "my", "under", "below", "above", "within", "upto", "rating", "rated", "star",
  "stars", "plus", "guests", "guest", "people", "pax", "persons", "available", "availability",
  "best", "top", "good", "cheap", "affordable", "budget", "service", "services", "vendor", "vendors",
  "artist", "artists", "event", "events", "kerala", "rs", "inr", "today", "tomorrow", "weekend",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
  "nov", "dec", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Occasions: every vendor serves these, so they are not a filter.
  "wedding", "weddings", "marriage", "reception", "engagement", "party", "parties", "birthday",
  "function", "functions", "ceremony", "celebration", "haldi", "sangeet", "nikah", "baptism",
]);

const CATEGORY_SYNONYMS: Record<string, string> = {
  photo: "Photography", photos: "Photography", photography: "Photography",
  photographer: "Photography", photographers: "Photography", photoshoot: "Photography",
  video: "Videography", videos: "Videography", videography: "Videography",
  videographer: "Videography", videographers: "Videography",
  caterer: "Catering", caterers: "Catering", catering: "Catering", cater: "Catering", food: "Catering",
  decor: "Decoration", decoration: "Decoration", decorations: "Decoration", decorator: "Decoration",
  decorators: "Decoration", florist: "Decoration", flowers: "Decoration", floral: "Decoration",
  venue: "Venue", venues: "Venue", hall: "Venue", halls: "Venue", auditorium: "Venue",
  auditoriums: "Venue", banquet: "Venue",
  dj: "DJ & Music", djs: "DJ & Music", music: "DJ & Music", band: "DJ & Music", bands: "DJ & Music",
  musician: "DJ & Music", musicians: "DJ & Music",
  makeup: "Makeup", bridal: "Makeup", beautician: "Makeup", mua: "Makeup", makeover: "Makeup",
  mehndi: "Mehendi", mehendi: "Mehendi", mehandi: "Mehendi", henna: "Mehendi",
  sound: "Sound & Lighting", lighting: "Sound & Lighting", lights: "Sound & Lighting",
  rental: "Rental", rentals: "Rental",
  planner: "Event Management", planners: "Event Management", planning: "Event Management",
  management: "Event Management", organiser: "Event Management", organizer: "Event Management",
  organisers: "Event Management", organizers: "Event Management", coordinator: "Event Management",
  host: "Event Host", hosts: "Event Host", anchor: "Event Host", anchors: "Event Host", emcee: "Event Host",
};

/** City names and old spellings that should also match the district they're in. */
const PLACE_ALIASES: Record<string, string[]> = {
  kochi: ["kochi", "ernakulam"],
  cochin: ["kochi", "ernakulam"],
  ernakulam: ["ernakulam", "kochi"],
  trivandrum: ["trivandrum", "thiruvananthapuram"],
  calicut: ["calicut", "kozhikode"],
  alleppey: ["alleppey", "alappuzha"],
  trichur: ["trichur", "thrissur"],
  quilon: ["quilon", "kollam"],
  palghat: ["palghat", "palakkad"],
  cannanore: ["cannanore", "kannur"],
};

export interface ParsedSearch {
  /** Categories implied by words like "photographer" or "caterer" (ORed). */
  categories: string[];
  /** Remaining words; each must match name, category, location, district or a tag. */
  terms: string[];
  maxPrice?: number;
  minRating?: number;
}

/**
 * Splits a free-text query such as "Photographer in Kochi under ₹50,000" into
 * a category, a price ceiling, a minimum rating and the leftover words.
 * Exported so the search page can show the parsed parts as chips.
 */
export function parseSearchQuery(raw: string): ParsedSearch {
  let q = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  const out: ParsedSearch = { categories: [], terms: [] };

  const price = q.match(
    /(?:under|below|less than|within|upto|up to|max(?:imum)?|budget(?: of)?|<)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|l|lakhs?|lacs?)?(?![a-z])/
  );
  if (price) {
    const base = parseFloat(price[1].replace(/,/g, ""));
    const unit = price[2] ?? "";
    const mult = unit === "k" || unit === "thousand" ? 1_000 : unit ? 100_000 : 1;
    const value = Math.round(base * mult);
    if (Number.isFinite(value) && value > 0) out.maxPrice = value;
    q = q.replace(price[0], " ");
  }

  const rating = q.match(
    /(\d(?:\.\d)?)\s*\+?\s*(?:stars?|★|rating|rated)|(?:rating|rated)\s*(?:of\s*|above\s*)?(\d(?:\.\d)?)\s*\+?|(\d(?:\.\d)?)\s*\+/
  );
  if (rating) {
    const value = parseFloat(rating[1] ?? rating[2] ?? rating[3]);
    if (value >= 1 && value <= 5) out.minRating = value;
    q = q.replace(rating[0], " ");
  }

  // Guest counts ("for 600 guests") have no column to filter on yet.
  q = q.replace(/\d+\s*(?:guests?|people|pax|persons?)/g, " ");

  const tokens = q
    .replace(/&/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const cats = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];
    if (t === "make" && tokens[i + 1] === "up") {
      cats.add("Makeup");
      i++;
      continue;
    }
    if (SEARCH_STOPWORDS.has(t) || /^\d+(?:st|nd|rd|th)?$/.test(t)) continue;
    const cat = CATEGORY_SYNONYMS[t] ?? (t.endsWith("s") ? CATEGORY_SYNONYMS[t.slice(0, -1)] : undefined);
    if (cat) {
      cats.add(cat);
      continue;
    }
    if (t.length > 40) t = t.slice(0, 40);
    if (!out.terms.includes(t)) out.terms.push(t);
  }
  out.categories = Array.from(cats);
  out.terms = out.terms.slice(0, 8);
  return out;
}

function buildVendorWhere(filters: VendorFilters): { where: string; values: unknown[] } {
  const clauses: string[] = [PUBLIC_VENDOR];
  const values: unknown[] = [];
  const add = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };

  let minRating = filters.minRating;
  let maxPrice = filters.maxPrice;

  const query = filters.query?.trim().replace(/\s+/g, " ");
  if (query) {
    const parsed = parseSearchQuery(query);
    if (parsed.categories.length > 0) {
      clauses.push(`category = ANY(${add(parsed.categories)}::text[])`);
    }
    if (parsed.minRating !== undefined) minRating = Math.max(minRating ?? 0, parsed.minRating);
    if (parsed.maxPrice !== undefined) maxPrice = Math.min(maxPrice ?? Infinity, parsed.maxPrice);
    for (const term of parsed.terms) {
      const alts = PLACE_ALIASES[term] ?? [term];
      const p = add(alts.map((a) => `%${escapeLike(a)}%`));
      clauses.push(
        `(LOWER(name) LIKE ANY(${p}::text[]) OR LOWER(category) LIKE ANY(${p}::text[])
          OR LOWER(location) LIKE ANY(${p}::text[])
          OR EXISTS (SELECT 1 FROM districts d WHERE d.id = vendors.district_id AND LOWER(d.name) LIKE ANY(${p}::text[]))
          OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE ANY(${p}::text[])))`
      );
    }
  }
  if (filters.categories && filters.categories.length > 0) {
    clauses.push(`category = ANY(${add(filters.categories)}::text[])`);
  }
  if (filters.location?.trim()) {
    // Case-insensitive, and choosing a district (e.g. Ernakulam) also finds
    // vendors whose location is a town in it (e.g. Kochi).
    const loc = filters.location.trim().toLowerCase();
    const p = add(PLACE_ALIASES[loc] ?? [loc]);
    clauses.push(
      `(LOWER(location) = ANY(${p}::text[])
        OR district_id IN (SELECT id FROM districts WHERE LOWER(name) = ANY(${p}::text[])))`
    );
  }
  if (filters.districtId) {
    const p = add(filters.districtId);
    clauses.push(
      `(district_id = ${p} OR (district_id IS NULL AND LOWER(location) = (SELECT LOWER(name) FROM districts WHERE id = ${p})))`
    );
  }
  if (minRating) {
    clauses.push(`rating >= ${add(minRating)}`);
  }
  if (maxPrice !== undefined && Number.isFinite(maxPrice)) {
    clauses.push(`price <= ${add(maxPrice)}`);
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, values };
}

/** Public search. Only approved, published vendors are returned. */
export async function findVendors(filters: VendorFilters): Promise<VendorRecord[]> {
  const { where, values } = buildVendorWhere(filters);

  const sortMap: Record<string, string> = {
    rating: `${BAYESIAN_RATING} DESC, reviews_count DESC, id`,
    reviews: "reviews_count DESC, rating DESC, id",
    priceLow: "price ASC, id",
    priceHigh: "price DESC, id",
  };
  const orderBy = sortMap[filters.sort ?? "rating"] ?? sortMap.rating;

  let page = "";
  if (filters.limit !== undefined && Number.isInteger(filters.limit) && filters.limit > 0) {
    values.push(Math.min(filters.limit, 200));
    page += ` LIMIT $${values.length}`;
    if (filters.offset && Number.isInteger(filters.offset) && filters.offset > 0) {
      values.push(filters.offset);
      page += ` OFFSET $${values.length}`;
    }
  }

  const result = await pool.query<VendorRecord>(
    `SELECT * FROM vendors ${where} ORDER BY ${orderBy}${page}`,
    values
  );
  return result.rows;
}

/** Total number of vendors matching the same filters as findVendors (ignores limit/offset). */
export async function countVendors(filters: VendorFilters): Promise<number> {
  const { where, values } = buildVendorWhere(filters);
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM vendors ${where}`,
    values
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Looks up a vendor by id. By default it returns the row whatever its status
 * (the profile page decides visibility itself). With `publicOnly`, an
 * unapproved or unpublished vendor is returned only to its owner (`viewerId`).
 */
export async function findVendorById(
  id: number,
  opts: { publicOnly?: boolean; viewerId?: number | null } = {}
): Promise<VendorRecord | null> {
  const result = await pool.query<VendorRecord>(
    "SELECT * FROM vendors WHERE id = $1 LIMIT 1",
    [id]
  );
  const vendor = result.rows[0] ?? null;
  if (vendor && opts.publicOnly) {
    const isPublic = vendor.status === "approved" && vendor.published !== false;
    const isOwner = opts.viewerId != null && vendor.owner_id === opts.viewerId;
    if (!isPublic && !isOwner) return null;
  }
  return vendor;
}

/**
 * Columns safe to show anyone: no owner_id, published flag, seed baseline or
 * contact numbers. (status is kept: public vendors are always 'approved'.)
 */
export const PUBLIC_VENDOR_FIELDS = [
  "id", "name", "category", "location", "price", "price_label", "rating", "reviews_count",
  "experience", "tags", "about", "vendor_type", "district_id", "logo_url", "cover_image_url",
  "status", "created_at",
  // Migration 004: public business details (no contact numbers, GSTIN or address).
  "primary_category_id", "years_experience", "year_established", "team_size", "languages",
  "max_guests", "max_events_per_day", "travel_outside_kerala", "instagram_url", "youtube_url",
  "website_url", "verified_at", "founding_vendor",
] as const;

export function toPublicVendor(v: VendorRecord): Partial<VendorRecord> {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_VENDOR_FIELDS) out[k] = (v as unknown as Record<string, unknown>)[k];
  return out as Partial<VendorRecord>;
}

export async function findAllLocations(): Promise<string[]> {
  const result = await pool.query<{ location: string }>(
    `SELECT DISTINCT location FROM vendors WHERE ${PUBLIC_VENDOR} ORDER BY location`
  );
  return result.rows.map((r) => r.location);
}

export interface ReviewRecord {
  id: number;
  vendor_id: number;
  customer_id: number | null;
  reviewer_name: string;
  rating: number;
  body: string;
  created_at: string;
  /** True when the reviewer had sent this vendor an enquiry (migration 003). */
  verified?: boolean;
}

export async function findReviewsByVendor(
  vendorId: number,
  opts: { limit?: number; offset?: number } = {}
): Promise<ReviewRecord[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 100);
  const offset = Math.max(0, opts.offset ?? 0);
  const result = await pool.query<ReviewRecord>(
    "SELECT * FROM vendor_reviews WHERE vendor_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
    [vendorId, limit, offset]
  );
  return result.rows;
}

export async function createQuoteRequest(params: {
  vendorId: number;
  customerId: number | null;
  name: string;
  phone: string;
  eventDate: string | null;
  budget: string | null;
  message: string | null;
  // Optional: the specific services of this vendor the customer wants.
  // Ids that don't belong to this vendor are ignored here as a safety net
  // (the API route rejects them with a 400 before getting this far).
  serviceIds?: number[];
}) {
  const serviceIds = params.serviceIds ?? [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, budget, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [params.vendorId, params.customerId, params.name, params.phone, params.eventDate, params.budget, params.message]
    );
    const quote = result.rows[0];
    if (serviceIds.length > 0) {
      // Stores a snapshot (title/price/unit) of each requested unit (migration 004).
      await addLeadUnits(quote.id, params.vendorId, [...new Set(serviceIds)].map((serviceId) => ({ serviceId })), client);
    }
    await client.query("COMMIT");
    return quote;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findVendorByOwner(ownerId: number): Promise<VendorRecord | null> {
  const result = await pool.query<VendorRecord>(
    "SELECT * FROM vendors WHERE owner_id = $1 ORDER BY id LIMIT 1",
    [ownerId]
  );
  return result.rows[0] ?? null;
}

/** Map a location's text to a Kerala district id, using common city aliases (Kochi -> Ernakulam). */
async function districtIdForLocation(location: string): Promise<number | null> {
  const loc = location.trim().toLowerCase();
  const names = PLACE_ALIASES[loc] ?? [loc];
  const result = await pool.query<{ id: number }>(
    "SELECT id FROM districts WHERE LOWER(name) = ANY($1::text[]) ORDER BY id LIMIT 1",
    [names]
  );
  return result.rows[0]?.id ?? null;
}

export async function districtExists(id: number): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM districts WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Creates a vendor's listing. Returns null when this owner already has a
 * listing (enforced by the vendors_owner_unique index from migration 003, so
 * two concurrent requests can't both succeed).
 */
export async function createVendorListing(params: {
  ownerId: number;
  name: string;
  category: string;
  location: string;
  price: number;
  priceLabel: string;
  experience: string;
  tags: string[];
  about: string;
  /** Optional; when omitted it is derived from the location text where possible. */
  districtId?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
}): Promise<VendorRecord | null> {
  const districtId = params.districtId ?? (await districtIdForLocation(params.location));
  // The vendor and its first service are created together in one statement
  // (a data-modifying CTE), so a listing never exists without a service.
  try {
    const result = await pool.query<VendorRecord>(
      `WITH new_vendor AS (
         INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, tags, about, rating, reviews_count, district_id, phone, whatsapp,
                              status, primary_category_id, onboarding_step, onboarding_completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,$11,$12,
                 -- Legacy one-form listing: live at once, as before migration 004
                 -- (whose default is 'draft'). The onboarding wizard uses
                 -- createDraftListing instead.
                 'approved', (SELECT id FROM categories WHERE name = $3), 6, now())
         RETURNING *
       ), new_service AS (
         INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit)
         SELECT nv.id, c.id, nv.category, nv.about, nv.price, 'event'
         FROM new_vendor nv
         JOIN categories c ON c.name = nv.category
       )
       SELECT * FROM new_vendor`,
      [
        params.ownerId,
        params.name,
        params.category,
        params.location,
        params.price,
        params.priceLabel,
        params.experience,
        params.tags,
        params.about,
        districtId,
        params.phone ?? null,
        params.whatsapp ?? null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "23505";
}

export interface QuoteRequestWithVendor {
  id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_category: string;
  name: string;
  phone: string;
  event_date: string | null;
  budget: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

export async function findQuoteRequestsByCustomer(customerId: number): Promise<QuoteRequestWithVendor[]> {
  const result = await pool.query<QuoteRequestWithVendor>(
    `SELECT q.id, q.vendor_id, v.name AS vendor_name, v.category AS vendor_category,
            q.name, q.phone, q.event_date, q.budget, q.message, q.status, q.created_at
     FROM quote_requests q
     JOIN vendors v ON v.id = q.vendor_id
     WHERE q.customer_id = $1
     ORDER BY q.created_at DESC`,
    [customerId]
  );
  return result.rows;
}

export interface LeadRecord {
  id: number;
  name: string;
  phone: string;
  event_date: string | null;
  budget: string | null;
  message: string | null;
  status: string;
  created_at: string;
  // Titles of the services the customer asked for (empty = general enquiry).
  // Optional because updateQuoteStatus's RETURNING doesn't include it.
  services?: string[];
}

export async function findQuoteRequestsByVendor(vendorId: number): Promise<LeadRecord[]> {
  const result = await pool.query<LeadRecord>(
    `SELECT q.id, q.name, q.phone, q.event_date, q.budget, q.message, q.status, q.created_at,
            COALESCE(
              (SELECT array_agg(s.title ORDER BY s.title)
               FROM quote_request_services qs
               JOIN services s ON s.id = qs.service_id
               WHERE qs.quote_request_id = q.id),
              '{}'
            ) AS services
     FROM quote_requests q
     WHERE q.vendor_id = $1
     ORDER BY q.created_at DESC`,
    [vendorId]
  );
  return result.rows;
}

export async function updateVendorListing(
  vendorId: number,
  ownerId: number,
  fields: {
    name?: string;
    category?: string;
    location?: string;
    price?: number;
    priceLabel?: string;
    experience?: string;
    tags?: string[];
    about?: string;
    districtId?: number;
    /** null clears; undefined keeps the stored number. */
    phone?: string | null;
    whatsapp?: string | null;
  }
): Promise<VendorRecord | null> {
  // The ownerId check is done in the same query (WHERE owner_id = $X) rather
  // than as a separate lookup, so there's no window where a caller could
  // race between "check ownership" and "perform update" — the update simply
  // can't match a row that isn't theirs.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<VendorRecord>(
      "SELECT * FROM vendors WHERE id = $1 AND owner_id = $2 FOR UPDATE",
      [vendorId, ownerId]
    );
    const old = before.rows[0];
    if (!old) {
      await client.query("ROLLBACK");
      return null;
    }

    // A changed location re-derives the district unless one was given.
    let districtId: number | null = fields.districtId ?? null;
    if (districtId === null && fields.location && fields.location.toLowerCase() !== old.location.toLowerCase()) {
      districtId = await districtIdForLocation(fields.location);
    }

    const result = await client.query<VendorRecord>(
      `UPDATE vendors SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         primary_category_id = COALESCE((SELECT id FROM categories WHERE name = $4), primary_category_id),
         location = COALESCE($5, location),
         price = COALESCE($6, price),
         price_label = COALESCE($7, price_label),
         experience = COALESCE($8, experience),
         tags = COALESCE($9, tags),
         about = COALESCE($10, about),
         district_id = COALESCE($11, district_id),
         phone = CASE WHEN $12::boolean THEN $13 ELSE phone END,
         whatsapp = CASE WHEN $14::boolean THEN $15 ELSE whatsapp END
       WHERE id = $1 AND owner_id = $2
       RETURNING *`,
      [
        vendorId,
        ownerId,
        fields.name ?? null,
        fields.category ?? null,
        fields.location ?? null,
        fields.price ?? null,
        fields.priceLabel ?? null,
        fields.experience ?? null,
        fields.tags ?? null,
        fields.about ?? null,
        districtId,
        fields.phone !== undefined,
        fields.phone ?? null,
        fields.whatsapp !== undefined,
        fields.whatsapp ?? null,
      ]
    );
    const updated = result.rows[0];

    // Keep the auto-created service in step with the listing: when the vendor
    // has exactly one service, a price change updates its starting price, and
    // a category change moves it (and renames it if it still carries the old
    // category as its title). Vendors with several services manage them
    // individually on the dashboard.
    const priceChanged = fields.price !== undefined && fields.price !== old.price;
    const categoryChanged = fields.category !== undefined && fields.category !== old.category;
    if (priceChanged || categoryChanged) {
      const svc = await client.query<{ id: number; title: string }>(
        "SELECT id, title FROM services WHERE vendor_id = $1",
        [vendorId]
      );
      if (svc.rows.length === 1) {
        const only = svc.rows[0];
        await client.query(
          `UPDATE services SET
             price_from = CASE WHEN $2::boolean THEN $3::int ELSE price_from END,
             category_id = CASE WHEN $4::boolean
               THEN COALESCE((SELECT id FROM categories WHERE name = $5), category_id) ELSE category_id END,
             title = CASE WHEN $4::boolean AND title = $6 THEN $5 ELSE title END
           WHERE id = $1`,
          [only.id, priceChanged, updated.price, categoryChanged, updated.category, old.category]
        );
      }
    }

    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const QUOTE_STATUSES = ["pending", "responded", "booked", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export async function updateQuoteStatus(
  quoteId: number,
  ownerId: number,
  status: QuoteStatus
): Promise<LeadRecord | null> {
  // Same pattern as updateVendorListing: the ownership check is baked into
  // the WHERE clause (via a join back to vendors.owner_id) instead of done
  // as a separate query, so a vendor can only ever update the status of a
  // quote request that was actually sent to their own listing.
  // Every real change is recorded in quote_status_events (migration 003), so
  // a mis-tap that undoes a booking can be seen and reverted.
  const result = await pool.query<LeadRecord>(
    `WITH target AS (
       SELECT q.id, q.status AS old_status
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       WHERE q.id = $1 AND v.owner_id = $2
       FOR UPDATE OF q
     ), upd AS (
       UPDATE quote_requests q
       SET status = $3,
           status_updated_at = CASE WHEN q.status <> $3 THEN now() ELSE q.status_updated_at END
       FROM target t
       WHERE q.id = t.id
       RETURNING q.id, q.name, q.phone, q.event_date, q.budget, q.message, q.status, q.created_at
     ), ev AS (
       INSERT INTO quote_status_events (quote_id, from_status, to_status, changed_by)
       SELECT t.id, t.old_status, $3, $2 FROM target t WHERE t.old_status <> $3
     )
     SELECT * FROM upd`,
    [quoteId, ownerId, status]
  );
  return result.rows[0] ?? null;
}

export type CreateReviewResult =
  | { ok: true; review: ReviewRecord }
  | { ok: false; reason: "vendor_not_found" | "already_reviewed" | "own_listing" };

export async function createVendorReview(params: {
  vendorId: number;
  customerId: number;
  reviewerName: string;
  rating: number;
  body: string;
}): Promise<CreateReviewResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vendorRes = await client.query<VendorRecord>(
      "SELECT * FROM vendors WHERE id = $1 FOR UPDATE",
      [params.vendorId]
    );
    const vendor = vendorRes.rows[0];
    if (!vendor) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "vendor_not_found" };
    }
    if (vendor.owner_id === params.customerId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "own_listing" };
    }

    let reviewRow;
    try {
      // verified = this customer sent the vendor an enquiry before reviewing.
      const insertRes = await client.query<ReviewRecord>(
        `INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body, verified)
         VALUES ($1,$2,$3,$4,$5,
           EXISTS (SELECT 1 FROM quote_requests q WHERE q.vendor_id = $1 AND q.customer_id = $2))
         RETURNING *`,
        [params.vendorId, params.customerId, params.reviewerName, params.rating, params.body]
      );
      reviewRow = insertRes.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      // 23505 = unique_violation — the partial unique index on
      // (vendor_id, customer_id) caught a duplicate review attempt.
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        return { ok: false, reason: "already_reviewed" };
      }
      throw err;
    }

    await recomputeVendorRating(client, params.vendorId);

    await client.query("COMMIT");
    return { ok: true, review: reviewRow };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recompute a vendor's rating and review count from its real reviews plus
 * the seeded/imported baseline kept in seed_rating/seed_reviews_count
 * (migration 003), so the first real review adds to "4.7 from 210 reviews"
 * instead of replacing it. New vendors have a 0/0 baseline.
 */
async function recomputeVendorRating(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  vendorId: number
) {
  await client.query(
    `UPDATE vendors v SET
       rating = COALESCE(ROUND(
         (v.seed_rating * v.seed_reviews_count + COALESCE(r.total, 0))
           / NULLIF(v.seed_reviews_count + r.n, 0), 1), 0),
       reviews_count = v.seed_reviews_count + r.n
     FROM (SELECT COUNT(*)::int AS n, SUM(rating) AS total FROM vendor_reviews WHERE vendor_id = $1) r
     WHERE v.id = $1`,
    [vendorId]
  );
}

export const REVIEW_REPORT_REASON_MAX = 500;

/** Stores a report about a review for admin follow-up. Returns false if the review doesn't exist. */
export async function reportReview(params: {
  reviewId: number;
  reporterId: number | null;
  reason: string;
}): Promise<"ok" | "not_found" | "already_reported"> {
  try {
    const result = await pool.query(
      `INSERT INTO review_reports (review_id, reporter_id, reason)
       SELECT r.id, $2, $3 FROM vendor_reviews r WHERE r.id = $1`,
      [params.reviewId, params.reporterId, params.reason]
    );
    return (result.rowCount ?? 0) > 0 ? "ok" : "not_found";
  } catch (err) {
    if (isUniqueViolation(err)) return "already_reported";
    throw err;
  }
}

export async function addFavorite(customerId: number, vendorId: number): Promise<void> {
  await pool.query(
    `INSERT INTO favorites (customer_id, vendor_id) VALUES ($1, $2)
     ON CONFLICT (customer_id, vendor_id) DO NOTHING`,
    [customerId, vendorId]
  );
}

export async function removeFavorite(customerId: number, vendorId: number): Promise<void> {
  await pool.query(
    "DELETE FROM favorites WHERE customer_id = $1 AND vendor_id = $2",
    [customerId, vendorId]
  );
}

export async function isFavorited(customerId: number, vendorId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM favorites WHERE customer_id = $1 AND vendor_id = $2",
    [customerId, vendorId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findFavoriteVendorIds(customerId: number): Promise<Set<number>> {
  const result = await pool.query<{ vendor_id: number }>(
    "SELECT vendor_id FROM favorites WHERE customer_id = $1",
    [customerId]
  );
  return new Set(result.rows.map((r) => r.vendor_id));
}

export interface FavoriteVendor extends VendorRecord {
  favorited_at: string;
}

export async function findFavoritesByCustomer(customerId: number): Promise<FavoriteVendor[]> {
  const result = await pool.query<FavoriteVendor>(
    `SELECT v.*, f.created_at AS favorited_at
     FROM favorites f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.customer_id = $1 AND v.status = 'approved' AND v.published
     ORDER BY f.created_at DESC`,
    [customerId]
  );
  return result.rows;
}

export interface SearchSuggestions {
  locations: string[];
  vendors: { id: number; name: string; category: string }[];
}

export async function findSearchSuggestions(query: string): Promise<SearchSuggestions> {
  const like = `%${escapeLike(query.trim().replace(/\s+/g, " ").toLowerCase())}%`;

  const [locationsRes, vendorsRes] = await Promise.all([
    pool.query<{ location: string }>(
      `SELECT DISTINCT location FROM vendors
       WHERE ${PUBLIC_VENDOR} AND LOWER(location) LIKE $1 ORDER BY location LIMIT 5`,
      [like]
    ),
    pool.query<{ id: number; name: string; category: string }>(
      `SELECT id, name, category FROM vendors
       WHERE ${PUBLIC_VENDOR} AND LOWER(name) LIKE $1
       ORDER BY ${BAYESIAN_RATING} DESC, reviews_count DESC LIMIT 5`,
      [like]
    ),
  ]);

  return {
    locations: locationsRes.rows.map((r) => r.location),
    vendors: vendorsRes.rows,
  };
}

// ---------------------------------------------------------------------------
// Lookups: categories and districts (added in migration 002)
// ---------------------------------------------------------------------------

export async function findCategories(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    "SELECT name FROM categories WHERE active ORDER BY sort_order, name"
  );
  return result.rows.map((r) => r.name);
}

export interface DistrictRecord {
  id: number;
  state: string;
  name: string;
}

export async function findDistricts(state = "Kerala"): Promise<DistrictRecord[]> {
  const result = await pool.query<DistrictRecord>(
    "SELECT id, state, name FROM districts WHERE state = $1 ORDER BY name",
    [state]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Services: what a vendor sells. One vendor, many services.
// ---------------------------------------------------------------------------

export const SERVICE_PRICE_UNITS = ["event", "day", "hour", "plate", "person", "package"] as const;
export type ServicePriceUnit = (typeof SERVICE_PRICE_UNITS)[number];

export interface ServiceRecord {
  id: number;
  vendor_id: number;
  category_id: number;
  category: string;
  title: string;
  description: string;
  price_from: number;
  price_unit: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

const SERVICE_SELECT = `
  SELECT s.id, s.vendor_id, s.category_id, c.name AS category, s.title, s.description,
         s.price_from, s.price_unit, s.active, s.sort_order, s.created_at
  FROM services s
  JOIN categories c ON c.id = s.category_id`;

export async function findServicesByVendor(
  vendorId: number,
  options: { includeInactive?: boolean } = {}
): Promise<ServiceRecord[]> {
  const result = await pool.query<ServiceRecord>(
    `${SERVICE_SELECT}
     WHERE s.vendor_id = $1 ${options.includeInactive ? "" : "AND s.active"}
     ORDER BY s.sort_order, s.id`,
    [vendorId]
  );
  return result.rows;
}

export async function findServiceById(id: number): Promise<ServiceRecord | null> {
  const result = await pool.query<ServiceRecord>(`${SERVICE_SELECT} WHERE s.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function createService(params: {
  vendorId: number;
  ownerId: number;
  category: string;
  title: string;
  description: string;
  priceFrom: number;
  priceUnit: string;
}): Promise<ServiceRecord | null> {
  // Ownership and category are checked inside the INSERT itself (it only
  // inserts a row if the vendor belongs to this user and the category exists),
  // so there is no gap between "check" and "write".
  const result = await pool.query<{ id: number }>(
    `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit)
     SELECT v.id, c.id, $3, $4, $5, $6
     FROM vendors v, categories c
     WHERE v.id = $1 AND v.owner_id = $2 AND c.name = $7
     RETURNING id`,
    [params.vendorId, params.ownerId, params.title, params.description, params.priceFrom, params.priceUnit, params.category]
  );
  const row = result.rows[0];
  return row ? findServiceById(row.id) : null;
}

export async function updateService(
  serviceId: number,
  ownerId: number,
  fields: {
    category?: string;
    title?: string;
    description?: string;
    priceFrom?: number;
    priceUnit?: string;
    active?: boolean;
  }
): Promise<ServiceRecord | null> {
  const result = await pool.query<{ id: number }>(
    `UPDATE services s SET
       category_id = COALESCE((SELECT c.id FROM categories c WHERE c.name = $3), s.category_id),
       title = COALESCE($4, s.title),
       description = COALESCE($5, s.description),
       price_from = COALESCE($6, s.price_from),
       price_unit = COALESCE($7, s.price_unit),
       active = COALESCE($8, s.active)
     FROM vendors v
     WHERE s.id = $1 AND s.vendor_id = v.id AND v.owner_id = $2
       -- A listing must keep at least one active service (see isLastActiveService).
       AND (COALESCE($8, true) OR NOT s.active OR EXISTS (
         SELECT 1 FROM services o WHERE o.vendor_id = s.vendor_id AND o.active AND o.id <> s.id))
     RETURNING s.id`,
    [
      serviceId,
      ownerId,
      fields.category ?? null,
      fields.title ?? null,
      fields.description ?? null,
      fields.priceFrom ?? null,
      fields.priceUnit ?? null,
      fields.active ?? null,
    ]
  );
  const row = result.rows[0];
  return row ? findServiceById(row.id) : null;
}

/** True when this is the only active service of its vendor. */
export async function isLastActiveService(serviceId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM services s
     WHERE s.id = $1 AND s.active
       AND NOT EXISTS (SELECT 1 FROM services o WHERE o.vendor_id = s.vendor_id AND o.active AND o.id <> s.id)`,
    [serviceId]
  );
  return (result.rowCount ?? 0) > 0;
}

export type RemoveServiceResult =
  | { ok: true; mode: "deleted" | "deactivated" }
  | { ok: false; reason: "not_found" | "last_service" };

/**
 * Removes a service without erasing history: a service that past enquiries
 * refer to is deactivated (hidden) instead of deleted, so leads keep saying
 * what the customer asked for. The last active service can't be removed.
 */
export async function removeService(serviceId: number, ownerId: number): Promise<RemoveServiceResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ id: number; vendor_id: number; active: boolean }>(
      `SELECT s.id, s.vendor_id, s.active FROM services s
       JOIN vendors v ON v.id = s.vendor_id
       WHERE s.id = $1 AND v.owner_id = $2
       FOR UPDATE OF s`,
      [serviceId, ownerId]
    );
    const svc = found.rows[0];
    if (!svc) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (svc.active) {
      const others = await client.query(
        "SELECT 1 FROM services WHERE vendor_id = $1 AND active AND id <> $2 LIMIT 1",
        [svc.vendor_id, svc.id]
      );
      if ((others.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "last_service" };
      }
    }
    const used = await client.query(
      "SELECT 1 FROM quote_request_services WHERE service_id = $1 LIMIT 1",
      [svc.id]
    );
    let mode: "deleted" | "deactivated";
    if ((used.rowCount ?? 0) > 0) {
      await client.query("UPDATE services SET active = false WHERE id = $1", [svc.id]);
      mode = "deactivated";
    } else {
      await client.query("DELETE FROM services WHERE id = $1", [svc.id]);
      mode = "deleted";
    }
    await client.query("COMMIT");
    return { ok: true, mode };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** @deprecated Hard delete; prefer removeService, which keeps enquiry history. */
export async function deleteService(serviceId: number, ownerId: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM services s
     USING vendors v
     WHERE s.id = $1 AND s.vendor_id = v.id AND v.owner_id = $2`,
    [serviceId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Portfolio: work samples. Read-only for now; uploads arrive in the next phase.
// ---------------------------------------------------------------------------

export interface PortfolioItemRecord {
  id: number;
  vendor_id: number;
  service_id: number | null;
  media_type: "image" | "video_link";
  media_url: string;
  caption: string;
  sort_order: number;
  created_at: string;
}

export async function findPortfolioByVendor(vendorId: number): Promise<PortfolioItemRecord[]> {
  const result = await pool.query<PortfolioItemRecord>(
    `SELECT id, vendor_id, service_id, media_type, media_url, caption, sort_order, created_at
     FROM portfolio_items
     WHERE vendor_id = $1
     ORDER BY sort_order, id`,
    [vendorId]
  );
  return result.rows;
}

// ===========================================================================
// Vendor workspace data layer (migration 004, PRODUCT_PLAN.md P0).
//
// Ownership rule: every function below that reads or changes a vendor's
// private data takes the caller's own `vendorId` (resolve it from the session
// with getOwnVendor(userId); never accept a vendorId from the client) and
// scopes every statement with `vendor_id = vendorId`, so a vendor can only
// ever touch their own rows. Functions return null / false / "not_found" when
// the row doesn't belong to that vendor; routes should answer 404.
// ===========================================================================

type Queryable = Pick<PoolClient, "query">;

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 23514 = check_violation (CHECK constraints and the 004 integrity triggers). */
export function isCheckViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "23514";
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export interface CategoryRecord {
  id: number;
  name: string;
  slug: string;
  display_name: string;
  name_ml: string | null;
  icon: string | null;
  description: string;
  active: boolean;
  sort_order: number;
  default_price_unit: string;
  allowed_price_units: string[];
  allow_on_request: boolean;
  uses_slots: boolean;
  uses_inventory: boolean;
  attribute_schema: AttributeField[];
}

export interface OfferingTemplateRecord {
  id: number;
  category_id: number;
  code: string;
  name: string;
  name_ml: string | null;
  kind: "unit" | "addon";
  default_price_unit: string;
  allowed_price_units: string[];
  allow_on_request: boolean;
  attribute_schema: AttributeField[];
  is_core: boolean;
  sort_order: number;
  active: boolean;
}

export interface EventTypeRecord {
  id: number;
  slug: string;
  name: string;
  name_ml: string | null;
  community: string | null;
  sort_order: number;
  /** "What you need" bundle: categories in order, with is_core. */
  categories: { category_id: number; is_core: boolean }[];
}

export interface Taxonomy {
  categories: CategoryRecord[];
  templates: OfferingTemplateRecord[];
  eventTypes: EventTypeRecord[];
  districts: DistrictRecord[];
  priceUnits: { value: string; label: string }[];
}

const CATEGORY_COLS = `id, name, slug, display_name, name_ml, icon, description, active, sort_order,
  default_price_unit, allowed_price_units, allow_on_request, uses_slots, uses_inventory, attribute_schema`;

const TEMPLATE_COLS = `t.id, t.category_id, t.code, t.name, t.name_ml, t.kind, t.default_price_unit,
  t.allowed_price_units, t.allow_on_request, t.attribute_schema, t.is_core, t.sort_order, t.active`;

function cleanCategory(c: CategoryRecord): CategoryRecord {
  return { ...c, attribute_schema: parseAttributeSchema(c.attribute_schema) };
}

function cleanTemplate(t: OfferingTemplateRecord): OfferingTemplateRecord {
  return { ...t, attribute_schema: parseAttributeSchema(t.attribute_schema) };
}

export async function findCategoryRecords(opts: { includeInactive?: boolean } = {}): Promise<CategoryRecord[]> {
  const r = await pool.query<CategoryRecord>(
    `SELECT ${CATEGORY_COLS} FROM categories ${opts.includeInactive ? "" : "WHERE active"} ORDER BY sort_order, name`
  );
  return r.rows.map(cleanCategory);
}

export async function findCategoryById(id: number): Promise<CategoryRecord | null> {
  const r = await pool.query<CategoryRecord>(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = $1`, [id]);
  return r.rows[0] ? cleanCategory(r.rows[0]) : null;
}

export async function findCategoryBySlug(slug: string): Promise<CategoryRecord | null> {
  const r = await pool.query<CategoryRecord>(`SELECT ${CATEGORY_COLS} FROM categories WHERE slug = $1`, [slug]);
  return r.rows[0] ? cleanCategory(r.rows[0]) : null;
}

export async function findOfferingTemplates(
  opts: { categoryId?: number; includeInactive?: boolean } = {}
): Promise<OfferingTemplateRecord[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (!opts.includeInactive) where.push("t.active AND c.active");
  if (opts.categoryId) {
    values.push(opts.categoryId);
    where.push(`t.category_id = $${values.length}`);
  }
  const r = await pool.query<OfferingTemplateRecord>(
    `SELECT ${TEMPLATE_COLS}
     FROM offering_templates t JOIN categories c ON c.id = t.category_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY c.sort_order, t.sort_order, t.name`,
    values
  );
  return r.rows.map(cleanTemplate);
}

export async function findEventTypes(): Promise<EventTypeRecord[]> {
  const r = await pool.query<EventTypeRecord>(
    `SELECT e.id, e.slug, e.name, e.name_ml, e.community, e.sort_order,
            COALESCE((SELECT json_agg(json_build_object('category_id', ec.category_id, 'is_core', ec.is_core)
                                      ORDER BY ec.sort_order)
                      FROM event_type_categories ec JOIN categories c ON c.id = ec.category_id AND c.active
                      WHERE ec.event_type_id = e.id), '[]'::json) AS categories
     FROM event_types e WHERE e.active ORDER BY e.sort_order, e.name`
  );
  return r.rows;
}

/** Everything /api/meta/taxonomy returns (the single source of truth for category lists). */
export async function findTaxonomy(): Promise<Taxonomy> {
  const [categories, templates, eventTypes, districts] = await Promise.all([
    findCategoryRecords(),
    findOfferingTemplates(),
    findEventTypes(),
    findDistricts("Kerala"),
  ]);
  return {
    categories,
    templates,
    eventTypes,
    districts,
    priceUnits: PRICE_UNITS.map((u) => ({ value: u, label: PRICE_UNIT_LABELS[u] })),
  };
}

/**
 * The rules an offering is validated against: its template's, or (custom
 * "Other" offering, templateId null) its category's. null when the template or
 * category doesn't exist / is inactive, or the template isn't in that category.
 */
export async function findOfferingRules(params: {
  categoryId: number;
  templateId?: number | null;
}): Promise<{ rules: OfferingRules; category: CategoryRecord; template: OfferingTemplateRecord | null } | null> {
  const category = await findCategoryById(params.categoryId);
  if (!category || !category.active) return null;
  if (params.templateId) {
    const r = await pool.query<OfferingTemplateRecord>(
      `SELECT ${TEMPLATE_COLS} FROM offering_templates t WHERE t.id = $1 AND t.category_id = $2 AND t.active`,
      [params.templateId, params.categoryId]
    );
    if (!r.rows[0]) return null;
    const template = cleanTemplate(r.rows[0]);
    return {
      category,
      template,
      rules: {
        allowedPriceUnits: template.allowed_price_units,
        defaultPriceUnit: template.default_price_unit,
        allowOnRequest: template.allow_on_request,
        attributeSchema: template.attribute_schema,
      },
    };
  }
  return {
    category,
    template: null,
    rules: {
      allowedPriceUnits: category.allowed_price_units,
      defaultPriceUnit: category.default_price_unit,
      allowOnRequest: category.allow_on_request,
      attributeSchema: category.attribute_schema,
    },
  };
}

/** Template id -> its category id (a template-based offering's category comes from its template). */
export async function findTemplateCategoryId(templateId: number): Promise<number | null> {
  const r = await pool.query<{ category_id: number }>(
    "SELECT category_id FROM offering_templates WHERE id = $1 AND active",
    [templateId]
  );
  return r.rows[0]?.category_id ?? null;
}

// ---------------------------------------------------------------------------
// Vendor listing (onboarding wizard, business profile, service areas)
// ---------------------------------------------------------------------------

/** The caller's own listing (alias of findVendorByOwner, named for intent). */
export async function getOwnVendor(userId: number): Promise<VendorRecord | null> {
  return findVendorByOwner(userId);
}

export interface ListingPatch {
  name?: string;
  vendorType?: "company" | "individual";
  primaryCategoryId?: number;
  /** Replaces the whole set; the primary category is dropped from it. */
  additionalCategoryIds?: number[];
  about?: string;
  yearsExperience?: number | null;
  yearEstablished?: number | null;
  teamSize?: number | null;
  languages?: string[];
  tags?: string[];
  /** null clears; undefined keeps. */
  phone?: string | null;
  whatsapp?: string | null;
  districtId?: number;
  location?: string;
  addressLine?: string | null;
  landmark?: string | null;
  pincode?: string | null;
  legalName?: string | null;
  gstin?: string | null;
  fssaiNo?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
  websiteUrl?: string | null;
  travelOutsideKerala?: boolean;
  maxEventsPerDay?: number;
  maxGuests?: number | null;
  attributes?: Record<string, unknown>;
  published?: boolean;
  /** Wizard step reached (1..6); only ever moves forward. */
  onboardingStep?: number;
}

/**
 * Creates the draft listing at wizard step 1 (status 'draft', not public).
 * Returns null when this user already has a listing (-> 409) or the category
 * doesn't exist.
 */
export async function createDraftListing(params: {
  ownerId: number;
  name: string;
  vendorType: "company" | "individual";
  primaryCategoryId: number;
  districtId?: number | null;
  location?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}): Promise<VendorRecord | null> {
  try {
    const r = await pool.query<VendorRecord>(
      `INSERT INTO vendors (owner_id, name, vendor_type, primary_category_id, category, district_id, location,
                            phone, whatsapp, price, price_label, experience, about, status, onboarding_step, published)
       SELECT $1, $2, $3::vendor_type, c.id, c.name, $5::int,
              COALESCE(NULLIF($6::text, ''), (SELECT name FROM districts WHERE id = $5::int), ''),
              $7, $8, 0, 'Price on request', '', '', 'draft', 1, true
       FROM categories c WHERE c.id = $4 AND c.active
       RETURNING *`,
      [params.ownerId, params.name, params.vendorType, params.primaryCategoryId, params.districtId ?? null,
       params.location ?? null, params.phone ?? null, params.whatsapp ?? null]
    );
    return r.rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/**
 * Updates the caller's listing with one wizard step / profile form (validate
 * the input in the route first). Keeps the legacy text columns (category,
 * location, experience) in step. On an approved listing, a change to name /
 * primary category / phone sets the re-review flag (the listing stays live).
 * Returns null if the vendor doesn't exist or the category is invalid.
 */
export async function updateVendorStep(vendorId: number, patch: ListingPatch): Promise<VendorRecord | null> {
  return withTransaction(async (client) => {
    const cur = await client.query<VendorRecord>("SELECT * FROM vendors WHERE id = $1 FOR UPDATE", [vendorId]);
    const old = cur.rows[0];
    if (!old) return null;

    const sets: string[] = [];
    const values: unknown[] = [vendorId];
    const set = (col: string, v: unknown, cast = "") => {
      values.push(v);
      sets.push(`${col} = $${values.length}${cast}`);
    };

    if (patch.name !== undefined) set("name", patch.name);
    if (patch.vendorType !== undefined) set("vendor_type", patch.vendorType, "::vendor_type");
    if (patch.primaryCategoryId !== undefined) {
      const c = await client.query<{ name: string }>("SELECT name FROM categories WHERE id = $1 AND active", [
        patch.primaryCategoryId,
      ]);
      if (!c.rows[0]) return null;
      set("primary_category_id", patch.primaryCategoryId);
      set("category", c.rows[0].name);
    }
    if (patch.about !== undefined) set("about", patch.about);
    if (patch.yearsExperience !== undefined) {
      set("years_experience", patch.yearsExperience);
      set("experience", patch.yearsExperience == null ? "" : `${patch.yearsExperience} yrs`);
    }
    if (patch.yearEstablished !== undefined) set("year_established", patch.yearEstablished);
    if (patch.teamSize !== undefined) set("team_size", patch.teamSize);
    if (patch.languages !== undefined) set("languages", patch.languages);
    if (patch.tags !== undefined) set("tags", patch.tags);
    if (patch.phone !== undefined) set("phone", patch.phone);
    if (patch.whatsapp !== undefined) set("whatsapp", patch.whatsapp);
    if (patch.districtId !== undefined) {
      set("district_id", patch.districtId);
      if (patch.location === undefined) {
        values.push(patch.districtId);
        sets.push(`location = COALESCE((SELECT name FROM districts WHERE id = $${values.length}), location)`);
      }
    }
    if (patch.location !== undefined) set("location", patch.location);
    if (patch.addressLine !== undefined) set("address_line", patch.addressLine);
    if (patch.landmark !== undefined) set("landmark", patch.landmark);
    if (patch.pincode !== undefined) set("pincode", patch.pincode);
    if (patch.legalName !== undefined) set("legal_name", patch.legalName);
    if (patch.gstin !== undefined) set("gstin", patch.gstin);
    if (patch.fssaiNo !== undefined) set("fssai_no", patch.fssaiNo);
    if (patch.instagramUrl !== undefined) set("instagram_url", patch.instagramUrl);
    if (patch.youtubeUrl !== undefined) set("youtube_url", patch.youtubeUrl);
    if (patch.websiteUrl !== undefined) set("website_url", patch.websiteUrl);
    if (patch.travelOutsideKerala !== undefined) set("travel_outside_kerala", patch.travelOutsideKerala);
    if (patch.maxEventsPerDay !== undefined) set("max_events_per_day", patch.maxEventsPerDay);
    if (patch.maxGuests !== undefined) set("max_guests", patch.maxGuests);
    if (patch.attributes !== undefined) set("attributes", JSON.stringify(patch.attributes), "::jsonb");
    if (patch.published !== undefined) set("published", patch.published);
    if (patch.onboardingStep !== undefined) {
      values.push(patch.onboardingStep);
      sets.push(`onboarding_step = GREATEST(onboarding_step, $${values.length})`);
    }

    // Re-review flag (P0-13): approved listing changing a trust-relevant field.
    if (old.status === "approved") {
      const changed: string[] = [];
      if (patch.name !== undefined && patch.name !== old.name) changed.push("name");
      if (patch.primaryCategoryId !== undefined && patch.primaryCategoryId !== old.primary_category_id) changed.push("category");
      if (patch.phone !== undefined && (patch.phone ?? null) !== (old.phone ?? null)) changed.push("phone");
      if (changed.length) {
        values.push(changed);
        sets.push(
          "rereview_required = true",
          "rereview_requested_at = now()",
          `rereview_fields = ARRAY(SELECT DISTINCT unnest(rereview_fields || $${values.length}::text[]))`
        );
      }
    }

    sets.push("updated_at = now()");
    const upd = await client.query<VendorRecord>(`UPDATE vendors SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, values);
    const updated = upd.rows[0];

    if (patch.additionalCategoryIds !== undefined) {
      await client.query("DELETE FROM vendor_categories WHERE vendor_id = $1", [vendorId]);
      await client.query(
        `INSERT INTO vendor_categories (vendor_id, category_id)
         SELECT $1, c.id FROM categories c WHERE c.id = ANY($2::int[]) AND c.active AND c.id <> $3
         ON CONFLICT DO NOTHING`,
        [vendorId, patch.additionalCategoryIds, updated.primary_category_id ?? 0]
      );
    } else if (patch.primaryCategoryId !== undefined) {
      await client.query("DELETE FROM vendor_categories WHERE vendor_id = $1 AND category_id = $2", [
        vendorId,
        updated.primary_category_id,
      ]);
    }
    return updated;
  });
}

/** Additional categories (not including the primary). */
export async function findVendorCategoryIds(vendorId: number): Promise<number[]> {
  const r = await pool.query<{ category_id: number }>(
    "SELECT category_id FROM vendor_categories WHERE vendor_id = $1 ORDER BY category_id",
    [vendorId]
  );
  return r.rows.map((x) => x.category_id);
}

export interface ServiceAreaRecord {
  district_id: number;
  district_name: string;
  travel_fee: number | null;
  travel_note: string | null;
}

export async function findVendorServiceAreas(vendorId: number): Promise<ServiceAreaRecord[]> {
  const r = await pool.query<ServiceAreaRecord>(
    `SELECT a.district_id, d.name AS district_name, a.travel_fee, a.travel_note
     FROM vendor_service_areas a JOIN districts d ON d.id = a.district_id
     WHERE a.vendor_id = $1 ORDER BY d.name`,
    [vendorId]
  );
  return r.rows;
}

/** Replaces the whole served-district set. Unknown district ids are ignored. */
export async function setVendorServiceAreas(
  vendorId: number,
  areas: { districtId: number; travelFee?: number | null; travelNote?: string | null }[]
): Promise<ServiceAreaRecord[]> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM vendor_service_areas WHERE vendor_id = $1", [vendorId]);
    if (areas.length) {
      await client.query(
        `INSERT INTO vendor_service_areas (vendor_id, district_id, travel_fee, travel_note)
         SELECT $1, a.district_id, a.travel_fee, NULLIF(a.travel_note, '')
         FROM unnest($2::int[], $3::int[], $4::text[]) AS a(district_id, travel_fee, travel_note)
         WHERE EXISTS (SELECT 1 FROM districts d WHERE d.id = a.district_id)
         ON CONFLICT DO NOTHING`,
        [vendorId, areas.map((a) => a.districtId), areas.map((a) => a.travelFee ?? null), areas.map((a) => a.travelNote ?? null)]
      );
    }
  });
  return findVendorServiceAreas(vendorId);
}

export const SUBMIT_MIN_IMAGES = 3;
export type SubmitMissing = "basics" | "offering" | "logo_or_cover" | "images";

/** What still blocks submitting the listing for review (empty = ready). */
export async function findListingMissing(vendorId: number): Promise<SubmitMissing[]> {
  const r = await pool.query<{ basics: boolean; offering: boolean; logo_or_cover: boolean; images: number }>(
    `SELECT (v.name <> '' AND v.primary_category_id IS NOT NULL AND v.district_id IS NOT NULL
             AND COALESCE(v.phone, '') <> '' AND length(trim(v.about)) >= 30) AS basics,
            EXISTS (SELECT 1 FROM services s WHERE s.vendor_id = v.id AND s.active AND NOT s.incomplete
                    AND s.hidden_reason IS NULL AND s.kind IN ('unit','package') AND s.sale_mode = 'separate'
                    AND (s.price_mode = 'on_request' OR s.price_from > 0)) AS offering,
            (v.logo_media_id IS NOT NULL OR v.cover_media_id IS NOT NULL
             OR COALESCE(v.logo_url, '') <> '' OR COALESCE(v.cover_image_url, '') <> '') AS logo_or_cover,
            (SELECT COUNT(*)::int FROM media_assets m WHERE m.vendor_id = v.id AND m.kind = 'image'
               AND m.status IN ('pending_review','approved')) AS images
     FROM vendors v WHERE v.id = $1`,
    [vendorId]
  );
  const row = r.rows[0];
  if (!row) return ["basics", "offering", "logo_or_cover", "images"];
  const missing: SubmitMissing[] = [];
  if (!row.basics) missing.push("basics");
  if (!row.offering) missing.push("offering");
  if (!row.logo_or_cover) missing.push("logo_or_cover");
  if (row.images < SUBMIT_MIN_IMAGES) missing.push("images");
  return missing;
}

export type SubmitResult =
  | { ok: true; vendor: VendorRecord }
  | { ok: false; reason: "not_found" | "wrong_status"; status?: VendorStatus }
  | { ok: false; reason: "incomplete"; missing: SubmitMissing[] };

/** draft / changes_requested / rejected -> pending (records vendor_status_events). */
export async function submitVendorListing(vendorId: number, userId: number): Promise<SubmitResult> {
  const missing = await findListingMissing(vendorId);
  if (missing.length) return { ok: false, reason: "incomplete", missing };
  return withTransaction<SubmitResult>(async (client) => {
    const cur = await client.query<VendorRecord>("SELECT * FROM vendors WHERE id = $1 FOR UPDATE", [vendorId]);
    const v = cur.rows[0];
    if (!v) return { ok: false, reason: "not_found" };
    if (!["draft", "changes_requested", "rejected"].includes(v.status)) {
      return { ok: false, reason: "wrong_status", status: v.status };
    }
    const upd = await client.query<VendorRecord>(
      `UPDATE vendors SET status = 'pending', submitted_at = now(), status_reason = NULL,
              onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
              onboarding_step = GREATEST(onboarding_step, 6), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [vendorId]
    );
    await client.query(
      "INSERT INTO vendor_status_events (vendor_id, from_status, to_status, changed_by) VALUES ($1,$2,'pending',$3)",
      [vendorId, v.status, userId]
    );
    return { ok: true, vendor: upd.rows[0] };
  });
}

export async function findVendorStatusEvents(vendorId: number) {
  const r = await pool.query<{ id: number; from_status: string; to_status: string; reason: string | null; created_at: string }>(
    `SELECT id, from_status, to_status, reason, created_at FROM vendor_status_events
     WHERE vendor_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [vendorId]
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Offerings (services rows) and packages
// ---------------------------------------------------------------------------

export interface OfferingRecord {
  id: number;
  vendor_id: number;
  category_id: number;
  category: string; // categories.name
  category_slug: string;
  template_id: number | null;
  template_code: string | null;
  template_name: string | null;
  custom_name: string | null;
  kind: "unit" | "package" | "addon";
  title: string;
  description: string;
  sale_mode: "separate" | "package_only";
  fulfilment: "in_house" | "partner";
  parent_service_id: number | null;
  price_mode: "from" | "fixed" | "range" | "on_request";
  price_from: number;
  price_to: number | null;
  price_unit: string;
  unit_label: string | null;
  min_qty: string | null; // NUMERIC comes back as string
  max_qty: string | null;
  qty_step: string;
  qty_owned: number | null;
  guest_min: number | null;
  guest_max: number | null;
  lead_time_days: number | null;
  inclusions: string[];
  attributes: Record<string, unknown>;
  cover_media_id: number | null;
  incomplete: boolean;
  hidden_reason: string | null;
  active: boolean;
  sort_order: number;
  event_type_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface PackageItemRecord {
  package_id: number;
  item_id: number;
  qty: string;
  note: string;
  sort_order: number;
  title: string;
  kind: string;
  active: boolean;
  sale_mode: string;
  category_id: number;
}

const OFFERING_SELECT = `
  SELECT s.id, s.vendor_id, s.category_id, c.name AS category, c.slug AS category_slug,
         s.template_id, t.code AS template_code, t.name AS template_name, s.custom_name,
         s.kind, s.title, s.description, s.sale_mode, s.fulfilment, s.parent_service_id,
         s.price_mode, s.price_from, s.price_to, s.price_unit, s.unit_label,
         s.min_qty, s.max_qty, s.qty_step, s.qty_owned, s.guest_min, s.guest_max, s.lead_time_days,
         s.inclusions, s.attributes, s.cover_media_id, s.incomplete, s.hidden_reason,
         s.active, s.sort_order,
         COALESCE((SELECT array_agg(se.event_type_id ORDER BY se.event_type_id)
                   FROM service_event_types se WHERE se.service_id = s.id), '{}') AS event_type_ids,
         s.created_at, s.updated_at
  FROM services s
  JOIN categories c ON c.id = s.category_id
  LEFT JOIN offering_templates t ON t.id = s.template_id`;

/**
 * A vendor's offerings, all kinds. `publicOnly` = what a customer may see:
 * active, not hidden, packages not incomplete (package-only units are still
 * returned so the profile can show them inside packages and under "Included
 * in our packages").
 */
export async function findOfferingsByVendor(
  vendorId: number,
  opts: { includeInactive?: boolean; publicOnly?: boolean; kind?: "unit" | "package" | "addon" } = {}
): Promise<OfferingRecord[]> {
  const where = ["s.vendor_id = $1"];
  const values: unknown[] = [vendorId];
  if (opts.publicOnly) where.push("s.active AND s.hidden_reason IS NULL AND NOT (s.kind = 'package' AND s.incomplete)");
  else if (!opts.includeInactive) where.push("s.active");
  if (opts.kind) {
    values.push(opts.kind);
    where.push(`s.kind = $${values.length}`);
  }
  const r = await pool.query<OfferingRecord>(`${OFFERING_SELECT} WHERE ${where.join(" AND ")} ORDER BY s.sort_order, s.id`, values);
  return r.rows;
}

/** One of the vendor's own offerings (null if it isn't theirs -> 404). */
export async function findOwnOffering(vendorId: number, offeringId: number): Promise<OfferingRecord | null> {
  const r = await pool.query<OfferingRecord>(`${OFFERING_SELECT} WHERE s.id = $1 AND s.vendor_id = $2`, [offeringId, vendorId]);
  return r.rows[0] ?? null;
}

export async function findPackageItems(packageIds: number[]): Promise<PackageItemRecord[]> {
  if (!packageIds.length) return [];
  const r = await pool.query<PackageItemRecord>(
    `SELECT pi.package_id, pi.item_id, pi.qty, pi.note, pi.sort_order,
            s.title, s.kind, s.active, s.sale_mode, s.category_id
     FROM package_items pi JOIN services s ON s.id = pi.item_id
     WHERE pi.package_id = ANY($1::int[])
     ORDER BY pi.package_id, pi.sort_order, s.title`,
    [packageIds]
  );
  return r.rows;
}

/**
 * vendors.price / price_label cache = the cheapest active, priced,
 * separately-sellable unit or package (not incomplete, not hidden). With none,
 * price 0 and "Price on request". Called after every offering write.
 */
export async function recomputeVendorPrice(vendorId: number, client: Queryable = pool): Promise<void> {
  const r = await client.query<{ price_from: number; price_unit: string; unit_label: string | null }>(
    `SELECT price_from, price_unit, unit_label FROM services
     WHERE vendor_id = $1 AND active AND hidden_reason IS NULL AND NOT incomplete
       AND kind IN ('unit','package') AND sale_mode = 'separate'
       AND price_mode <> 'on_request' AND price_from > 0
     ORDER BY price_from, id LIMIT 1`,
    [vendorId]
  );
  const best = r.rows[0] ?? null;
  await client.query("UPDATE vendors SET price = $2, price_label = $3 WHERE id = $1", [
    vendorId,
    best?.price_from ?? 0,
    formatVendorPriceLabel(best),
  ]);
}

async function setOfferingEventTypes(client: Queryable, serviceId: number, ids: number[]) {
  await client.query("DELETE FROM service_event_types WHERE service_id = $1", [serviceId]);
  if (ids.length) {
    await client.query(
      `INSERT INTO service_event_types (service_id, event_type_id)
       SELECT $1, e.id FROM event_types e WHERE e.id = ANY($2::int[]) ON CONFLICT DO NOTHING`,
      [serviceId, ids]
    );
  }
}

const OFFERING_COLUMNS: [keyof ParsedOfferingFields, string, string?][] = [
  ["templateId", "template_id"],
  ["customName", "custom_name"],
  ["categoryId", "category_id"],
  ["title", "title"],
  ["description", "description"],
  ["kind", "kind"],
  ["saleMode", "sale_mode"],
  ["fulfilment", "fulfilment"],
  ["parentServiceId", "parent_service_id"],
  ["priceMode", "price_mode"],
  ["priceFrom", "price_from"],
  ["priceTo", "price_to"],
  ["priceUnit", "price_unit"],
  ["unitLabel", "unit_label"],
  ["minQty", "min_qty"],
  ["maxQty", "max_qty"],
  ["qtyStep", "qty_step"],
  ["qtyOwned", "qty_owned"],
  ["guestMin", "guest_min"],
  ["guestMax", "guest_max"],
  ["leadTimeDays", "lead_time_days"],
  ["inclusions", "inclusions"],
  ["attributes", "attributes", "::jsonb"],
  ["active", "active"],
];

function offeringValue(key: keyof ParsedOfferingFields, v: unknown) {
  return key === "attributes" ? JSON.stringify(v ?? {}) : v;
}

/** Builds the INSERT column / placeholder lists for a services row. */
function offeringInsert(vendorId: number, f: ParsedOfferingFields) {
  const cols = ["vendor_id", "sort_order"];
  const vals: unknown[] = [vendorId];
  const ph = ["$1", "(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM services WHERE vendor_id = $1)"];
  for (const [key, col, cast] of OFFERING_COLUMNS) {
    if (f[key] === undefined) continue;
    vals.push(offeringValue(key, f[key]));
    cols.push(col);
    ph.push(`$${vals.length}${cast ?? ""}`);
  }
  return { sql: `INSERT INTO services (${cols.join(", ")}) VALUES (${ph.join(", ")}) RETURNING id`, vals };
}

/** Builds the UPDATE SET list; $1 = service id. `skip` keys are never updated. */
function offeringUpdate(f: ParsedOfferingFields, skip: (keyof ParsedOfferingFields)[]) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col, cast] of OFFERING_COLUMNS) {
    if (skip.includes(key) || f[key] === undefined) continue;
    vals.push(offeringValue(key, f[key]));
    sets.push(`${col} = $${vals.length + 1}${cast ?? ""}`);
  }
  sets.push("updated_at = now()");
  return { sets, vals };
}

export type OfferingWriteResult =
  | { ok: true; offering: OfferingRecord; customRequestId?: number }
  | { ok: false; reason: "not_found" | "invalid_parent" | "constraint"; message?: string };

/**
 * Creates a unit / add-on (use createPackage for packages). Validate the body
 * with parseOfferingBody + findOfferingRules first. For a custom ("Other")
 * offering (no templateId, customName set) a custom_offering_requests row is
 * filed too, flagged when contact details were masked.
 */
export async function createOffering(
  vendorId: number,
  fields: ParsedOfferingFields & { categoryId: number; title: string; priceFrom: number; priceUnit: string }
): Promise<OfferingWriteResult> {
  try {
    return await withTransaction<OfferingWriteResult>(async (client) => {
      if (fields.parentServiceId) {
        const p = await client.query("SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2 AND kind <> 'addon'", [
          fields.parentServiceId,
          vendorId,
        ]);
        if (!p.rowCount) return { ok: false, reason: "invalid_parent" };
      }
      const ins = offeringInsert(vendorId, fields);
      const id = (await client.query<{ id: number }>(ins.sql, ins.vals)).rows[0].id;
      if (fields.eventTypeIds) await setOfferingEventTypes(client, id, fields.eventTypeIds);

      let customRequestId: number | undefined;
      if (!fields.templateId && fields.customName) {
        const req = await client.query<{ id: number }>(
          `INSERT INTO custom_offering_requests (service_id, vendor_id, category_id, raw_name, normalised_name, flagged_contact)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [id, vendorId, fields.categoryId, fields.customName, normaliseCustomName(fields.customName), !!fields.flaggedContact]
        );
        customRequestId = req.rows[0].id;
      }
      await recomputeVendorPrice(vendorId, client);
      const offering = (await client.query<OfferingRecord>(`${OFFERING_SELECT} WHERE s.id = $1`, [id])).rows[0];
      return { ok: true, offering, customRequestId };
    });
  } catch (err) {
    if (isCheckViolation(err)) return { ok: false, reason: "constraint", message: (err as Error).message };
    throw err;
  }
}

/**
 * Updates one of the vendor's units / add-ons / packages (kind can't change;
 * use updatePackage to change a package's items). Deactivating a unit marks
 * the packages using it incomplete (DB trigger). Recomputes the vendor price.
 */
export async function updateOffering(
  vendorId: number,
  offeringId: number,
  fields: ParsedOfferingFields
): Promise<OfferingWriteResult> {
  try {
    return await withTransaction<OfferingWriteResult>(async (client) => {
      const cur = await client.query("SELECT id FROM services WHERE id = $1 AND vendor_id = $2 FOR UPDATE", [offeringId, vendorId]);
      if (!cur.rowCount) return { ok: false, reason: "not_found" };
      if (fields.parentServiceId) {
        const p = await client.query(
          "SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2 AND kind <> 'addon' AND id <> $3",
          [fields.parentServiceId, vendorId, offeringId]
        );
        if (!p.rowCount) return { ok: false, reason: "invalid_parent" };
      }
      const u = offeringUpdate(fields, ["kind"]);
      await client.query(`UPDATE services SET ${u.sets.join(", ")} WHERE id = $1`, [offeringId, ...u.vals]);
      if (fields.eventTypeIds) await setOfferingEventTypes(client, offeringId, fields.eventTypeIds);
      if (fields.customName && fields.templateId == null) {
        await client.query(
          `UPDATE custom_offering_requests SET raw_name = $2, normalised_name = $3, flagged_contact = flagged_contact OR $4
           WHERE service_id = $1 AND status = 'pending'`,
          [offeringId, fields.customName, normaliseCustomName(fields.customName), !!fields.flaggedContact]
        );
      }
      await recomputeVendorPrice(vendorId, client);
      const offering = (await client.query<OfferingRecord>(`${OFFERING_SELECT} WHERE s.id = $1`, [offeringId])).rows[0];
      return { ok: true, offering };
    });
  } catch (err) {
    if (isCheckViolation(err)) return { ok: false, reason: "constraint", message: (err as Error).message };
    throw err;
  }
}

/**
 * Removes an offering: deleted when no enquiry or offer refers to it,
 * otherwise deactivated so leads keep their history. Packages that contained a
 * deleted unit are marked incomplete (an item disappeared).
 */
export async function removeOffering(
  vendorId: number,
  offeringId: number
): Promise<{ ok: true; mode: "deleted" | "deactivated" } | { ok: false; reason: "not_found" }> {
  return withTransaction(async (client) => {
    const cur = await client.query("SELECT id FROM services WHERE id = $1 AND vendor_id = $2 FOR UPDATE", [offeringId, vendorId]);
    if (!cur.rowCount) return { ok: false as const, reason: "not_found" as const };
    const used = await client.query(
      `SELECT 1 FROM quote_request_services WHERE service_id = $1
       UNION ALL SELECT 1 FROM quote_offer_lines WHERE service_id = $1 LIMIT 1`,
      [offeringId]
    );
    let mode: "deleted" | "deactivated";
    if (used.rowCount) {
      await client.query("UPDATE services SET active = false, updated_at = now() WHERE id = $1", [offeringId]);
      mode = "deactivated";
    } else {
      // The package_items rows cascade away (and the trigger recomputes
      // `incomplete` from the remaining items), so mark the packages after
      // the delete: a package that lost an item must be reviewed by the vendor.
      const pk = await client.query<{ package_id: number }>("SELECT package_id FROM package_items WHERE item_id = $1", [
        offeringId,
      ]);
      await client.query("DELETE FROM services WHERE id = $1", [offeringId]);
      if (pk.rowCount) {
        await client.query("UPDATE services SET incomplete = true WHERE id = ANY($1::int[])", [pk.rows.map((x) => x.package_id)]);
      }
      mode = "deleted";
    }
    await recomputeVendorPrice(vendorId, client);
    return { ok: true as const, mode };
  });
}

/** Sets sort_order from the given id order (ids not owned by the vendor are ignored). */
export async function reorderOfferings(vendorId: number, ids: number[]): Promise<void> {
  await pool.query(
    `UPDATE services s SET sort_order = o.ord - 1
     FROM unnest($2::int[]) WITH ORDINALITY AS o(id, ord)
     WHERE s.id = o.id AND s.vendor_id = $1`,
    [vendorId, ids]
  );
}

export type PackageItemInput = { serviceId: number; qty: number; note: string };

export type PackageWriteResult =
  | { ok: true; offering: OfferingRecord; items: PackageItemRecord[] }
  | { ok: false; reason: "not_found" | "invalid_items" | "constraint"; message?: string };

class PackageItemsError extends Error {}

async function replacePackageItems(client: PoolClient, vendorId: number, packageId: number, items: PackageItemInput[]) {
  const ids = items.map((i) => i.serviceId);
  const owned = await client.query(
    "SELECT id FROM services WHERE vendor_id = $1 AND id = ANY($2::int[]) AND kind IN ('unit','addon')",
    [vendorId, ids]
  );
  if (owned.rowCount !== new Set(ids).size) throw new PackageItemsError();
  await client.query("DELETE FROM package_items WHERE package_id = $1", [packageId]);
  await client.query(
    `INSERT INTO package_items (package_id, item_id, qty, note, sort_order)
     SELECT $1, i.item_id, i.qty, i.note, i.ord - 1
     FROM unnest($2::int[], $3::numeric[], $4::text[]) WITH ORDINALITY AS i(item_id, qty, note, ord)`,
    [packageId, ids, items.map((i) => i.qty), items.map((i) => i.note)]
  );
  await client.query("SELECT refresh_package_incomplete(ARRAY[$1::int])", [packageId]);
}

/**
 * Creates a package (kind='package', always sale_mode 'separate') from the
 * vendor's own units. Items from another vendor -> invalid_items (400).
 * categoryId defaults to the vendor's primary category.
 */
export async function createPackage(
  vendorId: number,
  fields: ParsedOfferingFields & { title: string },
  items: PackageItemInput[]
): Promise<PackageWriteResult> {
  try {
    const id = await withTransaction<number | null>(async (client) => {
      const v = await client.query<{ primary_category_id: number | null }>("SELECT primary_category_id FROM vendors WHERE id = $1", [
        vendorId,
      ]);
      if (!v.rowCount) return null;
      const f: ParsedOfferingFields = {
        priceUnit: "package",
        priceFrom: 0,
        ...fields,
        kind: "package",
        saleMode: "separate",
        templateId: null,
        parentServiceId: null,
        categoryId: fields.categoryId ?? v.rows[0].primary_category_id ?? undefined,
      };
      if (!f.categoryId) throw new PackageItemsError();
      const ins = offeringInsert(vendorId, f);
      const newId = (await client.query<{ id: number }>(ins.sql, ins.vals)).rows[0].id;
      await replacePackageItems(client, vendorId, newId, items);
      if (f.eventTypeIds) await setOfferingEventTypes(client, newId, f.eventTypeIds);
      await recomputeVendorPrice(vendorId, client);
      return newId;
    });
    if (id === null) return { ok: false, reason: "not_found" };
    const offering = (await findOwnOffering(vendorId, id))!;
    return { ok: true, offering, items: await findPackageItems([id]) };
  } catch (err) {
    if (err instanceof PackageItemsError) return { ok: false, reason: "invalid_items" };
    if (isCheckViolation(err)) return { ok: false, reason: "constraint", message: (err as Error).message };
    throw err;
  }
}

/** Updates a package's fields and (when `items` is given) replaces its items. */
export async function updatePackage(
  vendorId: number,
  packageId: number,
  fields: ParsedOfferingFields,
  items?: PackageItemInput[]
): Promise<PackageWriteResult> {
  try {
    const found = await withTransaction<boolean>(async (client) => {
      const cur = await client.query("SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2 AND kind = 'package' FOR UPDATE", [
        packageId,
        vendorId,
      ]);
      if (!cur.rowCount) return false;
      const u = offeringUpdate(fields, ["kind", "saleMode", "templateId", "parentServiceId"]);
      await client.query(`UPDATE services SET ${u.sets.join(", ")} WHERE id = $1`, [packageId, ...u.vals]);
      if (items) await replacePackageItems(client, vendorId, packageId, items);
      if (fields.eventTypeIds) await setOfferingEventTypes(client, packageId, fields.eventTypeIds);
      await recomputeVendorPrice(vendorId, client);
      return true;
    });
    if (!found) return { ok: false, reason: "not_found" };
    const offering = (await findOwnOffering(vendorId, packageId))!;
    return { ok: true, offering, items: await findPackageItems([packageId]) };
  } catch (err) {
    if (err instanceof PackageItemsError) return { ok: false, reason: "invalid_items" };
    if (isCheckViolation(err)) return { ok: false, reason: "constraint", message: (err as Error).message };
    throw err;
  }
}

/**
 * Quote-time check of the services a customer selected (P0-15): all must be
 * the vendor's active, public offerings (else INVALID_SERVICE); package-only
 * units without one of their selected packages and add-ons without their
 * selected parent are dropped; a selection with nothing sellable left is
 * PACKAGE_ONLY when package-only units were picked.
 */
export async function resolveEnquiryServices(
  vendorId: number,
  serviceIds: number[]
): Promise<{ ok: true; serviceIds: number[] } | { ok: false; code: "INVALID_SERVICE" | "PACKAGE_ONLY" }> {
  const unique = [...new Set(serviceIds)];
  if (!unique.length) return { ok: true, serviceIds: [] };
  const r = await pool.query<{ id: number; kind: string; sale_mode: string; parent_service_id: number | null }>(
    `SELECT id, kind, sale_mode, parent_service_id FROM services
     WHERE vendor_id = $1 AND id = ANY($2::int[]) AND active AND hidden_reason IS NULL
       AND NOT (kind = 'package' AND incomplete)`,
    [vendorId, unique]
  );
  if (r.rows.length !== unique.length) return { ok: false, code: "INVALID_SERVICE" };
  const selected = new Set(r.rows.map((x) => x.id));
  const packageIds = r.rows.filter((x) => x.kind === "package").map((x) => x.id);
  const inSelectedPackages = new Set((await findPackageItems(packageIds)).map((i) => i.item_id));
  const keep = r.rows.filter((x) => {
    if (x.kind === "addon") return x.parent_service_id != null && selected.has(x.parent_service_id);
    if (x.sale_mode === "package_only") return inSelectedPackages.has(x.id);
    return true;
  });
  const sellable = keep.filter((x) => x.kind !== "addon" && x.sale_mode !== "package_only");
  if (!sellable.length) {
    return { ok: false, code: r.rows.some((x) => x.sale_mode === "package_only") ? "PACKAGE_ONLY" : "INVALID_SERVICE" };
  }
  return { ok: true, serviceIds: keep.map((x) => x.id) };
}

// ---------------------------------------------------------------------------
// Media assets and albums
// ---------------------------------------------------------------------------

export type MediaKind = "image" | "video_file" | "video_link";
export type MediaStatus = "uploading" | "processing" | "pending_review" | "approved" | "rejected" | "hidden";
export type MediaPurpose = "gallery" | "logo" | "cover" | "poster";

export interface MediaAssetRecord {
  id: number;
  uuid: string;
  vendor_id: number;
  album_id: number | null;
  service_id: number | null;
  purpose: MediaPurpose;
  kind: MediaKind;
  storage_driver: string | null;
  storage_key: string | null;
  variants: Record<string, { key: string; w?: number; h?: number }>;
  external_url: string | null;
  external_provider: "youtube" | "instagram" | "vimeo" | null;
  external_id: string | null;
  poster_media_id: number | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  sha256: string | null;
  placeholder_color: string | null;
  caption: string;
  alt_text: string;
  status: MediaStatus;
  status_reason: string | null;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** New media from a live (approved) vendor is visible at once; otherwise it waits for review (4.5). */
export function initialMediaStatus(vendorStatus: string): MediaStatus {
  return vendorStatus === "approved" ? "approved" : "pending_review";
}

/**
 * A vendor's media. `publicOnly` = approved only (all an anonymous visitor may
 * ever see); otherwise everything except rows still uploading (unless
 * includeUploading).
 */
export async function findMediaByVendor(
  vendorId: number,
  opts: { publicOnly?: boolean; includeUploading?: boolean; albumId?: number; purpose?: MediaPurpose } = {}
): Promise<MediaAssetRecord[]> {
  const where = ["vendor_id = $1"];
  const values: unknown[] = [vendorId];
  if (opts.publicOnly) where.push("status = 'approved'");
  else if (!opts.includeUploading) where.push("status <> 'uploading'");
  if (opts.albumId) {
    values.push(opts.albumId);
    where.push(`album_id = $${values.length}`);
  }
  if (opts.purpose) {
    values.push(opts.purpose);
    where.push(`purpose = $${values.length}`);
  }
  const r = await pool.query<MediaAssetRecord>(
    `SELECT * FROM media_assets WHERE ${where.join(" AND ")} ORDER BY is_featured DESC, sort_order, id`,
    values
  );
  return r.rows;
}

/** Approved media of a publicly visible vendor only (profile gallery, search cards). */
export async function findPublicMediaByVendor(vendorId: number): Promise<MediaAssetRecord[]> {
  const r = await pool.query<MediaAssetRecord>(
    `SELECT m.* FROM media_assets m JOIN vendors v ON v.id = m.vendor_id
     WHERE m.vendor_id = $1 AND m.status = 'approved' AND v.status = 'approved' AND v.published
     ORDER BY m.is_featured DESC, m.sort_order, m.id`,
    [vendorId]
  );
  return r.rows;
}

/** One of the vendor's own media rows (null if it isn't theirs -> 404). */
export async function findOwnMedia(vendorId: number, mediaId: number): Promise<MediaAssetRecord | null> {
  const r = await pool.query<MediaAssetRecord>("SELECT * FROM media_assets WHERE id = $1 AND vendor_id = $2", [mediaId, vendorId]);
  return r.rows[0] ?? null;
}

export async function findMediaByUuid(uuid: string): Promise<MediaAssetRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;
  const r = await pool.query<MediaAssetRecord>("SELECT * FROM media_assets WHERE uuid = $1", [uuid]);
  return r.rows[0] ?? null;
}

/** Duplicate check for uploads (same file twice -> duplicate:true, one row). */
export async function findMediaBySha(vendorId: number, sha256: string): Promise<MediaAssetRecord | null> {
  const r = await pool.query<MediaAssetRecord>("SELECT * FROM media_assets WHERE vendor_id = $1 AND sha256 = $2 LIMIT 1", [
    vendorId,
    sha256,
  ]);
  return r.rows[0] ?? null;
}

/** Usage counted against plan limits (rejected rows don't count). */
export async function countMediaByVendor(
  vendorId: number
): Promise<{ images: number; videoFiles: number; videoLinks: number; albums: number }> {
  const r = await pool.query<{ images: number; video_files: number; video_links: number; albums: number }>(
    `SELECT COUNT(*) FILTER (WHERE kind = 'image' AND purpose <> 'poster')::int AS images,
            COUNT(*) FILTER (WHERE kind = 'video_file')::int AS video_files,
            COUNT(*) FILTER (WHERE kind = 'video_link')::int AS video_links,
            (SELECT COUNT(*)::int FROM media_albums WHERE vendor_id = $1) AS albums
     FROM media_assets WHERE vendor_id = $1 AND status <> 'rejected'`,
    [vendorId]
  );
  const x = r.rows[0];
  return { images: x.images, videoFiles: x.video_files, videoLinks: x.video_links, albums: x.albums };
}

export interface MediaInsert {
  kind: MediaKind;
  purpose?: MediaPurpose;
  status?: MediaStatus;
  storageDriver?: string | null;
  storageKey?: string | null;
  variants?: Record<string, unknown>;
  externalUrl?: string | null;
  externalProvider?: "youtube" | "instagram" | "vimeo" | null;
  externalId?: string | null;
  posterMediaId?: number | null;
  mime?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  sha256?: string | null;
  placeholderColor?: string | null;
  caption?: string;
  altText?: string;
  albumId?: number | null;
  serviceId?: number | null;
}

/**
 * Inserts a media row for the vendor (status defaults to 'uploading').
 * album / offering / poster ids that aren't the vendor's own become NULL.
 * Returns null on a duplicate sha256 for this vendor.
 */
export async function insertMediaAsset(vendorId: number, m: MediaInsert): Promise<MediaAssetRecord | null> {
  try {
    const r = await pool.query<MediaAssetRecord>(
      `INSERT INTO media_assets (vendor_id, kind, purpose, status, storage_driver, storage_key, variants,
         external_url, external_provider, external_id, poster_media_id, mime, bytes, width, height, duration_s,
         sha256, placeholder_color, caption, alt_text, album_id, service_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,
         (SELECT id FROM media_assets WHERE id = $11 AND vendor_id = $1),
         $12,$13,$14,$15,$16,$17,$18,$19,$20,
         (SELECT id FROM media_albums WHERE id = $21 AND vendor_id = $1),
         (SELECT id FROM services WHERE id = $22 AND vendor_id = $1),
         (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media_assets WHERE vendor_id = $1))
       RETURNING *`,
      [
        vendorId, m.kind, m.purpose ?? "gallery", m.status ?? "uploading", m.storageDriver ?? null, m.storageKey ?? null,
        JSON.stringify(m.variants ?? {}), m.externalUrl ?? null, m.externalProvider ?? null, m.externalId ?? null,
        m.posterMediaId ?? null, m.mime ?? null, m.bytes ?? null, m.width ?? null, m.height ?? null, m.durationS ?? null,
        m.sha256 ?? null, m.placeholderColor ?? null, m.caption ?? "", m.altText ?? "", m.albumId ?? null, m.serviceId ?? null,
      ]
    );
    return r.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export interface MediaPatch {
  caption?: string;
  altText?: string;
  albumId?: number | null;
  serviceId?: number | null;
  isFeatured?: boolean;
  sortOrder?: number;
  purpose?: MediaPurpose;
  /** Upload pipeline only (finalising an upload); never take these from a client body. */
  status?: MediaStatus;
  storageDriver?: string | null;
  storageKey?: string | null;
  variants?: Record<string, unknown>;
  mime?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  sha256?: string | null;
  placeholderColor?: string | null;
  posterMediaId?: number | null;
}

/**
 * Updates one of the vendor's media rows. null if it isn't theirs, the
 * album/offering isn't theirs, or a finalise would duplicate a sha256.
 */
export async function updateMediaAsset(vendorId: number, mediaId: number, p: MediaPatch): Promise<MediaAssetRecord | null> {
  if (p.albumId != null) {
    const a = await pool.query("SELECT 1 FROM media_albums WHERE id = $1 AND vendor_id = $2", [p.albumId, vendorId]);
    if (!a.rowCount) return null;
  }
  if (p.serviceId != null) {
    const s = await pool.query("SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2", [p.serviceId, vendorId]);
    if (!s.rowCount) return null;
  }
  const sets: string[] = [];
  const values: unknown[] = [mediaId, vendorId];
  const set = (col: string, v: unknown, expr?: (ph: string) => string) => {
    values.push(v);
    const ph = `$${values.length}`;
    sets.push(`${col} = ${expr ? expr(ph) : ph}`);
  };
  if (p.caption !== undefined) set("caption", p.caption);
  if (p.altText !== undefined) set("alt_text", p.altText);
  if (p.albumId !== undefined) set("album_id", p.albumId);
  if (p.serviceId !== undefined) set("service_id", p.serviceId);
  if (p.isFeatured !== undefined) set("is_featured", p.isFeatured);
  if (p.sortOrder !== undefined) set("sort_order", p.sortOrder);
  if (p.purpose !== undefined) set("purpose", p.purpose);
  if (p.status !== undefined) set("status", p.status);
  if (p.storageDriver !== undefined) set("storage_driver", p.storageDriver);
  if (p.storageKey !== undefined) set("storage_key", p.storageKey);
  if (p.variants !== undefined) set("variants", JSON.stringify(p.variants), (ph) => `${ph}::jsonb`);
  if (p.mime !== undefined) set("mime", p.mime);
  if (p.bytes !== undefined) set("bytes", p.bytes);
  if (p.width !== undefined) set("width", p.width);
  if (p.height !== undefined) set("height", p.height);
  if (p.durationS !== undefined) set("duration_s", p.durationS);
  if (p.sha256 !== undefined) set("sha256", p.sha256);
  if (p.placeholderColor !== undefined) set("placeholder_color", p.placeholderColor);
  if (p.posterMediaId !== undefined) {
    set("poster_media_id", p.posterMediaId, (ph) => `(SELECT id FROM media_assets WHERE id = ${ph} AND vendor_id = $2)`);
  }
  sets.push("updated_at = now()");
  try {
    const r = await pool.query<MediaAssetRecord>(
      `UPDATE media_assets SET ${sets.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
      values
    );
    return r.rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/**
 * Deletes one of the vendor's media rows and returns it, so the caller can
 * delete the stored files. If it was the logo/cover, the URL cache is cleared
 * too (the *_media_id FKs are SET NULL by the database).
 */
export async function deleteMediaAsset(vendorId: number, mediaId: number): Promise<MediaAssetRecord | null> {
  return withTransaction(async (client) => {
    const v = await client.query<{ logo_media_id: number | null; cover_media_id: number | null }>(
      "SELECT logo_media_id, cover_media_id FROM vendors WHERE id = $1 FOR UPDATE",
      [vendorId]
    );
    const r = await client.query<MediaAssetRecord>("DELETE FROM media_assets WHERE id = $1 AND vendor_id = $2 RETURNING *", [
      mediaId,
      vendorId,
    ]);
    const row = r.rows[0] ?? null;
    if (row && v.rows[0]) {
      if (v.rows[0].logo_media_id === mediaId) await client.query("UPDATE vendors SET logo_url = NULL WHERE id = $1", [vendorId]);
      if (v.rows[0].cover_media_id === mediaId) await client.query("UPDATE vendors SET cover_image_url = NULL WHERE id = $1", [vendorId]);
    }
    return row;
  });
}

/**
 * Sets (or with mediaId null clears) the vendor's logo or cover, writing the
 * logo_url / cover_image_url cache with `url` (the caller builds it with the
 * storage adapter). Only the vendor's own processed, non-rejected images
 * qualify; returns false otherwise.
 */
export async function setVendorMediaRole(
  vendorId: number,
  role: "logo" | "cover",
  mediaId: number | null,
  url: string | null
): Promise<boolean> {
  const idCol = role === "logo" ? "logo_media_id" : "cover_media_id";
  const urlCol = role === "logo" ? "logo_url" : "cover_image_url";
  if (mediaId === null) {
    await pool.query(`UPDATE vendors SET ${idCol} = NULL, ${urlCol} = NULL, updated_at = now() WHERE id = $1`, [vendorId]);
    return true;
  }
  const r = await pool.query(
    `UPDATE vendors SET ${idCol} = m.id, ${urlCol} = $3, updated_at = now()
     FROM media_assets m
     WHERE vendors.id = $1 AND m.id = $2 AND m.vendor_id = $1 AND m.kind = 'image'
       AND m.status IN ('pending_review','approved')`,
    [vendorId, mediaId, url]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Sets sort_order from the given id order (ids not owned by the vendor are ignored). */
export async function reorderMedia(vendorId: number, ids: number[]): Promise<void> {
  await pool.query(
    `UPDATE media_assets m SET sort_order = o.ord - 1, updated_at = now()
     FROM unnest($2::int[]) WITH ORDINALITY AS o(id, ord)
     WHERE m.id = o.id AND m.vendor_id = $1`,
    [vendorId, ids]
  );
}

export interface MediaAlbumRecord {
  id: number;
  vendor_id: number;
  service_id: number | null;
  title: string;
  description: string;
  event_type_id: number | null;
  event_date: string | null;
  district_id: number | null;
  venue_name: string | null;
  cover_media_id: number | null;
  consent_confirmed_at: string | null;
  published: boolean;
  sort_order: number;
  created_at: string;
  media_count: number;
}

export async function findAlbumsByVendor(vendorId: number, opts: { publicOnly?: boolean } = {}): Promise<MediaAlbumRecord[]> {
  const r = await pool.query<MediaAlbumRecord>(
    `SELECT a.id, a.vendor_id, a.service_id, a.title, a.description, a.event_type_id, a.event_date::text AS event_date,
            a.district_id, a.venue_name, a.cover_media_id, a.consent_confirmed_at, a.published, a.sort_order, a.created_at,
            (SELECT COUNT(*)::int FROM media_assets m WHERE m.album_id = a.id
               AND ${opts.publicOnly ? "m.status = 'approved'" : "m.status <> 'uploading'"}) AS media_count
     FROM media_albums a WHERE a.vendor_id = $1 ${opts.publicOnly ? "AND a.published" : ""}
     ORDER BY a.sort_order, a.id`,
    [vendorId]
  );
  return r.rows;
}

export interface AlbumFields {
  title?: string;
  description?: string;
  serviceId?: number | null;
  eventTypeId?: number | null;
  eventDate?: string | null;
  districtId?: number | null;
  venueName?: string | null;
  coverMediaId?: number | null;
  /** true stamps consent_confirmed_at (kept if already set); false clears it. */
  consentConfirmed?: boolean;
  published?: boolean;
  sortOrder?: number;
}

/** SET list for media_albums; $1 = album id, $2 = vendor id. Foreign ids must be the vendor's own. */
function albumSets(f: AlbumFields, values: unknown[]): string[] {
  const sets: string[] = [];
  const add = (col: string, v: unknown, expr?: (ph: string) => string) => {
    values.push(v);
    const ph = `$${values.length}`;
    sets.push(`${col} = ${expr ? expr(ph) : ph}`);
  };
  if (f.title !== undefined) add("title", f.title);
  if (f.description !== undefined) add("description", f.description);
  if (f.serviceId !== undefined) add("service_id", f.serviceId, (ph) => `(SELECT id FROM services WHERE id = ${ph} AND vendor_id = $2)`);
  if (f.eventTypeId !== undefined) add("event_type_id", f.eventTypeId, (ph) => `(SELECT id FROM event_types WHERE id = ${ph})`);
  if (f.eventDate !== undefined) add("event_date", f.eventDate, (ph) => `${ph}::date`);
  if (f.districtId !== undefined) add("district_id", f.districtId, (ph) => `(SELECT id FROM districts WHERE id = ${ph})`);
  if (f.venueName !== undefined) add("venue_name", f.venueName);
  if (f.coverMediaId !== undefined) {
    add("cover_media_id", f.coverMediaId, (ph) => `(SELECT id FROM media_assets WHERE id = ${ph} AND vendor_id = $2)`);
  }
  if (f.consentConfirmed !== undefined) {
    sets.push(`consent_confirmed_at = ${f.consentConfirmed ? "COALESCE(consent_confirmed_at, now())" : "NULL"}`);
  }
  if (f.published !== undefined) add("published", f.published);
  if (f.sortOrder !== undefined) add("sort_order", f.sortOrder);
  return sets;
}

export async function createAlbum(vendorId: number, f: AlbumFields & { title: string }): Promise<MediaAlbumRecord> {
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO media_albums (vendor_id, title, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM media_albums WHERE vendor_id = $1)) RETURNING id`,
    [vendorId, f.title]
  );
  const id = ins.rows[0].id;
  const values: unknown[] = [id, vendorId];
  const sets = albumSets({ ...f, title: undefined }, values);
  if (sets.length) await pool.query(`UPDATE media_albums SET ${sets.join(", ")} WHERE id = $1 AND vendor_id = $2`, values);
  return (await findAlbumsByVendor(vendorId)).find((a) => a.id === id)!;
}

export async function updateAlbum(vendorId: number, albumId: number, f: AlbumFields): Promise<MediaAlbumRecord | null> {
  const values: unknown[] = [albumId, vendorId];
  const sets = albumSets(f, values);
  if (sets.length) {
    const r = await pool.query(`UPDATE media_albums SET ${sets.join(", ")} WHERE id = $1 AND vendor_id = $2`, values);
    if (!r.rowCount) return null;
  }
  return (await findAlbumsByVendor(vendorId)).find((a) => a.id === albumId) ?? null;
}

/** Deletes an album; its media stay in the library (album_id SET NULL). */
export async function deleteAlbum(vendorId: number, albumId: number): Promise<boolean> {
  const r = await pool.query("DELETE FROM media_albums WHERE id = $1 AND vendor_id = $2", [albumId, vendorId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Leads (quote requests to the vendor) with the units the customer asked for
// ---------------------------------------------------------------------------

export interface LeadUnit {
  service_id: number;
  qty: string | null;
  note: string | null;
  /** Title / kind / price at request time (falls back to the live row for pre-004 leads). */
  title: string;
  kind: string | null;
  price_from: number | null;
  price_to: number | null;
  price_mode: string | null;
  price_unit: string | null;
  unit_label: string | null;
}

export interface VendorLeadRecord {
  id: number;
  name: string;
  phone: string;
  contact_email: string | null;
  preferred_contact: string;
  event_date: string | null;
  event_end_date: string | null;
  slot: string | null;
  event_type_id: number | null;
  event_type_name: string | null;
  district_id: number | null;
  district_name: string | null;
  venue_text: string | null;
  venue_type: string | null;
  guest_count: number | null;
  budget: string | null;
  budget_min: number | null;
  budget_max: number | null;
  food_pref: string | null;
  message: string | null;
  status: string;
  vendor_notes: string | null;
  follow_up_at: string | null;
  created_at: string;
  status_updated_at: string | null;
  units: LeadUnit[];
}

const LEAD_SELECT = `
  SELECT q.id, q.name, q.phone, q.contact_email, q.preferred_contact, q.event_date::text AS event_date,
         q.event_end_date::text AS event_end_date, q.slot,
         q.event_type_id, et.name AS event_type_name, q.district_id, d.name AS district_name,
         q.venue_text, q.venue_type, q.guest_count, q.budget, q.budget_min, q.budget_max, q.food_pref,
         q.message, q.status, q.vendor_notes, q.follow_up_at::text AS follow_up_at, q.created_at, q.status_updated_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'service_id', qs.service_id, 'qty', qs.qty, 'note', qs.note,
             'title', COALESCE(qs.snapshot->>'title', s.title),
             'kind', COALESCE(qs.snapshot->>'kind', s.kind),
             'price_from', COALESCE((qs.snapshot->>'price_from')::int, s.price_from),
             'price_to', COALESCE((qs.snapshot->>'price_to')::int, s.price_to),
             'price_mode', COALESCE(qs.snapshot->>'price_mode', s.price_mode),
             'price_unit', COALESCE(qs.snapshot->>'price_unit', s.price_unit),
             'unit_label', COALESCE(qs.snapshot->>'unit_label', s.unit_label))
             ORDER BY COALESCE(qs.snapshot->>'title', s.title))
           FROM quote_request_services qs JOIN services s ON s.id = qs.service_id
           WHERE qs.quote_request_id = q.id), '[]'::json) AS units
  FROM quote_requests q
  LEFT JOIN event_types et ON et.id = q.event_type_id
  LEFT JOIN districts d ON d.id = q.district_id`;

export interface LeadFilters {
  status?: string;
  /** event_date >= (YYYY-MM-DD) */
  from?: string;
  /** event_date <= (YYYY-MM-DD) */
  to?: string;
  districtId?: number;
  serviceId?: number;
  limit?: number;
  offset?: number;
}

export async function findLeadsByVendor(vendorId: number, f: LeadFilters = {}): Promise<VendorLeadRecord[]> {
  const where = ["q.vendor_id = $1"];
  const values: unknown[] = [vendorId];
  const add = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (f.status) where.push(`q.status = ${add(f.status)}`);
  if (f.from) where.push(`q.event_date >= ${add(f.from)}::date`);
  if (f.to) where.push(`q.event_date <= ${add(f.to)}::date`);
  if (f.districtId) where.push(`q.district_id = ${add(f.districtId)}`);
  if (f.serviceId) {
    where.push(`EXISTS (SELECT 1 FROM quote_request_services x WHERE x.quote_request_id = q.id AND x.service_id = ${add(f.serviceId)})`);
  }
  const limit = add(Math.min(Math.max(1, Math.trunc(f.limit ?? 100)), 200));
  const offset = add(Math.max(0, Math.trunc(f.offset ?? 0)));
  const r = await pool.query<VendorLeadRecord>(
    `${LEAD_SELECT} WHERE ${where.join(" AND ")} ORDER BY q.created_at DESC, q.id DESC LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  return r.rows;
}

/** One of the vendor's leads (null if it was sent to another vendor -> 404). */
export async function findVendorLead(vendorId: number, leadId: number): Promise<VendorLeadRecord | null> {
  const r = await pool.query<VendorLeadRecord>(`${LEAD_SELECT} WHERE q.id = $1 AND q.vendor_id = $2`, [leadId, vendorId]);
  return r.rows[0] ?? null;
}

export const VENDOR_LEAD_STATUSES = ["pending", "responded", "booked", "declined"] as const;

/**
 * Vendor-side lead update: status (records quote_status_events; 'booked'
 * upserts vendor_availability for the event date, un-booking frees it),
 * private notes, follow-up date. null if the lead isn't the vendor's.
 */
export async function updateVendorLead(
  vendorId: number,
  leadId: number,
  userId: number,
  p: { status?: (typeof VENDOR_LEAD_STATUSES)[number]; vendorNotes?: string | null; followUpAt?: string | null }
): Promise<VendorLeadRecord | null> {
  const ok = await withTransaction(async (client) => {
    const cur = await client.query<{ status: string; event_date: string | null; slot: string | null }>(
      "SELECT status, event_date::text AS event_date, slot FROM quote_requests WHERE id = $1 AND vendor_id = $2 FOR UPDATE",
      [leadId, vendorId]
    );
    const old = cur.rows[0];
    if (!old) return false;
    const changed = p.status !== undefined && p.status !== old.status;
    const sets: string[] = [];
    const values: unknown[] = [leadId];
    if (p.vendorNotes !== undefined) {
      values.push(p.vendorNotes);
      sets.push(`vendor_notes = $${values.length}`);
    }
    if (p.followUpAt !== undefined) {
      values.push(p.followUpAt);
      sets.push(`follow_up_at = $${values.length}::date`);
    }
    if (changed) {
      values.push(p.status);
      sets.push(`status = $${values.length}`, "status_updated_at = now()");
    }
    if (sets.length) await client.query(`UPDATE quote_requests SET ${sets.join(", ")} WHERE id = $1`, values);
    if (!changed) return true;

    await client.query("INSERT INTO quote_status_events (quote_id, from_status, to_status, changed_by) VALUES ($1,$2,$3,$4)", [
      leadId,
      old.status,
      p.status,
      userId,
    ]);
    if (!old.event_date) return true;
    const slot = old.slot ?? "full";
    if (p.status === "booked") {
      await client.query(
        `INSERT INTO vendor_availability (vendor_id, date, slot, status, quote_request_id, source, capacity_total, capacity_used)
         SELECT $1, $2::date, $3, CASE WHEN v.max_events_per_day <= 1 THEN 'booked' ELSE 'limited' END,
                $4, 'booking', v.max_events_per_day, 1
         FROM vendors v WHERE v.id = $1
         ON CONFLICT (vendor_id, date, slot) DO UPDATE SET
           capacity_used = LEAST(vendor_availability.capacity_used + 1, vendor_availability.capacity_total),
           status = CASE WHEN vendor_availability.capacity_used + 1 >= vendor_availability.capacity_total
                         THEN 'booked' ELSE 'limited' END,
           quote_request_id = COALESCE(vendor_availability.quote_request_id, EXCLUDED.quote_request_id),
           updated_at = now()`,
        [vendorId, old.event_date, slot, leadId]
      );
    } else if (old.status === "booked") {
      // Un-booking frees the slot again (booking-sourced rows only; manual blocks stay).
      await client.query(
        `UPDATE vendor_availability SET capacity_used = GREATEST(capacity_used - 1, 0), status = 'limited', updated_at = now()
         WHERE vendor_id = $1 AND date = $2::date AND slot = $3 AND source = 'booking'`,
        [vendorId, old.event_date, slot]
      );
      await client.query(
        `DELETE FROM vendor_availability
         WHERE vendor_id = $1 AND date = $2::date AND slot = $3 AND source = 'booking' AND capacity_used = 0`,
        [vendorId, old.event_date, slot]
      );
    }
    return true;
  });
  return ok ? findVendorLead(vendorId, leadId) : null;
}

/**
 * Writes the requested units of an enquiry with a snapshot of each offering
 * (title / kind / price / unit at request time), so the lead keeps saying what
 * was asked after the vendor edits the offering. Ids not owned by the vendor
 * are ignored. Pass a transaction client to run inside createQuoteRequest's
 * transaction.
 */
export async function addLeadUnits(
  quoteId: number,
  vendorId: number,
  units: { serviceId: number; qty?: number | null; note?: string | null }[],
  client: Queryable = pool
): Promise<void> {
  if (!units.length) return;
  await client.query(
    `INSERT INTO quote_request_services (quote_request_id, service_id, qty, note, snapshot)
     SELECT $1, s.id, u.qty, NULLIF(u.note, ''),
            jsonb_build_object('title', s.title, 'kind', s.kind, 'category_id', s.category_id,
              'price_from', s.price_from, 'price_to', s.price_to, 'price_mode', s.price_mode,
              'price_unit', s.price_unit, 'unit_label', s.unit_label)
     FROM unnest($3::int[], $4::numeric[], $5::text[]) AS u(service_id, qty, note)
     JOIN services s ON s.id = u.service_id AND s.vendor_id = $2
     ON CONFLICT (quote_request_id, service_id) DO UPDATE SET
       qty = EXCLUDED.qty, note = EXCLUDED.note, snapshot = EXCLUDED.snapshot`,
    [quoteId, vendorId, units.map((u) => u.serviceId), units.map((u) => u.qty ?? null), units.map((u) => u.note ?? null)]
  );
}

// ---------------------------------------------------------------------------
// Vendor home (/vendor) aggregates. Vendor data only: no customer favourites
// or "my requests" are queried here (P0-12 AC).
// ---------------------------------------------------------------------------

export interface VendorHomeStats {
  status: VendorStatus;
  statusReason: string | null;
  onboardingStep: number;
  onboardingCompleted: boolean;
  rereviewRequired: boolean;
  leads: { new: number; total: number; last7Days: number; booked: number; followUpsDue: number };
  upcoming: { id: number; name: string; event_date: string; event_type_name: string | null; guest_count: number | null }[];
  recentLeads: { id: number; name: string; event_date: string | null; status: string; created_at: string; units: string[] }[];
  offerings: { active: number; pricedSeparate: number; packages: number; incompletePackages: number };
  media: { images: number; videos: number; pendingReview: number; hasLogo: boolean; hasCover: boolean };
  serviceAreas: number;
  last7Days: { profileViews: number; whatsappClicks: number; phoneReveals: number };
  rating: { average: number; count: number };
  /** Profile-strength checklist inputs (the UI turns them into a percentage). */
  checklist: Record<"basics" | "about" | "logo" | "cover" | "images" | "offering" | "areas" | "languages", boolean>;
}

export async function findVendorHomeStats(vendorId: number): Promise<VendorHomeStats | null> {
  const v = await pool.query<VendorRecord>("SELECT * FROM vendors WHERE id = $1", [vendorId]);
  const vendor = v.rows[0];
  if (!vendor) return null;
  const [leads, upcoming, recent, offerings, media, areas, events] = await Promise.all([
    pool.query<{ new: number; total: number; last7: number; booked: number; follow: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS new, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7,
              COUNT(*) FILTER (WHERE status = 'booked')::int AS booked,
              COUNT(*) FILTER (WHERE follow_up_at <= current_date AND status IN ('pending','responded'))::int AS follow
       FROM quote_requests WHERE vendor_id = $1`,
      [vendorId]
    ),
    pool.query<VendorHomeStats["upcoming"][number]>(
      `SELECT q.id, q.name, q.event_date::text AS event_date, et.name AS event_type_name, q.guest_count
       FROM quote_requests q LEFT JOIN event_types et ON et.id = q.event_type_id
       WHERE q.vendor_id = $1 AND q.status = 'booked' AND q.event_date >= current_date
       ORDER BY q.event_date LIMIT 5`,
      [vendorId]
    ),
    pool.query<VendorHomeStats["recentLeads"][number]>(
      `SELECT q.id, q.name, q.event_date::text AS event_date, q.status, q.created_at,
              COALESCE((SELECT array_agg(COALESCE(qs.snapshot->>'title', s.title) ORDER BY s.title)
                        FROM quote_request_services qs JOIN services s ON s.id = qs.service_id
                        WHERE qs.quote_request_id = q.id), '{}') AS units
       FROM quote_requests q WHERE q.vendor_id = $1 ORDER BY q.created_at DESC LIMIT 5`,
      [vendorId]
    ),
    pool.query<{ active: number; priced: number; packages: number; incomplete: number }>(
      `SELECT COUNT(*) FILTER (WHERE active)::int AS active,
              COUNT(*) FILTER (WHERE active AND sale_mode = 'separate' AND kind IN ('unit','package') AND NOT incomplete
                               AND hidden_reason IS NULL AND (price_mode = 'on_request' OR price_from > 0))::int AS priced,
              COUNT(*) FILTER (WHERE active AND kind = 'package')::int AS packages,
              COUNT(*) FILTER (WHERE active AND kind = 'package' AND incomplete)::int AS incomplete
       FROM services WHERE vendor_id = $1`,
      [vendorId]
    ),
    pool.query<{ images: number; videos: number; pending: number }>(
      `SELECT COUNT(*) FILTER (WHERE kind = 'image' AND status IN ('approved','pending_review'))::int AS images,
              COUNT(*) FILTER (WHERE kind <> 'image' AND status IN ('approved','pending_review'))::int AS videos,
              COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending
       FROM media_assets WHERE vendor_id = $1`,
      [vendorId]
    ),
    pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM vendor_service_areas WHERE vendor_id = $1", [vendorId]),
    pool.query<{ views: number; wa: number; phone: number }>(
      `SELECT COUNT(*) FILTER (WHERE kind = 'profile_view')::int AS views,
              COUNT(*) FILTER (WHERE kind = 'whatsapp_click')::int AS wa,
              COUNT(*) FILTER (WHERE kind = 'phone_reveal')::int AS phone
       FROM vendor_events WHERE vendor_id = $1 AND created_at >= now() - interval '7 days'`,
      [vendorId]
    ),
  ]);
  const l = leads.rows[0];
  const o = offerings.rows[0];
  const m = media.rows[0];
  const hasLogo = vendor.logo_media_id != null || !!vendor.logo_url;
  const hasCover = vendor.cover_media_id != null || !!vendor.cover_image_url;
  return {
    status: vendor.status,
    statusReason: vendor.status_reason ?? null,
    onboardingStep: vendor.onboarding_step ?? 1,
    onboardingCompleted: !!vendor.onboarding_completed_at,
    rereviewRequired: !!vendor.rereview_required,
    leads: { new: l.new, total: l.total, last7Days: l.last7, booked: l.booked, followUpsDue: l.follow },
    upcoming: upcoming.rows,
    recentLeads: recent.rows,
    offerings: { active: o.active, pricedSeparate: o.priced, packages: o.packages, incompletePackages: o.incomplete },
    media: { images: m.images, videos: m.videos, pendingReview: m.pending, hasLogo, hasCover },
    serviceAreas: areas.rows[0].n,
    last7Days: { profileViews: events.rows[0].views, whatsappClicks: events.rows[0].wa, phoneReveals: events.rows[0].phone },
    rating: { average: Number(vendor.rating), count: vendor.reviews_count },
    checklist: {
      basics: !!(vendor.name && vendor.primary_category_id && vendor.district_id && vendor.phone),
      about: (vendor.about ?? "").trim().length >= 30,
      logo: hasLogo,
      cover: hasCover,
      images: m.images >= SUBMIT_MIN_IMAGES,
      offering: o.priced > 0,
      areas: areas.rows[0].n > 0,
      languages: (vendor.languages ?? []).length > 0,
    },
  };
}
