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
  return new Pool({ connectionString });
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
  email_verified: boolean;
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
): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `UPDATE users SET
       name = COALESCE($2, name),
       email_verified = CASE WHEN $3::text IS NOT NULL AND $3::text <> email THEN false ELSE email_verified END,
       email = COALESCE($3::text, email),
       email_notifications = COALESCE($4, email_notifications),
       sms_notifications = COALESCE($5, sms_notifications)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fields.name ?? null,
      // Always stored lowercase so it matches findUserByEmail's lookup.
      fields.email ? fields.email.toLowerCase().trim() : null,
      fields.emailNotifications ?? null,
      fields.smsNotifications ?? null,
    ]
  );
  return result.rows[0];
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
  published: boolean;
  verified: boolean;
  featured: boolean;
  price_unit: string;
  created_at: string;
}

export const PRICE_UNITS = ["onwards", "per plate", "per event", "per day"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export function buildPriceLabel(price: number, unit: string): string {
  return `₹${price.toLocaleString("en-IN")} ${unit}`;
}

export interface VendorFilters {
  query?: string;
  categories?: string[];
  location?: string;
  minRating?: number;
  sort?: "rating" | "reviews" | "priceLow" | "priceHigh" | "trending";
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 12;

function escapeLike(input: string): string {
  // Escape LIKE wildcards so a search for "100%" doesn't match everything.
  return input.replace(/[\\%_]/g, "\\$&");
}

export async function findVendors(
  filters: VendorFilters
): Promise<{ vendors: VendorRecord[]; total: number }> {
  const clauses: string[] = ["published = true"];
  const values: unknown[] = [];

  if (filters.query) {
    values.push(`%${escapeLike(filters.query.toLowerCase())}%`);
    const p = `$${values.length}`;
    clauses.push(
      `(LOWER(name) LIKE ${p} ESCAPE '\\' OR LOWER(category) LIKE ${p} ESCAPE '\\' OR LOWER(location) LIKE ${p} ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE ${p} ESCAPE '\\'))`
    );
  }
  if (filters.categories && filters.categories.length > 0) {
    values.push(filters.categories);
    clauses.push(`category = ANY($${values.length})`);
  }
  if (filters.location) {
    values.push(filters.location);
    clauses.push(`location = $${values.length}`);
  }
  if (filters.minRating) {
    values.push(filters.minRating);
    clauses.push(`rating >= $${values.length}`);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;

  // Trending = recent leads (weighted) + recent profile views.
  const trendingScore = `(
    (SELECT COUNT(*) FROM quote_requests q WHERE q.vendor_id = vendors.id AND q.created_at > now() - interval '30 days') * 5
    + (SELECT COUNT(*) FROM vendor_views w WHERE w.vendor_id = vendors.id AND w.created_at > now() - interval '30 days')
  ) DESC, rating DESC`;
  const sortMap: Record<string, string> = {
    // Paid "featured" vendors float to the top of the default sort only.
    rating: "featured DESC, rating DESC",
    reviews: "reviews_count DESC",
    priceLow: "price ASC",
    priceHigh: "price DESC",
    trending: trendingScore,
  };
  const orderBy = sortMap[filters.sort ?? "rating"] ?? sortMap.rating;

  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), 50);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const [rowsRes, countRes] = await Promise.all([
    pool.query<VendorRecord>(
      `SELECT * FROM vendors ${where} ORDER BY ${orderBy}, id ASC LIMIT ${pageSize} OFFSET ${offset}`,
      values
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM vendors ${where}`, values),
  ]);
  return { vendors: rowsRes.rows, total: parseInt(countRes.rows[0].count, 10) };
}

export async function findVendorById(id: number): Promise<VendorRecord | null> {
  const result = await pool.query<VendorRecord>(
    "SELECT * FROM vendors WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findAllLocations(): Promise<string[]> {
  const result = await pool.query<{ location: string }>(
    "SELECT DISTINCT location FROM vendors WHERE published = true ORDER BY location"
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
}

export async function findReviewsByVendor(vendorId: number): Promise<ReviewRecord[]> {
  const result = await pool.query<ReviewRecord>(
    "SELECT * FROM vendor_reviews WHERE vendor_id = $1 ORDER BY created_at DESC",
    [vendorId]
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
}) {
  const result = await pool.query(
    `INSERT INTO quote_requests (vendor_id, customer_id, name, phone, event_date, budget, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [params.vendorId, params.customerId, params.name, params.phone, params.eventDate, params.budget, params.message]
  );
  return result.rows[0];
}

export async function findVendorByOwner(ownerId: number): Promise<VendorRecord | null> {
  const result = await pool.query<VendorRecord>(
    "SELECT * FROM vendors WHERE owner_id = $1 LIMIT 1",
    [ownerId]
  );
  return result.rows[0] ?? null;
}

export async function createVendorListing(params: {
  ownerId: number;
  name: string;
  category: string;
  location: string;
  price: number;
  priceLabel: string;
  priceUnit: string;
  experience: string;
  tags: string[];
  about: string;
}): Promise<VendorRecord> {
  const result = await pool.query<VendorRecord>(
    `INSERT INTO vendors (owner_id, name, category, location, price, price_label, price_unit, experience, tags, about, rating, reviews_count)
     VALUES ($1,$2,$3,$4,$5,$6,$10,$7,$8,$9,0,0)
     RETURNING *`,
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
      params.priceUnit,
    ]
  );
  return result.rows[0];
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
            q.name, q.phone, to_char(q.event_date, 'YYYY-MM-DD') AS event_date, q.budget, q.message, q.status, q.created_at
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
  customer_id: number | null;
  name: string;
  phone: string;
  event_date: string | null;
  budget: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

export async function findQuoteRequestsByVendor(vendorId: number): Promise<LeadRecord[]> {
  const result = await pool.query<LeadRecord>(
    `SELECT id, customer_id, name, phone, to_char(event_date, 'YYYY-MM-DD') AS event_date, budget, message, status, created_at
     FROM quote_requests
     WHERE vendor_id = $1
     ORDER BY created_at DESC`,
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
    priceUnit?: string;
    experience?: string;
    tags?: string[];
    about?: string;
  }
): Promise<VendorRecord | null> {
  // The ownerId check is done in the same query (WHERE owner_id = $X) rather
  // than as a separate lookup, so there's no window where a caller could
  // race between "check ownership" and "perform update" — the update simply
  // can't match a row that isn't theirs.
  const result = await pool.query<VendorRecord>(
    `UPDATE vendors SET
       name = COALESCE($3, name),
       category = COALESCE($4, category),
       location = COALESCE($5, location),
       price = COALESCE($6, price),
       price_label = COALESCE($7, price_label),
       experience = COALESCE($8, experience),
       tags = COALESCE($9, tags),
       about = COALESCE($10, about),
       price_unit = COALESCE($11, price_unit)
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
      fields.priceUnit ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

export const QUOTE_STATUSES = ["pending", "responded", "booked", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface LeadWithVendor extends LeadRecord {
  vendor_id: number;
  vendor_name: string;
}

export async function updateQuoteStatus(
  quoteId: number,
  ownerId: number,
  status: QuoteStatus
): Promise<LeadWithVendor | null> {
  // Same pattern as updateVendorListing: the ownership check is baked into
  // the WHERE clause (via a join back to vendors.owner_id) instead of done
  // as a separate query, so a vendor can only ever update the status of a
  // quote request that was actually sent to their own listing.
  const result = await pool.query<LeadWithVendor>(
    `UPDATE quote_requests q
     SET status = $3
     FROM vendors v
     WHERE q.id = $1
       AND q.vendor_id = v.id
       AND v.owner_id = $2
     RETURNING q.id, q.customer_id, q.name, q.phone, to_char(q.event_date, 'YYYY-MM-DD') AS event_date, q.budget, q.message, q.status, q.created_at,
               q.vendor_id, v.name AS vendor_name`,
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
      const insertRes = await client.query<ReviewRecord>(
        `INSERT INTO vendor_reviews (vendor_id, customer_id, reviewer_name, rating, body)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
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

    // Recompute the vendor's aggregate rating from every review that now
    // exists, rather than trying to incrementally adjust a running average
    // (which is easy to get subtly wrong). This table won't have enough
    // rows for a full recompute to be a performance concern.
    await client.query(
      `UPDATE vendors SET
         rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM vendor_reviews WHERE vendor_id = $1),
         reviews_count = (SELECT COUNT(*) FROM vendor_reviews WHERE vendor_id = $1)
       WHERE id = $1`,
      [params.vendorId]
    );

    await client.query("COMMIT");
    return { ok: true, review: reviewRow };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
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
     WHERE f.customer_id = $1
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
  const like = `%${escapeLike(query.toLowerCase())}%`;

  const [locationsRes, vendorsRes] = await Promise.all([
    pool.query<{ location: string }>(
      "SELECT DISTINCT location FROM vendors WHERE published = true AND LOWER(location) LIKE $1 ESCAPE '\\' ORDER BY location LIMIT 5",
      [like]
    ),
    pool.query<{ id: number; name: string; category: string }>(
      "SELECT id, name, category FROM vendors WHERE published = true AND LOWER(name) LIKE $1 ESCAPE '\\' ORDER BY rating DESC LIMIT 5",
      [like]
    ),
  ]);

  return {
    locations: locationsRes.rows.map((r) => r.location),
    vendors: vendorsRes.rows,
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
}

export async function markEmailVerified(userId: number): Promise<void> {
  await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [userId]);
}

// Deletes the account and the vendor listing it owns (listing, packages,
// portfolio, leads and views go with it via ON DELETE CASCADE). Reviews the
// user wrote stay, but are detached from the account.
export async function deleteUserAccount(userId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM vendors WHERE owner_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Vendor analytics, discovery and recommendations
// ---------------------------------------------------------------------------

export async function recordVendorView(vendorId: number, viewerId: number | null): Promise<void> {
  await pool.query("INSERT INTO vendor_views (vendor_id, viewer_id) VALUES ($1, $2)", [
    vendorId,
    viewerId,
  ]);
}

export interface VendorStats {
  views30: number;
  leads: number;
  pending: number;
  booked: number;
}

export async function getVendorStats(vendorId: number): Promise<VendorStats> {
  const result = await pool.query<{
    views30: string;
    leads: string;
    pending: string;
    booked: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM vendor_views WHERE vendor_id = $1 AND created_at > now() - interval '30 days') AS views30,
       (SELECT COUNT(*) FROM quote_requests WHERE vendor_id = $1) AS leads,
       (SELECT COUNT(*) FROM quote_requests WHERE vendor_id = $1 AND status = 'pending') AS pending,
       (SELECT COUNT(*) FROM quote_requests WHERE vendor_id = $1 AND status = 'booked') AS booked`,
    [vendorId]
  );
  const r = result.rows[0];
  return {
    views30: parseInt(r.views30, 10),
    leads: parseInt(r.leads, 10),
    pending: parseInt(r.pending, 10),
    booked: parseInt(r.booked, 10),
  };
}

export async function findFeaturedVendors(limit: number): Promise<VendorRecord[]> {
  const result = await pool.query<VendorRecord>(
    `SELECT * FROM vendors WHERE published = true AND featured = true
     ORDER BY rating DESC, id ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// "Complete your event": the best-rated vendor in each category the customer
// hasn't contacted or saved yet. Simple rule-based suggestions (no AI).
export async function findRecommendations(customerId: number, limit: number): Promise<VendorRecord[]> {
  const result = await pool.query<VendorRecord>(
    `SELECT * FROM (
       SELECT DISTINCT ON (v.category) v.*
       FROM vendors v
       WHERE v.published = true
         AND (v.owner_id IS NULL OR v.owner_id <> $1)
         AND v.category NOT IN (
           SELECT v2.category FROM quote_requests q JOIN vendors v2 ON v2.id = q.vendor_id WHERE q.customer_id = $1
           UNION
           SELECT v3.category FROM favorites f JOIN vendors v3 ON v3.id = f.vendor_id WHERE f.customer_id = $1
         )
       ORDER BY v.category, v.featured DESC, v.rating DESC
     ) t
     ORDER BY featured DESC, rating DESC
     LIMIT $2`,
    [customerId, limit]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function findAllVendorsForAdmin(): Promise<VendorRecord[]> {
  const result = await pool.query<VendorRecord>(
    "SELECT * FROM vendors ORDER BY created_at DESC, id DESC"
  );
  return result.rows;
}

export async function setVendorFlags(
  vendorId: number,
  flags: { verified?: boolean; featured?: boolean; published?: boolean }
): Promise<VendorRecord | null> {
  const result = await pool.query<VendorRecord>(
    `UPDATE vendors SET
       verified = COALESCE($2, verified),
       featured = COALESCE($3, featured),
       published = COALESCE($4, published)
     WHERE id = $1
     RETURNING *`,
    [vendorId, flags.verified ?? null, flags.featured ?? null, flags.published ?? null]
  );
  return result.rows[0] ?? null;
}

export interface AdminStats {
  users: number;
  vendors: number;
  quotes: number;
  reviews: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const result = await pool.query<{ users: string; vendors: string; quotes: string; reviews: string }>(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM vendors) AS vendors,
       (SELECT COUNT(*) FROM quote_requests) AS quotes,
       (SELECT COUNT(*) FROM vendor_reviews) AS reviews`
  );
  const r = result.rows[0];
  return {
    users: parseInt(r.users, 10),
    vendors: parseInt(r.vendors, 10),
    quotes: parseInt(r.quotes, 10),
    reviews: parseInt(r.reviews, 10),
  };
}
