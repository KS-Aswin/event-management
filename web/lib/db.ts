import { Pool } from "pg";

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
  status: "pending" | "approved" | "rejected";
  published?: boolean;
}

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
      await client.query(
        `INSERT INTO quote_request_services (quote_request_id, service_id)
         SELECT $1, s.id FROM services s
         WHERE s.vendor_id = $2 AND s.id = ANY($3::int[])
         ON CONFLICT DO NOTHING`,
        [quote.id, params.vendorId, serviceIds]
      );
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
}): Promise<VendorRecord | null> {
  const districtId = params.districtId ?? (await districtIdForLocation(params.location));
  // The vendor and its first service are created together in one statement
  // (a data-modifying CTE), so a listing never exists without a service.
  try {
    const result = await pool.query<VendorRecord>(
      `WITH new_vendor AS (
         INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, tags, about, rating, reviews_count, district_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10)
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
         location = COALESCE($5, location),
         price = COALESCE($6, price),
         price_label = COALESCE($7, price_label),
         experience = COALESCE($8, experience),
         tags = COALESCE($9, tags),
         about = COALESCE($10, about),
         district_id = COALESCE($11, district_id)
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
    "SELECT name FROM categories ORDER BY sort_order, name"
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
