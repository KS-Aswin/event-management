-- 010: Search v2 (P2-7). Idempotent.
--
-- Ranking is featured -> rank boost -> rating -> completeness -> id
-- (PRODUCT_PLAN 6, "GET /api/vendors"). Featured placements are sold later
-- (P3-4), but the columns exist now so the ordering is real and an admin can
-- pin or nudge a listing with plain SQL until the admin UI ships:
--   featured_until  a vendor is "featured" while featured_until > now()
--   rank_boost      manual nudge, -100..100 (0 = neutral)

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rank_boost SMALLINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_rank_boost_chk CHECK (rank_boost BETWEEN -100 AND 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Offering-level search: separately sellable, active units/packages by template.
CREATE INDEX IF NOT EXISTS idx_services_sellable
  ON services (template_id, vendor_id)
  WHERE active AND sale_mode = 'separate' AND kind IN ('unit','package');

-- Date filter: one vendor's rows for one date.
CREATE INDEX IF NOT EXISTS idx_vendor_availability_vendor_date ON vendor_availability (vendor_id, date);
