-- Vela database schema
-- Apply with: psql "$DATABASE_URL" -f db/schema.sql
-- (or: npm run db:migrate, which runs this file)

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'vendor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Notification preferences, added for the Settings page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN NOT NULL DEFAULT false;

-- Vendors. `owner_id` links a listing to the user account that manages it
-- (nullable for now, since we seed sample vendors that don't have a real
-- owner account yet — a vendor claiming/creating their own listing is a
-- later feature).
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  price INTEGER NOT NULL,
  price_label TEXT NOT NULL,
  rating NUMERIC(2,1) NOT NULL DEFAULT 0,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  experience TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  about TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors (category);
CREATE INDEX IF NOT EXISTS idx_vendors_location ON vendors (location);
CREATE INDEX IF NOT EXISTS idx_vendors_owner ON vendors (owner_id);

-- In case this ran before `published` existed:
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor ON vendor_reviews (vendor_id);

CREATE TABLE IF NOT EXISTS quote_requests (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  event_date DATE,
  budget TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_vendor ON quote_requests (vendor_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_customer ON quote_requests (customer_id);

-- Links a review to the real account that wrote it. Nullable because the
-- seeded sample reviews (see db/seed.mjs) don't correspond to real users.
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- One review per customer per vendor. Partial index (WHERE customer_id IS
-- NOT NULL) so the NULL-customer_id seed rows don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendor_review_per_customer
  ON vendor_reviews (vendor_id, customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_customer ON favorites (customer_id);



