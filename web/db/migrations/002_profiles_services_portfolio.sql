-- Migration 002: Kerala-first profiles, services, portfolio, districts, categories.
-- Additive only: existing tables and columns keep working.

-- Admin role (used from the admin dashboard phase onwards).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';

DO $$ BEGIN
  CREATE TYPE vendor_type AS ENUM ('company', 'individual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE vendor_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE media_type AS ENUM ('image', 'video_link');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Districts. `state` lets us add more states later as data, not code.
CREATE TABLE IF NOT EXISTS districts (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'Kerala',
  name TEXT NOT NULL,
  UNIQUE (state, name)
);

INSERT INTO districts (state, name) VALUES
  ('Kerala', 'Thiruvananthapuram'), ('Kerala', 'Kollam'), ('Kerala', 'Pathanamthitta'),
  ('Kerala', 'Alappuzha'), ('Kerala', 'Kottayam'), ('Kerala', 'Idukki'),
  ('Kerala', 'Ernakulam'), ('Kerala', 'Thrissur'), ('Kerala', 'Palakkad'),
  ('Kerala', 'Malappuram'), ('Kerala', 'Kozhikode'), ('Kerala', 'Wayanad'),
  ('Kerala', 'Kannur'), ('Kerala', 'Kasaragod')
ON CONFLICT (state, name) DO NOTHING;

-- Service categories.
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories (name, sort_order) VALUES
  ('Event Management', 1), ('Venue', 2), ('Photography', 3), ('Videography', 4),
  ('Catering', 5), ('Decoration', 6), ('DJ & Music', 7), ('Makeup', 8),
  ('Mehendi', 9), ('Sound & Lighting', 10), ('Rental', 11), ('Event Host', 12)
ON CONFLICT (name) DO NOTHING;

-- Vendor profile fields.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_type vendor_type NOT NULL DEFAULT 'company';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
-- Defaults to 'approved' for now; the admin approval flow comes in the trust phase.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status vendor_status NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS idx_vendors_district ON vendors (district_id);

-- Fill district for existing vendors from their city/town text.
UPDATE vendors v SET district_id = d.id
FROM districts d
WHERE v.district_id IS NULL
  AND d.state = 'Kerala'
  AND d.name = CASE
    WHEN LOWER(v.location) IN ('kochi', 'cochin', 'ernakulam', 'aluva', 'kakkanad', 'edappally') THEN 'Ernakulam'
    WHEN LOWER(v.location) IN ('trivandrum', 'thiruvananthapuram') THEN 'Thiruvananthapuram'
    WHEN LOWER(v.location) IN ('calicut', 'kozhikode') THEN 'Kozhikode'
    ELSE initcap(v.location)
  END;

-- Services: what a vendor sells. One vendor, many services.
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_from INTEGER NOT NULL CHECK (price_from >= 0),
  price_unit TEXT NOT NULL DEFAULT 'event',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_vendor ON services (vendor_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services (category_id);

-- Portfolio: work samples. Optionally tied to one service.
CREATE TABLE IF NOT EXISTS portfolio_items (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  media_type media_type NOT NULL DEFAULT 'image',
  media_url TEXT NOT NULL CHECK (length(media_url) > 0),
  storage_path TEXT,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_vendor ON portfolio_items (vendor_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_service ON portfolio_items (service_id);

-- Which services a customer asked for in one inquiry ("only these parts").
CREATE TABLE IF NOT EXISTS quote_request_services (
  quote_request_id INTEGER NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (quote_request_id, service_id)
);

-- Give every existing vendor one service based on its current category/price,
-- so old listings keep working under the new model.
INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit)
SELECT v.id, c.id, v.category, v.about, v.price,
       CASE WHEN v.price_label ILIKE '%per plate%' THEN 'plate' ELSE 'event' END
FROM vendors v
JOIN categories c ON c.name = v.category
WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.vendor_id = v.id);
