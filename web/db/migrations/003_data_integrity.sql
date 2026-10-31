-- 003: data-integrity fixes from the Oct 2026 maintenance run.
-- Written to be idempotent (safe to re-run). Review before applying to any
-- non-local database: the duplicate-listing step changes data.

-- ---------------------------------------------------------------------------
-- EM-064: emails are case-insensitive. Normalise stored emails and enforce
-- uniqueness on lower(email). (If two accounts differ only by case, the
-- UPDATE fails on users_email_key: merge those by hand first.)
-- ---------------------------------------------------------------------------
UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));

-- ---------------------------------------------------------------------------
-- EM-134: one listing per vendor account. Duplicates (same owner_id) keep the
-- oldest listing; the newer copies have their leads moved to the kept
-- listing, then are unpublished and detached from the owner.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, owner_id, min(id) OVER (PARTITION BY owner_id) AS keep_id
  FROM vendors WHERE owner_id IS NOT NULL
), dupes AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
), moved AS (
  UPDATE quote_requests q SET vendor_id = d.keep_id FROM dupes d WHERE q.vendor_id = d.id
  RETURNING q.id
)
UPDATE vendors v SET owner_id = NULL, published = false, status = 'rejected'
FROM dupes d WHERE v.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS vendors_owner_unique ON vendors (owner_id) WHERE owner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- EM-102: keep the seeded ("imported") rating and review count separate, so
-- the first real review adds to them instead of replacing them.
-- seed_* = the part of rating/reviews_count not backed by vendor_reviews rows.
-- ---------------------------------------------------------------------------
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS seed_rating NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS seed_reviews_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '003_data_integrity.sql') THEN
    UPDATE vendors v SET
      seed_reviews_count = GREATEST(v.reviews_count - r.n, 0),
      seed_rating = CASE
        WHEN v.reviews_count - r.n > 0 THEN
          LEAST(5, GREATEST(0, (v.rating * v.reviews_count - r.total) / (v.reviews_count - r.n)))
        ELSE 0 END
    FROM (
      SELECT v2.id, count(rv.id)::int AS n, COALESCE(sum(rv.rating), 0) AS total
      FROM vendors v2 LEFT JOIN vendor_reviews rv ON rv.vendor_id = v2.id
      GROUP BY v2.id
    ) r
    WHERE r.id = v.id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- EM-106: reviews from customers who actually sent an enquiry are marked
-- verified; anyone can report a review for admin follow-up.
-- ---------------------------------------------------------------------------
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

UPDATE vendor_reviews r SET verified = true
WHERE r.customer_id IS NOT NULL AND NOT r.verified
  AND EXISTS (SELECT 1 FROM quote_requests q WHERE q.vendor_id = r.vendor_id AND q.customer_id = r.customer_id);

CREATE TABLE IF NOT EXISTS review_reports (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES vendor_reviews(id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports (review_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_report_per_user
  ON review_reports (review_id, reporter_id) WHERE reporter_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- EM-136: quote status history.
-- ---------------------------------------------------------------------------
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS quote_status_events (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_status_events_quote ON quote_status_events (quote_id);

-- ---------------------------------------------------------------------------
-- EM-152: CHECK constraints (CHECK rather than an enum, so adding a status
-- later is a simple constraint swap).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE quote_requests ADD CONSTRAINT quote_status_chk
    CHECK (status IN ('pending', 'responded', 'booked', 'declined'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_price_chk CHECK (price > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- EM-015 / EM-109: backfill district_id from the location text, including
-- common city names and old spellings.
-- ---------------------------------------------------------------------------
UPDATE vendors v SET district_id = d.id
FROM districts d
WHERE v.district_id IS NULL
  AND d.state = 'Kerala'
  AND lower(d.name) = CASE lower(trim(v.location))
    WHEN 'kochi' THEN 'ernakulam'
    WHEN 'cochin' THEN 'ernakulam'
    WHEN 'trivandrum' THEN 'thiruvananthapuram'
    WHEN 'calicut' THEN 'kozhikode'
    WHEN 'alleppey' THEN 'alappuzha'
    WHEN 'trichur' THEN 'thrissur'
    WHEN 'quilon' THEN 'kollam'
    WHEN 'palghat' THEN 'palakkad'
    WHEN 'cannanore' THEN 'kannur'
    ELSE lower(trim(v.location))
  END;

-- EM-112: lookups used by every public listing query.
CREATE INDEX IF NOT EXISTS idx_vendors_public ON vendors (status, published);
