-- P2-6 / P2-11 (builder E): calendar and reviews v2.
-- Idempotent: safe to run more than once.

-- A vendor's public reply can be edited for 7 days after it is first posted
-- (PRODUCT_PLAN section 6). vendor_reply_at stays the first-posted time (the
-- edit window runs from it); vendor_reply_edited_at marks a later edit.
ALTER TABLE vendor_reviews ADD COLUMN IF NOT EXISTS vendor_reply_edited_at TIMESTAMPTZ;

-- Insights (P2-14) count a vendor's enquiries by creation time.
CREATE INDEX IF NOT EXISTS idx_quote_requests_vendor_created ON quote_requests (vendor_id, created_at);
