-- QA1 fix round, public pages (QA-010, QA-023).
-- Idempotent: safe to run more than once.
--
-- QA-010: a vendor's rating and review count must agree with the reviews on
-- its page. The seed/demo data stored invented aggregates ("4.9 from 189
-- reviews") as a "baseline" (seed_rating/seed_reviews_count, migration 003)
-- that no review rows back up, so a profile said 189 reviews next to a single
-- review card and a one-review breakdown. Drop that baseline everywhere and
-- recompute rating/reviews_count from the visible (not hidden) reviews only.
-- recomputeVendorRating (lib/db.ts) keeps the same formula, which with a 0/0
-- baseline is just the average of the real reviews.
UPDATE vendors v SET
  seed_rating = 0,
  seed_reviews_count = 0,
  rating = COALESCE(ROUND(r.total::numeric / NULLIF(r.n, 0), 1), 0),
  reviews_count = r.n
FROM (
  SELECT v2.id,
         count(rv.id) FILTER (WHERE rv.hidden_at IS NULL)::int AS n,
         COALESCE(sum(rv.rating) FILTER (WHERE rv.hidden_at IS NULL), 0) AS total
    FROM vendors v2
    LEFT JOIN vendor_reviews rv ON rv.vendor_id = v2.id
   GROUP BY v2.id
) r
WHERE r.id = v.id;

-- QA-023: one "from" price per vendor on every surface. vendors.price and
-- price_label are the cache that search, the profile, /e and /my all read;
-- recomputeVendorPrice (lib/db.ts) now picks the cheapest priced, separately
-- sold offering in the vendor's MAIN category (a venue's hall, not its
-- per-plate catering add-on), falling back to the cheapest of any category.
-- Seeded vendors never had the cache recomputed, so refresh every vendor here
-- with the same rule and the same label format as formatVendorPriceLabel
-- (lib/offering-validation.ts): "₹1,50,000 per slot", "₹45,000 onwards",
-- "Price on request".
CREATE OR REPLACE FUNCTION pg_temp.qa1_inr(n BIGINT) RETURNS TEXT AS $$
  SELECT '₹' || CASE
    WHEN n < 1000 THEN n::text
    ELSE regexp_replace((n / 1000)::text, '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || lpad((n % 1000)::text, 3, '0')
  END
$$ LANGUAGE sql IMMUTABLE;

WITH best AS (
  SELECT v.id AS vendor_id, p.price_from, p.price_unit, p.unit_label
    FROM vendors v
    LEFT JOIN LATERAL (
      SELECT s.price_from, s.price_unit, s.unit_label
        FROM services s
       WHERE s.vendor_id = v.id AND s.active AND s.hidden_reason IS NULL AND NOT s.incomplete
         AND s.kind IN ('unit','package') AND s.sale_mode = 'separate'
         AND s.price_mode <> 'on_request' AND s.price_from > 0
       ORDER BY COALESCE(s.category_id = COALESCE(v.primary_category_id,
                  (SELECT c.id FROM categories c WHERE c.name = v.category)), false) DESC,
                s.price_from, s.id
       LIMIT 1
    ) p ON true
)
UPDATE vendors v SET
  price = COALESCE(b.price_from, 0),
  price_label = CASE
    WHEN b.price_from IS NULL THEN 'Price on request'
    WHEN b.price_unit IN ('event','package') THEN pg_temp.qa1_inr(b.price_from) || ' onwards'
    WHEN b.unit_label IS NOT NULL AND b.unit_label <> '' THEN pg_temp.qa1_inr(b.price_from) || ' per ' || b.unit_label
    WHEN b.price_unit = 'sqft' THEN pg_temp.qa1_inr(b.price_from) || ' per sq ft'
    ELSE pg_temp.qa1_inr(b.price_from) || ' per ' || b.price_unit
  END
FROM best b
WHERE b.vendor_id = v.id;

DROP FUNCTION IF EXISTS pg_temp.qa1_inr(BIGINT);
