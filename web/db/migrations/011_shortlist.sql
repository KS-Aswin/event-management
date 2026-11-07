-- 011: shortlist notes (PRODUCT_PLAN P2-9). The shortlist is the existing
-- favorites table; customers can keep a short private note per vendor
-- ("asked for Sunday rate", "cousin recommended"). Idempotent.

ALTER TABLE favorites ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS note_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'favorites_note_len') THEN
    ALTER TABLE favorites ADD CONSTRAINT favorites_note_len CHECK (note IS NULL OR char_length(note) <= 500);
  END IF;
END $$;

-- /my/reviews looks up a customer's own reviews.
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_customer ON vendor_reviews (customer_id) WHERE customer_id IS NOT NULL;
