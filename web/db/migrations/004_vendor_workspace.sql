-- 004: vendor workspace (docs/PRODUCT_PLAN.md section 5 / P0-1).
--
-- One additive migration. db/migrate.mjs runs it inside a single transaction
-- and records it in schema_migrations. Every statement is also idempotent on
-- its own (IF NOT EXISTS, duplicate_object guards, ON CONFLICT DO NOTHING,
-- "only fill when empty" backfills), so running the file by hand a second time
-- is a no-op.
--
-- Deviations from the plan outline (kept small, noted for review):
--   * categories.name is NOT renamed (Decoration stays "Decoration") so the
--     legacy vendors.category text, seed data and tests keep matching; the new
--     categories.display_name carries "Decoration & Florist".
--   * categories.allowed_price_units added (custom "Other" offerings need it).
--   * price unit 'piece' added to the CHECK list (cakes, invitations, gifts in
--     section 3.4 use it).
--   * vendors gain years_experience, max_guests (capacity), vendor_categories
--     (additional categories) and a re-review flag (rereview_required,
--     rereview_fields, rereview_requested_at) for P0-13.
--   * media_assets.storage_driver also allows 'url' (legacy portfolio images
--     that are plain absolute URLs; storage_key holds the URL) and
--     legacy_portfolio_id makes the portfolio copy idempotent.

-- ===========================================================================
-- A. vendors: lifecycle + business details
-- ===========================================================================

-- vendors.status: enum -> TEXT + CHECK (a new enum value can't be used inside
-- the same transaction, and 003 already chose CHECK over enums).
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'vendors' AND column_name = 'status') = 'USER-DEFINED' THEN
    ALTER TABLE vendors ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE vendors ALTER COLUMN status TYPE TEXT USING status::text;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_status_chk CHECK (status IN
    ('draft','pending','changes_requested','approved','rejected','suspended'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- New listings start as drafts; existing rows keep their value.
ALTER TABLE vendors ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS primary_category_id INT REFERENCES categories(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS year_established SMALLINT CHECK (year_established BETWEEN 1900 AND 2100);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS years_experience SMALLINT CHECK (years_experience BETWEEN 0 AND 80);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS team_size SMALLINT CHECK (team_size > 0);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_line TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS landmark TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pincode TEXT CHECK (pincode ~ '^[0-9]{6}$');
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS gstin TEXT CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fssai_no TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS travel_outside_kerala BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS max_events_per_day SMALLINT NOT NULL DEFAULT 1 CHECK (max_events_per_day BETWEEN 1 AND 50);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS max_guests INT CHECK (max_guests BETWEEN 1 AND 100000);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS onboarding_step SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS founding_vendor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS logo_media_id INT;    -- FK added after media_assets
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS cover_media_id INT;   -- FK added after media_assets
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS admin_notes TEXT;
-- Re-review flag (P0-13): an approved vendor editing name/category/phone stays
-- live but lands in the admin re-review queue.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rereview_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rereview_fields TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rereview_requested_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- logo_url / cover_image_url stay as a denormalised cache written by the media code.

-- price is a derived cache now; 0 = "price on request".
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_price_chk;
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_price_nonneg_chk CHECK (price >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Grandfather existing listings: onboarding counts as done.
UPDATE vendors SET onboarding_completed_at = created_at, onboarding_step = 6
WHERE onboarding_completed_at IS NULL AND status IN ('approved','pending','rejected');

-- years_experience from the legacy "12 yrs" text.
UPDATE vendors SET years_experience = LEAST(80, (substring(experience FROM '([0-9]{1,2})'))::int)
WHERE years_experience IS NULL AND experience ~ '[0-9]';

CREATE INDEX IF NOT EXISTS idx_vendors_status_submitted ON vendors (status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_vendors_rereview ON vendors (rereview_requested_at) WHERE rereview_required;

CREATE TABLE IF NOT EXISTS vendor_status_events (          -- vendor-visible history
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  changed_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_status_events_vendor ON vendor_status_events (vendor_id, created_at DESC);

-- ===========================================================================
-- B. users: status, sessions, phone
-- ===========================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','suspended','deleted'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 TEXT CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ===========================================================================
-- C. taxonomy
-- ===========================================================================
ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_ml TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS default_price_unit TEXT NOT NULL DEFAULT 'event';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS allowed_price_units TEXT[] NOT NULL DEFAULT '{event}';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS allow_on_request BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS uses_slots BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS uses_inventory BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS attribute_schema JSONB NOT NULL DEFAULT '[]';  -- base fields for "Other"

-- New categories (existing 12 are kept by name).
-- (slug/display_name are given here too: NOT NULL is checked before ON CONFLICT on a re-run.)
INSERT INTO categories (name, slug, display_name, sort_order) VALUES
  ('Traditional & Live Arts', 'traditional-music', 'Traditional & Live Arts', 8),
  ('Cakes & Desserts', 'cake', 'Cakes & Desserts', 13),
  ('Invitations & Printing', 'invitations', 'Invitations & Printing', 15),
  ('Transport', 'transport', 'Transport', 16),
  ('Priest & Rituals', 'priest', 'Priest & Rituals', 17),
  ('Gifts & Favours', 'return-gifts', 'Gifts & Favours', 19),
  ('Entertainment', 'entertainment', 'Entertainment', 20)
ON CONFLICT (name) DO NOTHING;

-- Category details. Only fills rows not yet detailed (icon still empty), so a
-- later admin edit is never overwritten by a re-run.
UPDATE categories c SET
  slug = d.slug, display_name = d.display_name, sort_order = d.sort_order, icon = d.icon,
  description = d.description, default_price_unit = d.default_unit, allowed_price_units = d.units,
  allow_on_request = d.on_request, uses_slots = d.slots, uses_inventory = d.inventory,
  attribute_schema = d.attrs::jsonb
FROM (VALUES
  ('Event Management', 'event-management', 'Event Management', 1, 'clipboard',
   'Planners and event companies who run the whole event or parts of it.',
   'package', ARRAY['package','event','day'], true, false, false,
   '[{"key":"event_types","label":"Events you handle","type":"multi","options":["hindu-wedding","christian-wedding","nikah","engagement","reception","mehendi-night","baptism","first-communion","choroonu","noolukettu","griha-pravesham","birthday","onam-corporate","college-fest","other"],"filterable":true},
     {"key":"max_guests","label":"Largest event (guests)","type":"int","min":1,"max":100000,"filterable":true},
     {"key":"max_events_per_day","label":"Events per day","type":"int","min":1,"max":50},
     {"key":"crew_size","label":"Crew size","type":"int","min":1,"max":1000},
     {"key":"in_house_units","label":"Services you run in-house","type":"tags"}]'),
  ('Venue', 'venue', 'Venue', 2, 'building',
   'Auditoriums, banquet halls, lawns and resorts.',
   'slot', ARRAY['slot','day','event'], true, true, false,
   '[{"key":"seating_capacity","label":"Seating capacity","type":"int","min":1,"max":100000,"filterable":true},
     {"key":"floating_capacity","label":"Floating capacity","type":"int","min":1,"max":100000},
     {"key":"dining_capacity","label":"Dining capacity","type":"int","min":1,"max":100000},
     {"key":"dining_batches","label":"Dining batches","type":"int","min":1,"max":20},
     {"key":"ac","label":"Air-conditioned","type":"bool","filterable":true},
     {"key":"parking_cars","label":"Car parking","type":"int","min":0,"max":10000},
     {"key":"parking_bikes","label":"Bike parking","type":"int","min":0,"max":10000},
     {"key":"rooms","label":"Rooms","type":"int","min":0,"max":1000},
     {"key":"generator","label":"Generator backup","type":"bool"},
     {"key":"outside_caterer_allowed","label":"Outside caterers allowed","type":"bool","filterable":true},
     {"key":"outside_decor_allowed","label":"Outside decorators allowed","type":"bool"},
     {"key":"alcohol_allowed","label":"Alcohol allowed","type":"bool"},
     {"key":"stage_included","label":"Stage included","type":"bool"}]'),
  ('Photography', 'photography', 'Photography', 3, 'camera',
   'Wedding, candid, pre-wedding and event photographers.',
   'event', ARRAY['event','day','hour','session','item'], false, false, false,
   '[{"key":"coverage_hours","label":"Coverage hours","type":"int","min":1,"max":72},
     {"key":"photographers","label":"Photographers","type":"int","min":1,"max":50},
     {"key":"edited_photos","label":"Edited photos","type":"int","min":0,"max":100000},
     {"key":"album_sheets","label":"Album sheets","type":"int","min":0,"max":500},
     {"key":"album_type","label":"Album type","type":"enum","options":["none","standard","premium","magazine"]},
     {"key":"delivery_days","label":"Delivery (days)","type":"int","min":0,"max":365},
     {"key":"drone","label":"Drone included","type":"bool","filterable":true},
     {"key":"raw_files","label":"Raw files given","type":"bool"},
     {"key":"same_day_edit","label":"Same-day edit","type":"bool"},
     {"key":"women_led","label":"Women-led team","type":"bool","filterable":true}]'),
  ('Videography', 'videography', 'Videography', 4, 'video',
   'Cinematic films, traditional video and live streaming.',
   'event', ARRAY['event','day','hour'], false, false, false,
   '[{"key":"videographers","label":"Videographers","type":"int","min":1,"max":50},
     {"key":"film_minutes","label":"Film length (minutes)","type":"int","min":1,"max":600},
     {"key":"highlight_minutes","label":"Highlights length (minutes)","type":"int","min":1,"max":60},
     {"key":"delivery_days","label":"Delivery (days)","type":"int","min":0,"max":365},
     {"key":"drone","label":"Drone included","type":"bool","filterable":true},
     {"key":"live_stream","label":"Live streaming","type":"bool","filterable":true},
     {"key":"cameras","label":"Cameras","type":"int","min":1,"max":50}]'),
  ('Catering', 'catering', 'Catering', 5, 'utensils',
   'Sadhya, biryani, wedding menus and live counters.',
   'plate', ARRAY['plate','person','event','item'], false, false, false,
   '[{"key":"food_pref","label":"Food","type":"enum","options":["veg","non_veg","both"],"filterable":true},
     {"key":"cuisines","label":"Cuisines","type":"tags"},
     {"key":"item_count","label":"Items in menu","type":"int","min":1,"max":200},
     {"key":"serves_at","label":"Serves at","type":"multi","options":["hall","home","parish_hall"]},
     {"key":"max_guests_per_day","label":"Max guests per day","type":"int","min":1,"max":100000,"filterable":true},
     {"key":"kitchen_crews","label":"Kitchen crews","type":"int","min":1,"max":100},
     {"key":"fssai_no","label":"FSSAI licence no.","type":"text","max":20}]'),
  ('Decoration', 'decoration', 'Decoration & Florist', 6, 'flower',
   'Stage, mandapam, floral and theme decoration.',
   'event', ARRAY['event','item','sqft'], true, false, false,
   '[{"key":"flower_type","label":"Flowers","type":"enum","options":["fresh","artificial","mixed"],"filterable":true},
     {"key":"theme_styles","label":"Theme styles","type":"tags"},
     {"key":"includes_lighting","label":"Lighting included","type":"bool"},
     {"key":"setup_hours","label":"Setup time (hours)","type":"int","min":1,"max":72}]'),
  ('DJ & Music', 'dj-music', 'DJ & Music', 7, 'music',
   'DJs, live bands, singers and instrumentalists.',
   'event', ARRAY['event','hour','artist'], false, false, false,
   '[{"key":"hours","label":"Hours","type":"int","min":1,"max":24},
     {"key":"artists","label":"Artists","type":"int","min":1,"max":100},
     {"key":"genres","label":"Genres","type":"tags"},
     {"key":"equipment_included","label":"Sound equipment included","type":"bool"},
     {"key":"languages","label":"Languages","type":"tags"}]'),
  ('Traditional & Live Arts', 'traditional-music', 'Traditional & Live Arts', 8, 'drum',
   'Chenda melam, panchavadyam, nadaswaram and traditional dance.',
   'event', ARRAY['event','artist','session'], false, false, false,
   '[{"key":"team_size","label":"Team size","type":"int","min":1,"max":500},
     {"key":"duration_min","label":"Duration (minutes)","type":"int","min":5,"max":1440},
     {"key":"costume_included","label":"Costumes included","type":"bool"},
     {"key":"repertoire","label":"Repertoire","type":"tags"},
     {"key":"temple_festival_experience","label":"Temple festival experience","type":"bool"}]'),
  ('Sound & Lighting', 'sound-lighting', 'Sound & Lighting', 9, 'speaker',
   'PA systems, stage lighting, trusses and LED walls.',
   'event', ARRAY['event','day','sqft','item'], false, false, false,
   '[{"key":"wattage","label":"Sound (watts)","type":"int","min":1,"max":1000000},
     {"key":"speakers","label":"Speakers","type":"int","min":1,"max":500},
     {"key":"lights_count","label":"Lights","type":"int","min":1,"max":5000},
     {"key":"truss_size","label":"Truss size","type":"text","max":60},
     {"key":"led_wall_sqft","label":"LED wall (sq ft)","type":"int","min":1,"max":100000},
     {"key":"generator_kva","label":"Generator (kVA)","type":"int","min":1,"max":5000},
     {"key":"technicians","label":"Technicians","type":"int","min":1,"max":200}]'),
  ('Makeup', 'makeup', 'Makeup', 10, 'sparkle',
   'Bridal, groom and family makeup, hair and draping.',
   'event', ARRAY['event','person','session'], false, false, false,
   '[{"key":"products","label":"Brands used","type":"tags"},
     {"key":"airbrush","label":"Airbrush","type":"bool","filterable":true},
     {"key":"hairstyling","label":"Hairstyling","type":"bool"},
     {"key":"draping","label":"Saree draping","type":"bool"},
     {"key":"travels_to_venue","label":"Travels to venue","type":"bool"},
     {"key":"studio_available","label":"Studio available","type":"bool"},
     {"key":"women_only_team","label":"Women-only team","type":"bool","filterable":true}]'),
  ('Mehendi', 'mehendi', 'Mehendi', 11, 'hand',
   'Bridal and guest mehendi artists.',
   'event', ARRAY['event','person','item'], false, false, false,
   '[{"key":"style","label":"Styles","type":"multi","options":["bridal","arabic","indo_arabic","traditional","minimal"]},
     {"key":"organic_henna","label":"Organic henna","type":"bool"},
     {"key":"coverage","label":"Coverage","type":"enum","options":["hands","hands_feet"]},
     {"key":"artists","label":"Artists","type":"int","min":1,"max":50}]'),
  ('Rental', 'rental', 'Rental', 12, 'tent',
   'Pandals, chairs, crockery, coolers and generators for hire.',
   'item', ARRAY['item','sqft','day','set'], false, false, true,
   '[{"key":"qty_owned","label":"Quantity owned","type":"int","min":0,"max":1000000},
     {"key":"material","label":"Material","type":"text","max":60},
     {"key":"delivery_included","label":"Delivery included","type":"bool"},
     {"key":"damage_deposit","label":"Damage deposit (₹)","type":"int","min":0,"max":10000000},
     {"key":"min_order_value","label":"Minimum order (₹)","type":"int","min":0,"max":10000000}]'),
  ('Event Host', 'event-host', 'Event Host / Anchor', 18, 'mic',
   'Anchors, emcees, kids entertainers and games hosts.',
   'event', ARRAY['event','hour'], false, false, false,
   '[{"key":"languages","label":"Languages","type":"tags"},
     {"key":"hours","label":"Hours","type":"int","min":1,"max":24},
     {"key":"bilingual","label":"Bilingual","type":"bool"}]'),
  ('Cakes & Desserts', 'cake', 'Cakes & Desserts', 13, 'cake',
   'Wedding and theme cakes, cupcakes and dessert tables.',
   'kg', ARRAY['kg','piece','item'], false, false, false,
   '[{"key":"flavours","label":"Flavours","type":"tags"},
     {"key":"eggless","label":"Eggless available","type":"bool","filterable":true},
     {"key":"tiers","label":"Max tiers","type":"int","min":1,"max":20},
     {"key":"lead_time_days","label":"Order lead time (days)","type":"int","min":0,"max":180},
     {"key":"delivery_radius_km","label":"Delivery radius (km)","type":"int","min":0,"max":1000},
     {"key":"fssai_no","label":"FSSAI licence no.","type":"text","max":20}]'),
  ('Invitations & Printing', 'invitations', 'Invitations & Printing', 15, 'mail',
   'Printed, premium and digital invitations and name boards.',
   'piece', ARRAY['piece','item','set'], false, false, false,
   '[{"key":"card_type","label":"Card type","type":"enum","options":["printed","box","digital","video","flex"]},
     {"key":"languages","label":"Languages","type":"multi","options":["ml","en","ar","hi","ta"]},
     {"key":"proof_days","label":"Proof in (days)","type":"int","min":0,"max":60},
     {"key":"min_quantity","label":"Minimum quantity","type":"int","min":1,"max":100000},
     {"key":"design_fee","label":"Design fee (₹)","type":"int","min":0,"max":1000000}]'),
  ('Transport', 'transport', 'Transport', 16, 'car',
   'Bridal cars, guest cars, travellers, buses and valet.',
   'vehicle', ARRAY['vehicle','day','km','event'], false, false, false,
   '[{"key":"vehicle_type","label":"Vehicle type","type":"enum","options":["sedan","suv","innova","tempo_traveller","bus","luxury","vintage"],"filterable":true},
     {"key":"seats","label":"Seats","type":"int","min":1,"max":100},
     {"key":"units_owned","label":"Vehicles owned","type":"int","min":1,"max":1000},
     {"key":"km_included","label":"Km included","type":"int","min":0,"max":5000},
     {"key":"hours_included","label":"Hours included","type":"int","min":0,"max":72},
     {"key":"extra_km_rate","label":"Extra km rate (₹)","type":"int","min":0,"max":10000},
     {"key":"driver_bata","label":"Driver bata (₹)","type":"int","min":0,"max":100000},
     {"key":"ac","label":"Air-conditioned","type":"bool"}]'),
  ('Priest & Rituals', 'priest', 'Priest & Rituals', 17, 'flame',
   'Priests for weddings, poojas and family ceremonies.',
   'event', ARRAY['event','session'], true, false, false,
   '[{"key":"ceremonies","label":"Ceremonies","type":"tags"},
     {"key":"tradition","label":"Tradition","type":"text","max":80},
     {"key":"brings_samagri","label":"Brings pooja samagri","type":"bool"},
     {"key":"languages","label":"Languages","type":"tags"},
     {"key":"travel_area","label":"Travel area","type":"text","max":120}]'),
  ('Gifts & Favours', 'return-gifts', 'Gifts & Favours', 19, 'gift',
   'Return gifts, wedding favours and gift hampers.',
   'piece', ARRAY['piece','set'], false, false, false,
   '[{"key":"min_quantity","label":"Minimum quantity","type":"int","min":1,"max":100000},
     {"key":"customisation","label":"Customisation","type":"bool"},
     {"key":"lead_time_days","label":"Order lead time (days)","type":"int","min":0,"max":180}]'),
  ('Entertainment', 'entertainment', 'Entertainment', 20, 'star',
   'Dance troupes, costume characters, mimicry, fireworks and photo booths.',
   'event', ARRAY['event','hour','artist'], false, false, false,
   '[{"key":"team_size","label":"Team size","type":"int","min":1,"max":500},
     {"key":"duration_min","label":"Duration (minutes)","type":"int","min":5,"max":1440},
     {"key":"licensed","label":"Licensed (fireworks etc.)","type":"bool"}]')
) AS d(name, slug, display_name, sort_order, icon, description, default_unit, units, on_request, slots, inventory, attrs)
WHERE c.name = d.name AND c.icon IS NULL;

-- Any category not in the list above (e.g. added by hand) gets a slug from its name.
UPDATE categories SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL;
UPDATE categories SET display_name = name WHERE display_name IS NULL;
ALTER TABLE categories ALTER COLUMN slug SET NOT NULL;
ALTER TABLE categories ALTER COLUMN display_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_categories_slug ON categories (slug);

-- vendors.primary_category_id from the legacy category text.
UPDATE vendors v SET primary_category_id = c.id
FROM categories c WHERE c.name = v.category AND v.primary_category_id IS NULL;

-- Additional categories (the primary one stays on vendors.primary_category_id).
CREATE TABLE IF NOT EXISTS vendor_categories (
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (vendor_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category ON vendor_categories (category_id);
-- Categories a vendor already sells in (through its services) other than the primary.
INSERT INTO vendor_categories (vendor_id, category_id)
SELECT DISTINCT s.vendor_id, s.category_id FROM services s JOIN vendors v ON v.id = s.vendor_id
WHERE v.primary_category_id IS DISTINCT FROM s.category_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS offering_templates (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_ml TEXT,
  kind TEXT NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit','addon')),
  default_price_unit TEXT NOT NULL,
  allowed_price_units TEXT[] NOT NULL,
  allow_on_request BOOLEAN NOT NULL DEFAULT false,
  -- [{key,label,type:'int'|'number'|'bool'|'text'|'enum'|'multi'|'tags',options?,required?,min?,max?,filterable?}]
  attribute_schema JSONB NOT NULL DEFAULT '[]',
  is_core BOOLEAN NOT NULL DEFAULT false,      -- shows in the Event Management checklist
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, code)
);

CREATE TABLE IF NOT EXISTS event_types (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ml TEXT,
  community TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS event_type_categories (
  event_type_id INT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_core BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type_id, category_id)
);

-- ===========================================================================
-- D. offerings (= services, extended)
-- ===========================================================================
ALTER TABLE services ADD COLUMN IF NOT EXISTS template_id INT REFERENCES offering_templates(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS custom_name TEXT;           -- set for "Other"
ALTER TABLE services ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit','package','addon'));
ALTER TABLE services ADD COLUMN IF NOT EXISTS sale_mode TEXT NOT NULL DEFAULT 'separate' CHECK (sale_mode IN ('separate','package_only'));
ALTER TABLE services ADD COLUMN IF NOT EXISTS fulfilment TEXT NOT NULL DEFAULT 'in_house' CHECK (fulfilment IN ('in_house','partner'));
ALTER TABLE services ADD COLUMN IF NOT EXISTS parent_service_id INT REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_mode TEXT NOT NULL DEFAULT 'from' CHECK (price_mode IN ('from','fixed','range','on_request'));
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_to INT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_label TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_qty NUMERIC(10,2);
ALTER TABLE services ADD COLUMN IF NOT EXISTS max_qty NUMERIC(10,2);
ALTER TABLE services ADD COLUMN IF NOT EXISTS qty_step NUMERIC(10,2) NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN IF NOT EXISTS qty_owned INT CHECK (qty_owned >= 0);
ALTER TABLE services ADD COLUMN IF NOT EXISTS guest_min INT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS guest_max INT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS lead_time_days SMALLINT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS inclusions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN IF NOT EXISTS cover_media_id INT;         -- FK added after media_assets
ALTER TABLE services ADD COLUMN IF NOT EXISTS incomplete BOOLEAN NOT NULL DEFAULT false;  -- package with an inactive item
ALTER TABLE services ADD COLUMN IF NOT EXISTS hidden_reason TEXT;         -- 'plan_limit' | 'admin' | NULL
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_price_unit_chk CHECK (price_unit IN
    ('event','package','day','hour','slot','plate','person','artist','item','set','kg','sqft','km','vehicle','session','piece'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_range_chk CHECK (price_mode <> 'range' OR price_to >= price_from);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_addon_chk CHECK ((kind = 'addon') = (parent_service_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_package_sale_chk CHECK (kind <> 'package' OR sale_mode = 'separate');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_qty_chk CHECK (min_qty IS NULL OR max_qty IS NULL OR max_qty >= min_qty);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_qty_step_chk CHECK (qty_step > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_guest_chk CHECK (guest_min IS NULL OR guest_max IS NULL OR guest_max >= guest_min);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_services_search ON services (category_id, active, kind, sale_mode, price_from);
CREATE INDEX IF NOT EXISTS idx_services_template ON services (template_id);
CREATE INDEX IF NOT EXISTS idx_services_parent ON services (parent_service_id) WHERE parent_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_attrs ON services USING GIN (attributes jsonb_path_ops);

-- An add-on must belong to the same vendor as its parent (which can't itself be an add-on).
CREATE OR REPLACE FUNCTION services_addon_parent_check() RETURNS trigger AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.parent_service_id IS NOT NULL THEN
    SELECT vendor_id, kind INTO p FROM services WHERE id = NEW.parent_service_id;
    IF p.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
      RAISE EXCEPTION 'add-on parent must belong to the same vendor' USING ERRCODE = '23514';
    END IF;
    IF p.kind = 'addon' THEN
      RAISE EXCEPTION 'an add-on cannot be attached to another add-on' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_services_addon_parent ON services;
CREATE TRIGGER trg_services_addon_parent BEFORE INSERT OR UPDATE OF parent_service_id, vendor_id ON services
  FOR EACH ROW EXECUTE FUNCTION services_addon_parent_check();

CREATE TABLE IF NOT EXISTS package_items (
  package_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  qty NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  note TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (package_id, item_id),
  CHECK (package_id <> item_id)
);
CREATE INDEX IF NOT EXISTS idx_package_items_item ON package_items (item_id);

-- Both rows belong to the same vendor; the package is kind='package', the item a unit or add-on.
CREATE OR REPLACE FUNCTION package_items_same_vendor() RETURNS trigger AS $$
DECLARE pkg RECORD; itm RECORD;
BEGIN
  SELECT vendor_id, kind INTO pkg FROM services WHERE id = NEW.package_id;
  SELECT vendor_id, kind INTO itm FROM services WHERE id = NEW.item_id;
  IF pkg.kind IS DISTINCT FROM 'package' THEN
    RAISE EXCEPTION 'package_items.package_id must be a package' USING ERRCODE = '23514';
  END IF;
  IF itm.kind NOT IN ('unit','addon') THEN
    RAISE EXCEPTION 'package items must be units or add-ons' USING ERRCODE = '23514';
  END IF;
  IF pkg.vendor_id IS DISTINCT FROM itm.vendor_id THEN
    RAISE EXCEPTION 'package items must belong to the same vendor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_package_items_same_vendor ON package_items;
CREATE TRIGGER trg_package_items_same_vendor BEFORE INSERT OR UPDATE ON package_items
  FOR EACH ROW EXECUTE FUNCTION package_items_same_vendor();

-- Keep services.incomplete in step: a package is incomplete while any of its
-- items is inactive (deactivating a unit never silently changes a package).
CREATE OR REPLACE FUNCTION refresh_package_incomplete(pkg_ids INT[]) RETURNS void AS $$
  UPDATE services p SET incomplete = EXISTS (
    SELECT 1 FROM package_items pi JOIN services i ON i.id = pi.item_id
    WHERE pi.package_id = p.id AND NOT i.active)
  WHERE p.id = ANY(pkg_ids) AND p.kind = 'package';
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION services_active_changed() RETURNS trigger AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    PERFORM refresh_package_incomplete(ARRAY(SELECT package_id FROM package_items WHERE item_id = NEW.id));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_services_active_changed ON services;
CREATE TRIGGER trg_services_active_changed AFTER UPDATE OF active ON services
  FOR EACH ROW EXECUTE FUNCTION services_active_changed();

CREATE OR REPLACE FUNCTION package_items_changed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_package_incomplete(ARRAY[OLD.package_id]);
  ELSE
    PERFORM refresh_package_incomplete(ARRAY[NEW.package_id]);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_package_items_changed ON package_items;
CREATE TRIGGER trg_package_items_changed AFTER INSERT OR UPDATE OR DELETE ON package_items
  FOR EACH ROW EXECUTE FUNCTION package_items_changed();

CREATE TABLE IF NOT EXISTS service_event_types (
  service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  event_type_id INT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, event_type_id)
);

CREATE TABLE IF NOT EXISTS custom_offering_requests (
  id SERIAL PRIMARY KEY,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id),
  raw_name TEXT NOT NULL,
  normalised_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','promoted','merged','kept_private','rejected')),
  resolved_template_id INT REFERENCES offering_templates(id),
  resolved_by INT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  note TEXT,
  flagged_contact BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_offering_requests_status ON custom_offering_requests (status, normalised_name);
ALTER TABLE offering_templates ADD COLUMN IF NOT EXISTS promoted_from_request_id INT REFERENCES custom_offering_requests(id);

-- ===========================================================================
-- E. media
-- ===========================================================================
CREATE TABLE IF NOT EXISTS media_albums (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  event_type_id INT REFERENCES event_types(id),
  event_date DATE,
  district_id INT REFERENCES districts(id),
  venue_name TEXT,
  cover_media_id INT,                  -- FK added below
  consent_confirmed_at TIMESTAMPTZ,
  published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_albums_vendor ON media_albums (vendor_id, sort_order);

CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  album_id INT REFERENCES media_albums(id) ON DELETE SET NULL,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL DEFAULT 'gallery' CHECK (purpose IN ('gallery','logo','cover','poster')),
  kind TEXT NOT NULL CHECK (kind IN ('image','video_file','video_link')),
  -- 'url' = legacy absolute URL copied from portfolio_items (storage_key holds the URL).
  storage_driver TEXT CHECK (storage_driver IN ('local','s3','r2','supabase','url')),
  storage_key TEXT,                        -- base key; variants under it
  variants JSONB NOT NULL DEFAULT '{}',    -- {"thumb":{"key","w","h"},"card":{...},"full":{...}}
  external_url TEXT,
  external_provider TEXT CHECK (external_provider IN ('youtube','instagram','vimeo')),
  external_id TEXT,
  poster_media_id INT REFERENCES media_assets(id) ON DELETE SET NULL,
  mime TEXT,
  bytes INT,
  width INT,
  height INT,
  duration_s INT,
  sha256 TEXT,
  placeholder_color TEXT,
  caption TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN
    ('uploading','processing','pending_review','approved','rejected','hidden')),
  status_reason TEXT,
  reviewed_by INT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  report_count INT NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  legacy_portfolio_id INT UNIQUE,          -- set for rows copied from portfolio_items
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_link_chk CHECK ((kind = 'video_link') = (external_url IS NOT NULL)),
  CONSTRAINT media_assets_key_chk CHECK (kind = 'video_link' OR storage_key IS NOT NULL OR status = 'uploading')
);
CREATE INDEX IF NOT EXISTS idx_media_vendor_public ON media_assets (vendor_id, status, purpose, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_moderation ON media_assets (status, created_at);
CREATE INDEX IF NOT EXISTS idx_media_album ON media_assets (album_id, sort_order) WHERE album_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_media_sha_per_vendor ON media_assets (vendor_id, sha256) WHERE sha256 IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_logo_media_fk FOREIGN KEY (logo_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_cover_media_fk FOREIGN KEY (cover_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_cover_media_fk FOREIGN KEY (cover_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE media_albums ADD CONSTRAINT media_albums_cover_media_fk FOREIGN KEY (cover_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Copy legacy portfolio rows (already public, so 'approved'). portfolio_items
-- is kept read-only and dropped in a later migration.
INSERT INTO media_assets (vendor_id, service_id, purpose, kind, storage_driver, storage_key,
                          external_url, external_provider, external_id, caption, status, sort_order,
                          legacy_portfolio_id, created_at)
SELECT p.vendor_id, p.service_id, 'gallery',
       CASE WHEN p.media_type = 'video_link' THEN 'video_link' ELSE 'image' END,
       CASE WHEN p.media_type = 'video_link' THEN NULL
            WHEN p.storage_path IS NOT NULL AND p.storage_path <> '' THEN 'local' ELSE 'url' END,
       CASE WHEN p.media_type = 'video_link' THEN NULL ELSE COALESCE(NULLIF(p.storage_path, ''), p.media_url) END,
       CASE WHEN p.media_type = 'video_link' THEN p.media_url END,
       CASE WHEN p.media_type <> 'video_link' THEN NULL
            WHEN p.media_url ~* '(youtube\.com|youtu\.be)' THEN 'youtube'
            WHEN p.media_url ~* 'instagram\.com' THEN 'instagram'
            WHEN p.media_url ~* 'vimeo\.com' THEN 'vimeo' END,
       CASE WHEN p.media_type <> 'video_link' THEN NULL
            ELSE substring(p.media_url FROM '(?:youtu\.be/|v=|shorts/|reel/|p/|vimeo\.com/)([A-Za-z0-9_-]{5,})') END,
       p.caption, 'approved', p.sort_order, p.id, p.created_at
FROM portfolio_items p
ON CONFLICT (legacy_portfolio_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS media_reports (
  id SERIAL PRIMARY KEY,
  media_id INT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  reporter_id INT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_reports_media ON media_reports (media_id);

-- ===========================================================================
-- F. areas, availability, team, documents
-- ===========================================================================
CREATE TABLE IF NOT EXISTS vendor_service_areas (
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  district_id INT NOT NULL REFERENCES districts(id),
  travel_fee INT CHECK (travel_fee >= 0),
  travel_note TEXT,
  PRIMARY KEY (vendor_id, district_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_service_areas_district ON vendor_service_areas (district_id);

CREATE TABLE IF NOT EXISTS vendor_availability (
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  slot TEXT NOT NULL DEFAULT 'full' CHECK (slot IN ('full','morning','evening')),
  status TEXT NOT NULL CHECK (status IN ('blocked','booked','tentative','limited')),
  capacity_total SMALLINT NOT NULL DEFAULT 1 CHECK (capacity_total >= 1),
  capacity_used SMALLINT NOT NULL DEFAULT 0 CHECK (capacity_used >= 0),
  quote_request_id INT REFERENCES quote_requests(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','booking')),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, date, slot)
);
CREATE INDEX IF NOT EXISTS idx_vendor_availability_date ON vendor_availability (date, status);

CREATE TABLE IF NOT EXISTS vendor_team (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  photo_media_id INT REFERENCES media_assets(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_documents (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('gst','trade_licence','fssai','pan','aadhaar','other')),
  number TEXT,
  storage_driver TEXT NOT NULL,
  storage_key TEXT NOT NULL,              -- under private/
  mime TEXT NOT NULL,
  bytes INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired')),
  expires_at DATE,
  reviewed_by INT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_documents_status ON vendor_documents (status, created_at);

-- ===========================================================================
-- G. enquiries: context, line items, offers, thread
-- ===========================================================================
ALTER TABLE quote_requests DROP CONSTRAINT IF EXISTS quote_status_chk;
ALTER TABLE quote_requests ADD CONSTRAINT quote_status_chk CHECK (status IN
  ('pending','responded','accepted','booked','declined','withdrawn','expired'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS event_type_id INT REFERENCES event_types(id);
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS district_id INT REFERENCES districts(id);
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS venue_text TEXT;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS venue_type TEXT
  CHECK (venue_type IN ('home','hall','church','temple','mosque','office','outdoor','other'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS guest_count INT CHECK (guest_count BETWEEN 1 AND 100000);
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS budget_min INT;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS budget_max INT;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS slot TEXT CHECK (slot IN ('full','morning','evening'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS event_end_date DATE;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS food_pref TEXT CHECK (food_pref IN ('veg','non_veg','both'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS preferred_contact TEXT NOT NULL DEFAULT 'whatsapp'
  CHECK (preferred_contact IN ('call','whatsapp','email'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web','whatsapp_click','multi','admin'));
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS guest_token UUID UNIQUE;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS vendor_notes TEXT;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS follow_up_at DATE;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS customer_withdrawn_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_quote_requests_vendor_status ON quote_requests (vendor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_requests_analytics ON quote_requests (district_id, event_type_id, created_at);

ALTER TABLE quote_request_services ADD COLUMN IF NOT EXISTS qty NUMERIC(10,2);
ALTER TABLE quote_request_services ADD COLUMN IF NOT EXISTS note TEXT;
-- title/kind/price/unit at request time, so a lead keeps saying what was asked
-- even after the vendor edits or deletes the offering.
ALTER TABLE quote_request_services ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}';
UPDATE quote_request_services qs SET snapshot = jsonb_build_object(
  'title', s.title, 'kind', s.kind, 'category_id', s.category_id,
  'price_from', s.price_from, 'price_to', s.price_to, 'price_mode', s.price_mode,
  'price_unit', s.price_unit, 'unit_label', s.unit_label)
FROM services s WHERE s.id = qs.service_id AND qs.snapshot = '{}'::jsonb;

CREATE TABLE IF NOT EXISTS quote_offers (
  id SERIAL PRIMARY KEY,
  quote_request_id INT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  version SMALLINT NOT NULL,
  created_by INT REFERENCES users(id),
  subtotal_paise BIGINT NOT NULL,
  travel_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  gst_paise BIGINT NOT NULL DEFAULT 0,     -- >0 only if vendor has gstin (app rule)
  total_paise BIGINT NOT NULL,
  advance_pct SMALLINT CHECK (advance_pct BETWEEN 0 AND 100),
  valid_until DATE,
  terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined','superseded','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE (quote_request_id, version)
);
CREATE TABLE IF NOT EXISTS quote_offer_lines (
  id SERIAL PRIMARY KEY,
  offer_id INT NOT NULL REFERENCES quote_offers(id) ON DELETE CASCADE,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  qty NUMERIC(10,2) NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise BIGINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quote_messages (
  id SERIAL PRIMARY KEY,
  quote_request_id INT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','vendor','admin','system')),
  sender_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_messages_quote ON quote_messages (quote_request_id, created_at);

-- ===========================================================================
-- H. reviews
-- ===========================================================================
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS quote_request_id INT REFERENCES quote_requests(id) ON DELETE SET NULL;
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS event_type_id INT REFERENCES event_types(id);
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS vendor_reply TEXT;
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS vendor_reply_at TIMESTAMPTZ;
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS hidden_by INT REFERENCES users(id);
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
  CHECK (status IN ('open','dismissed','actioned'));
ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS resolved_by INT REFERENCES users(id);
ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS resolution_note TEXT;
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports (status, created_at);

-- ===========================================================================
-- I. admin & analytics
-- ===========================================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                  -- 'vendor.approve','review.hide','user.suspend','taxonomy.promote',...
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  reason TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);

-- Append-only. (The actor_id ON DELETE SET NULL is the one allowed update:
-- deleting a user must not be blocked by their audit trail.)
CREATE OR REPLACE FUNCTION admin_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'admin_audit_log is append-only (% not allowed)', TG_OP USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_admin_audit_log_append_only ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_append_only BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();
DROP TRIGGER IF EXISTS trg_admin_audit_log_no_truncate ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_no_truncate BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_append_only();

CREATE TABLE IF NOT EXISTS vendor_events (             -- raw counters; aggregate later
  id BIGSERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('profile_view','whatsapp_click','phone_reveal','search_impression')),
  district_id INT REFERENCES districts(id),
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_events_vendor ON vendor_events (vendor_id, kind, created_at);

CREATE TABLE IF NOT EXISTS blocked_contacts (
  id SERIAL PRIMARY KEY,
  value TEXT UNIQUE NOT NULL,            -- normalised phone or lower(email)
  reason TEXT NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (             -- in-app now; channels later
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at, created_at DESC);

-- ===========================================================================
-- J. seeds: offering templates, event types and their bundles
-- ===========================================================================
-- t.def / t.units / t.onreq NULL = inherit from the category.
INSERT INTO offering_templates (category_id, code, name, kind, default_price_unit, allowed_price_units,
                                allow_on_request, is_core, sort_order)
SELECT c.id, t.code, t.name, t.kind, COALESCE(t.def, c.default_price_unit),
       COALESCE(t.units, c.allowed_price_units), COALESCE(t.onreq, c.allow_on_request), t.core, t.sort
FROM (VALUES
  -- Event Management
  ('event-management', 'full-planning', 'Full planning & coordination', 'unit', NULL::text, NULL::text[], NULL::boolean, true, 1),
  ('event-management', 'day-of-coordination', 'Day-of coordination', 'unit', 'event', NULL, NULL, true, 2),
  ('event-management', 'theme-design', 'Theme & concept design', 'unit', 'event', NULL, NULL, true, 3),
  ('event-management', 'guest-hospitality', 'Guest hospitality & welcome (thalappoli team)', 'unit', 'event', NULL, NULL, true, 4),
  ('event-management', 'logistics', 'Logistics (guest transport, valet)', 'unit', 'event', NULL, NULL, true, 5),
  ('event-management', 'vendor-sourcing', 'Vendor sourcing', 'unit', 'event', NULL, NULL, true, 6),
  ('event-management', 'corporate-production', 'Corporate event production', 'unit', 'event', NULL, NULL, true, 7),
  -- Venue
  ('venue', 'auditorium', 'Auditorium / convention hall', 'unit', NULL, NULL, NULL, true, 1),
  ('venue', 'banquet-hall', 'Banquet hall (AC)', 'unit', NULL, NULL, NULL, false, 2),
  ('venue', 'outdoor-lawn', 'Outdoor lawn', 'unit', NULL, NULL, NULL, false, 3),
  ('venue', 'beach-backwater', 'Beach / backwater venue', 'unit', NULL, NULL, NULL, false, 4),
  ('venue', 'parish-hall', 'Temple / church parish hall', 'unit', NULL, NULL, NULL, false, 5),
  ('venue', 'resort-homestay', 'Resort / homestay', 'unit', NULL, NULL, NULL, false, 6),
  -- Photography
  ('photography', 'wedding-photography', 'Wedding photography (traditional)', 'unit', NULL, NULL, NULL, true, 1),
  ('photography', 'candid-photography', 'Candid photography', 'unit', NULL, NULL, NULL, false, 2),
  ('photography', 'pre-wedding-shoot', 'Pre-wedding / save-the-date shoot', 'unit', 'session', NULL, NULL, false, 3),
  ('photography', 'engagement-shoot', 'Engagement shoot', 'unit', NULL, NULL, NULL, false, 4),
  ('photography', 'family-occasion-shoot', 'Baptism / choroonu / birthday shoot', 'unit', NULL, NULL, NULL, false, 5),
  ('photography', 'drone-coverage', 'Drone coverage', 'addon', NULL, NULL, NULL, false, 6),
  ('photography', 'album-printing', 'Album printing', 'addon', 'item', NULL, NULL, false, 7),
  ('photography', 'corporate-photography', 'Corporate / event photography', 'unit', NULL, NULL, NULL, false, 8),
  -- Videography
  ('videography', 'cinematic-film', 'Wedding cinematic film', 'unit', NULL, NULL, NULL, true, 1),
  ('videography', 'traditional-video', 'Traditional full video', 'unit', NULL, NULL, NULL, false, 2),
  ('videography', 'highlights-reel', 'Highlights / teaser reel', 'unit', NULL, NULL, NULL, false, 3),
  ('videography', 'live-streaming', 'Live streaming', 'unit', NULL, NULL, NULL, false, 4),
  ('videography', 'drone-video', 'Drone video', 'addon', NULL, NULL, NULL, false, 5),
  ('videography', 'led-wall-venue', 'LED wall at venue', 'addon', NULL, NULL, NULL, false, 6),
  -- Catering
  ('catering', 'kerala-sadhya', 'Kerala sadhya (veg, banana leaf)', 'unit', NULL, NULL, NULL, true, 1),
  ('catering', 'malabar-biryani', 'Malabar biryani', 'unit', NULL, NULL, NULL, false, 2),
  ('catering', 'christian-wedding-menu', 'Christian wedding menu (appam, stew, roasts)', 'unit', NULL, NULL, NULL, false, 3),
  ('catering', 'nikah-mandi-menu', 'Nikah / Mandi menu', 'unit', NULL, NULL, NULL, false, 4),
  ('catering', 'north-indian-buffet', 'North Indian buffet', 'unit', NULL, NULL, NULL, false, 5),
  ('catering', 'snacks-tea', 'Snacks & tea', 'unit', NULL, NULL, NULL, false, 6),
  ('catering', 'live-counters', 'Live counters', 'unit', 'item', NULL, NULL, false, 7),
  ('catering', 'serving-staff', 'Serving staff', 'addon', 'person', NULL, NULL, false, 8),
  ('catering', 'tasting-session', 'Tasting session', 'addon', 'item', NULL, NULL, false, 9),
  -- Decoration & Florist
  ('decoration', 'stage-mandapam-decor', 'Stage / mandapam décor', 'unit', NULL, NULL, NULL, true, 1),
  ('decoration', 'nikah-stage', 'Nikah stage', 'unit', NULL, NULL, NULL, false, 2),
  ('decoration', 'church-aisle-decor', 'Church aisle décor', 'unit', NULL, NULL, NULL, false, 3),
  ('decoration', 'entry-arch', 'Entry / theme arch', 'unit', 'item', NULL, NULL, false, 4),
  ('decoration', 'fresh-flower-decoration', 'Flower decoration (fresh)', 'unit', NULL, NULL, NULL, false, 5),
  ('decoration', 'car-decor', 'Car décor', 'unit', 'item', NULL, NULL, false, 6),
  ('decoration', 'pookalam', 'Pookalam (flower carpet)', 'unit', 'sqft', NULL, NULL, false, 7),
  ('decoration', 'balloon-theme', 'Balloon / birthday theme', 'unit', NULL, NULL, NULL, false, 8),
  ('decoration', 'haldi-mylanchi-setup', 'Haldi / mylanchi setup', 'unit', NULL, NULL, NULL, false, 9),
  ('decoration', 'led-backdrop', 'LED backdrop', 'addon', 'item', NULL, NULL, false, 10),
  -- DJ & Music
  ('dj-music', 'dj', 'DJ', 'unit', NULL, NULL, NULL, true, 1),
  ('dj-music', 'live-band', 'Live band', 'unit', NULL, NULL, NULL, false, 2),
  ('dj-music', 'solo-singer', 'Solo singer / ghazal', 'unit', NULL, NULL, NULL, false, 3),
  ('dj-music', 'instrumental', 'Instrumental (keyboard, violin, sax)', 'unit', 'artist', NULL, NULL, false, 4),
  ('dj-music', 'karaoke-setup', 'Karaoke setup', 'unit', NULL, NULL, NULL, false, 5),
  ('dj-music', 'extra-hour', 'Extra hour', 'addon', 'hour', NULL, NULL, false, 6),
  -- Traditional & Live Arts
  ('traditional-music', 'chenda-melam', 'Chenda melam (Shinkari / Pandi / Panchari)', 'unit', NULL, NULL, NULL, true, 1),
  ('traditional-music', 'panchavadyam', 'Panchavadyam', 'unit', NULL, NULL, NULL, false, 2),
  ('traditional-music', 'nadaswaram-thavil', 'Nadaswaram / thavil', 'unit', NULL, NULL, NULL, false, 3),
  ('traditional-music', 'thayambaka', 'Thayambaka', 'unit', NULL, NULL, NULL, false, 4),
  ('traditional-music', 'thiruvathira-kali', 'Thiruvathira kali', 'unit', NULL, NULL, NULL, false, 5),
  ('traditional-music', 'oppana', 'Oppana', 'unit', NULL, NULL, NULL, false, 6),
  ('traditional-music', 'margamkali', 'Margamkali', 'unit', NULL, NULL, NULL, false, 7),
  ('traditional-music', 'kolkali', 'Kolkali', 'unit', NULL, NULL, NULL, false, 8),
  ('traditional-music', 'kathakali-mohiniyattam', 'Kathakali / Mohiniyattam performance', 'unit', NULL, NULL, NULL, false, 9),
  ('traditional-music', 'duff-muttu', 'Duff muttu', 'unit', NULL, NULL, NULL, false, 10),
  -- Sound & Lighting
  ('sound-lighting', 'pa-sound', 'PA / line-array sound', 'unit', NULL, NULL, NULL, true, 1),
  ('sound-lighting', 'stage-lighting', 'Stage lighting (LED par, moving heads)', 'unit', NULL, NULL, NULL, false, 2),
  ('sound-lighting', 'truss-stage', 'Truss & stage structure', 'unit', NULL, NULL, NULL, false, 3),
  ('sound-lighting', 'led-wall', 'LED wall', 'unit', 'sqft', NULL, NULL, false, 4),
  ('sound-lighting', 'generator-backup', 'Generator backup', 'unit', 'day', NULL, NULL, false, 5),
  ('sound-lighting', 'special-effects', 'Special effects (cold pyro, fog)', 'unit', NULL, NULL, NULL, false, 6),
  -- Makeup
  ('makeup', 'bridal-makeup-hd', 'Bridal makeup (HD)', 'unit', NULL, NULL, NULL, true, 1),
  ('makeup', 'airbrush-bridal', 'Airbrush bridal makeup', 'unit', NULL, NULL, NULL, false, 2),
  ('makeup', 'groom-makeup', 'Groom makeup', 'unit', NULL, NULL, NULL, false, 3),
  ('makeup', 'family-guest-makeup', 'Family / guest makeup', 'unit', 'person', NULL, NULL, false, 4),
  ('makeup', 'hairstyling', 'Hairstyling', 'unit', 'person', NULL, NULL, false, 5),
  ('makeup', 'saree-draping', 'Saree draping', 'unit', 'person', NULL, NULL, false, 6),
  ('makeup', 'trial-session', 'Trial session', 'addon', 'session', NULL, NULL, false, 7),
  -- Mehendi
  ('mehendi', 'bridal-mehendi', 'Bridal mehendi (hands + feet)', 'unit', NULL, NULL, NULL, true, 1),
  ('mehendi', 'mylanchi-night', 'Mylanchi night package', 'unit', NULL, NULL, NULL, false, 2),
  ('mehendi', 'guest-mehendi', 'Guest mehendi', 'unit', 'person', NULL, NULL, false, 3),
  ('mehendi', 'arabic-designs', 'Arabic / Indo-Arabic designs', 'unit', 'item', NULL, NULL, false, 4),
  -- Rental
  ('rental', 'pandal-shamiana', 'Pandal / shamiana', 'unit', 'sqft', NULL, NULL, true, 1),
  ('rental', 'chairs', 'Chairs', 'unit', NULL, NULL, NULL, false, 2),
  ('rental', 'tables', 'Tables', 'unit', NULL, NULL, NULL, false, 3),
  ('rental', 'crockery-cutlery', 'Crockery & cutlery', 'unit', 'set', NULL, NULL, false, 4),
  ('rental', 'tower-ac-cooler', 'Tower AC / air cooler', 'unit', NULL, NULL, NULL, false, 5),
  ('rental', 'generator', 'Generator', 'unit', 'day', NULL, NULL, false, 6),
  ('rental', 'stage-platform', 'Stage platform', 'unit', 'sqft', NULL, NULL, false, 7),
  ('rental', 'furniture-lounge', 'Furniture & lounge', 'unit', 'set', NULL, NULL, false, 8),
  ('rental', 'tents', 'Tents', 'unit', NULL, NULL, NULL, false, 9),
  -- Cakes & Desserts
  ('cake', 'wedding-cake', 'Wedding / tiered cake', 'unit', NULL, NULL, NULL, true, 1),
  ('cake', 'birthday-theme-cake', 'Birthday / theme cake', 'unit', NULL, NULL, NULL, false, 2),
  ('cake', 'cupcakes-desserts', 'Cupcakes & desserts', 'unit', 'piece', NULL, NULL, false, 3),
  ('cake', 'dessert-table', 'Dessert table', 'unit', 'item', NULL, NULL, false, 4),
  -- Invitations & Printing
  ('invitations', 'printed-cards', 'Printed wedding cards', 'unit', NULL, NULL, NULL, true, 1),
  ('invitations', 'premium-box-invites', 'Box / premium invites', 'unit', NULL, NULL, NULL, false, 2),
  ('invitations', 'digital-e-invite', 'Digital e-invite', 'unit', 'item', NULL, NULL, false, 3),
  ('invitations', 'video-invite', 'Video invite', 'unit', 'item', NULL, NULL, false, 4),
  ('invitations', 'name-boards-flex', 'Name boards / flex printing', 'unit', 'item', NULL, NULL, false, 5),
  -- Transport
  ('transport', 'bridal-car', 'Bridal car (decorated)', 'unit', NULL, NULL, NULL, true, 1),
  ('transport', 'guest-car', 'Guest car (Innova / sedan)', 'unit', NULL, NULL, NULL, false, 2),
  ('transport', 'tempo-traveller', 'Tempo traveller', 'unit', NULL, NULL, NULL, false, 3),
  ('transport', 'bus-49-seat', 'Bus (49-seat)', 'unit', NULL, NULL, NULL, false, 4),
  ('transport', 'valet-service', 'Valet service', 'unit', 'event', NULL, NULL, false, 5),
  -- Priest & Rituals
  ('priest', 'hindu-wedding-ceremony', 'Wedding ceremony (Hindu)', 'unit', NULL, NULL, NULL, true, 1),
  ('priest', 'griha-pravesham', 'Griha pravesham', 'unit', NULL, NULL, NULL, false, 2),
  ('priest', 'choroonu', 'Choroonu', 'unit', NULL, NULL, NULL, false, 3),
  ('priest', 'noolukettu', 'Noolukettu', 'unit', NULL, NULL, NULL, false, 4),
  ('priest', 'ganapathi-homam', 'Ganapathi homam', 'unit', NULL, NULL, NULL, false, 5),
  ('priest', 'muhurtham-consultation', 'Muhurtham consultation', 'addon', 'session', NULL, NULL, false, 6),
  ('priest', 'pooja-samagri', 'Pooja samagri', 'addon', 'event', NULL, NULL, false, 7),
  -- Event Host / Anchor
  ('event-host', 'wedding-anchor', 'Wedding anchor / MC', 'unit', NULL, NULL, NULL, true, 1),
  ('event-host', 'corporate-emcee', 'Corporate emcee', 'unit', NULL, NULL, NULL, false, 2),
  ('event-host', 'kids-entertainer', 'Kids entertainer / magician', 'unit', NULL, NULL, NULL, false, 3),
  ('event-host', 'games-host', 'Games host', 'unit', NULL, NULL, NULL, false, 4),
  -- Gifts & Favours
  ('return-gifts', 'return-gifts', 'Return gifts', 'unit', NULL, NULL, NULL, true, 1),
  ('return-gifts', 'wedding-favours', 'Wedding favours', 'unit', NULL, NULL, NULL, false, 2),
  ('return-gifts', 'corporate-hampers', 'Corporate gift hampers', 'unit', 'set', NULL, NULL, false, 3),
  -- Entertainment
  ('entertainment', 'dance-troupe', 'Dance troupe', 'unit', NULL, NULL, NULL, true, 1),
  ('entertainment', 'costume-characters', 'Maveli (Onam) / costume characters', 'unit', 'artist', NULL, NULL, false, 2),
  ('entertainment', 'mimicry-standup', 'Mimicry / stand-up', 'unit', NULL, NULL, NULL, false, 3),
  ('entertainment', 'fireworks', 'Fireworks (licensed)', 'unit', NULL, NULL, NULL, false, 4),
  ('entertainment', 'photo-booth', 'Photo booth / 360 booth', 'unit', NULL, NULL, NULL, false, 5)
) AS t(slug, code, name, kind, def, units, onreq, core, sort)
JOIN categories c ON c.slug = t.slug
ON CONFLICT (category_id, code) DO NOTHING;

-- Templates inherit the category's attribute fields unless they have their own.
UPDATE offering_templates t SET attribute_schema = c.attribute_schema
FROM categories c WHERE t.category_id = c.id AND t.attribute_schema = '[]'::jsonb;

-- Event types and the "what you need" bundle for each.
INSERT INTO event_types (slug, name, community, sort_order) VALUES
  ('hindu-wedding', 'Hindu wedding', 'hindu', 1),
  ('christian-wedding', 'Christian wedding', 'christian', 2),
  ('nikah', 'Nikah', 'muslim', 3),
  ('engagement', 'Engagement / Manasammatham', NULL, 4),
  ('reception', 'Reception', NULL, 5),
  ('mehendi-night', 'Mylanchi / Mehendi night', NULL, 6),
  ('baptism', 'Baptism', 'christian', 7),
  ('first-communion', 'First Holy Communion', 'christian', 8),
  ('choroonu', 'Choroonu', 'hindu', 9),
  ('noolukettu', 'Noolukettu', 'hindu', 10),
  ('griha-pravesham', 'Griha pravesham', 'hindu', 11),
  ('birthday', 'Birthday', NULL, 12),
  ('onam-corporate', 'Onam / Corporate', NULL, 13),
  ('college-fest', 'College fest', NULL, 14),
  ('other', 'Other', NULL, 15)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO event_type_categories (event_type_id, category_id, is_core, sort_order)
SELECT e.id, c.id, b.core, b.sort
FROM (VALUES
  ('hindu-wedding', 'venue', true, 1), ('hindu-wedding', 'catering', true, 2), ('hindu-wedding', 'decoration', true, 3),
  ('hindu-wedding', 'photography', true, 4), ('hindu-wedding', 'videography', true, 5), ('hindu-wedding', 'makeup', true, 6),
  ('hindu-wedding', 'priest', true, 7), ('hindu-wedding', 'traditional-music', false, 8), ('hindu-wedding', 'invitations', false, 9),
  ('hindu-wedding', 'transport', false, 10), ('hindu-wedding', 'event-management', false, 11),
  ('christian-wedding', 'venue', true, 1), ('christian-wedding', 'catering', true, 2), ('christian-wedding', 'decoration', true, 3),
  ('christian-wedding', 'photography', true, 4), ('christian-wedding', 'videography', true, 5), ('christian-wedding', 'makeup', true, 6),
  ('christian-wedding', 'cake', true, 7), ('christian-wedding', 'dj-music', false, 8), ('christian-wedding', 'transport', false, 9),
  ('christian-wedding', 'invitations', false, 10), ('christian-wedding', 'event-management', false, 11),
  ('nikah', 'venue', true, 1), ('nikah', 'catering', true, 2), ('nikah', 'decoration', true, 3),
  ('nikah', 'photography', true, 4), ('nikah', 'videography', true, 5), ('nikah', 'makeup', true, 6),
  ('nikah', 'mehendi', false, 7), ('nikah', 'invitations', false, 8), ('nikah', 'event-management', false, 9),
  ('engagement', 'venue', true, 1), ('engagement', 'catering', true, 2), ('engagement', 'decoration', true, 3),
  ('engagement', 'photography', true, 4), ('engagement', 'makeup', false, 5), ('engagement', 'cake', false, 6),
  ('reception', 'venue', true, 1), ('reception', 'catering', true, 2), ('reception', 'decoration', true, 3),
  ('reception', 'photography', true, 4), ('reception', 'dj-music', true, 5), ('reception', 'sound-lighting', false, 6),
  ('reception', 'event-host', false, 7), ('reception', 'cake', false, 8),
  ('mehendi-night', 'mehendi', true, 1), ('mehendi-night', 'decoration', true, 2), ('mehendi-night', 'dj-music', true, 3),
  ('mehendi-night', 'catering', false, 4), ('mehendi-night', 'photography', false, 5),
  ('baptism', 'venue', true, 1), ('baptism', 'catering', true, 2), ('baptism', 'photography', true, 3),
  ('baptism', 'cake', false, 4), ('baptism', 'decoration', false, 5),
  ('first-communion', 'venue', true, 1), ('first-communion', 'catering', true, 2), ('first-communion', 'photography', true, 3),
  ('first-communion', 'cake', false, 4), ('first-communion', 'decoration', false, 5),
  ('choroonu', 'catering', true, 1), ('choroonu', 'photography', true, 2), ('choroonu', 'priest', false, 3),
  ('choroonu', 'decoration', false, 4),
  ('noolukettu', 'catering', true, 1), ('noolukettu', 'photography', true, 2), ('noolukettu', 'priest', false, 3),
  ('noolukettu', 'decoration', false, 4),
  ('griha-pravesham', 'priest', true, 1), ('griha-pravesham', 'catering', true, 2), ('griha-pravesham', 'decoration', false, 3),
  ('griha-pravesham', 'photography', false, 4), ('griha-pravesham', 'rental', false, 5),
  ('birthday', 'cake', true, 1), ('birthday', 'decoration', true, 2), ('birthday', 'catering', true, 3),
  ('birthday', 'photography', false, 4), ('birthday', 'entertainment', false, 5), ('birthday', 'return-gifts', false, 6),
  ('birthday', 'event-host', false, 7),
  ('onam-corporate', 'catering', true, 1), ('onam-corporate', 'decoration', true, 2), ('onam-corporate', 'traditional-music', true, 3),
  ('onam-corporate', 'entertainment', false, 4), ('onam-corporate', 'event-host', false, 5), ('onam-corporate', 'sound-lighting', false, 6),
  ('onam-corporate', 'event-management', false, 7),
  ('college-fest', 'sound-lighting', true, 1), ('college-fest', 'dj-music', true, 2), ('college-fest', 'entertainment', true, 3),
  ('college-fest', 'event-host', false, 4), ('college-fest', 'rental', false, 5), ('college-fest', 'event-management', false, 6),
  ('other', 'event-management', true, 1), ('other', 'venue', false, 2), ('other', 'catering', false, 3),
  ('other', 'photography', false, 4)
) AS b(et, cat, core, sort)
JOIN event_types e ON e.slug = b.et
JOIN categories c ON c.slug = b.cat
ON CONFLICT (event_type_id, category_id) DO NOTHING;

-- Link existing offerings to a template where the title matches one exactly
-- (case-insensitive) within the same category.
UPDATE services s SET template_id = t.id
FROM offering_templates t
WHERE s.template_id IS NULL AND t.category_id = s.category_id AND lower(t.name) = lower(s.title);
