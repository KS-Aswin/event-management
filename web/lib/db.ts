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

export type UserRole = "customer" | "vendor";

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
