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
       email = COALESCE($3, email),
       email_notifications = COALESCE($4, email_notifications),
       sms_notifications = COALESCE($5, sms_notifications)
     WHERE id = $1
     RETURNING *`,
    [id, fields.name ?? null, fields.email ?? null, fields.emailNotifications ?? null, fields.smsNotifications ?? null]
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
  created_at: string;
  // Profile fields added in migration 002.
  vendor_type: "company" | "individual";
  district_id: number | null;
  phone: string | null;
  whatsapp: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  status: "pending" | "approved" | "rejected";
}

export interface VendorFilters {
  query?: string;
  categories?: string[];
  location?: string;
  minRating?: number;
  sort?: "rating" | "reviews" | "priceLow" | "priceHigh";
}

export async function findVendors(filters: VendorFilters): Promise<VendorRecord[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.query) {
    values.push(`%${filters.query.toLowerCase()}%`);
    clauses.push(
      `(LOWER(name) LIKE $${values.length} OR LOWER(category) LIKE $${values.length} OR LOWER(location) LIKE $${values.length} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE $${values.length}))`
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

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const sortMap: Record<string, string> = {
    rating: "rating DESC",
    reviews: "reviews_count DESC",
    priceLow: "price ASC",
    priceHigh: "price DESC",
  };
  const orderBy = sortMap[filters.sort ?? "rating"] ?? sortMap.rating;

  const result = await pool.query<VendorRecord>(
    `SELECT * FROM vendors ${where} ORDER BY ${orderBy}`,
    values
  );
  return result.rows;
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
    "SELECT DISTINCT location FROM vendors ORDER BY location"
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
  experience: string;
  tags: string[];
  about: string;
}): Promise<VendorRecord> {
  // The vendor and its first service are created together in one statement
  // (a data-modifying CTE), so a listing never exists without a service.
  const result = await pool.query<VendorRecord>(
    `WITH new_vendor AS (
       INSERT INTO vendors (owner_id, name, category, location, price, price_label, experience, tags, about, rating, reviews_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0)
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
       about = COALESCE($10, about)
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
    ]
  );
  return result.rows[0] ?? null;
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
  const result = await pool.query<LeadRecord>(
    `UPDATE quote_requests q
     SET status = $3
     FROM vendors v
     WHERE q.id = $1
       AND q.vendor_id = v.id
       AND v.owner_id = $2
     RETURNING q.id, q.name, q.phone, q.event_date, q.budget, q.message, q.status, q.created_at`,
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
  const like = `%${query.toLowerCase()}%`;

  const [locationsRes, vendorsRes] = await Promise.all([
    pool.query<{ location: string }>(
      "SELECT DISTINCT location FROM vendors WHERE LOWER(location) LIKE $1 ORDER BY location LIMIT 5",
      [like]
    ),
    pool.query<{ id: number; name: string; category: string }>(
      "SELECT id, name, category FROM vendors WHERE LOWER(name) LIKE $1 ORDER BY rating DESC LIMIT 5",
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
