-- 005_admin.sql: the few things migration 004 lacks for the P1 admin area
-- (docs/PRODUCT_PLAN.md section 8, P1). Idempotent: re-running is a no-op.
--
-- A. Admin "actor" foreign keys become ON DELETE SET NULL. In 004 they were
--    NO ACTION, so deleting an admin account (or an admin test user) failed
--    as soon as that admin had resolved a report, reviewed media or a
--    document, hidden a review or blocked a contact. The audit trail keeps
--    who did what (admin_audit_log.actor_id is already SET NULL and its
--    append-only trigger allows exactly that one update).
-- B. Indexes for the admin queues and the enquiry monitor.

-- ===========================================================================
-- A. actor FKs -> ON DELETE SET NULL
-- ===========================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('custom_offering_requests', 'resolved_by'),
      ('media_assets',             'reviewed_by'),
      ('vendor_documents',         'reviewed_by'),
      ('vendor_reviews',           'hidden_by'),
      ('review_reports',           'resolved_by'),
      ('blocked_contacts',         'created_by'),
      ('quote_offers',             'created_by')
    ) AS t(tbl, col)
  LOOP
    -- Drop whatever FK currently covers (tbl.col -> users.id) unless it is
    -- already SET NULL, then add the SET NULL one under a fixed name.
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = r.tbl::regclass
        AND c.confrelid = 'users'::regclass
        AND a.attname = r.col
        AND c.confdeltype <> 'n'
    ) THEN
      EXECUTE (
        SELECT string_agg(format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, c.conname), '; ')
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = r.tbl::regclass
          AND c.confrelid = 'users'::regclass
          AND a.attname = r.col
      );
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL',
        r.tbl, r.tbl || '_' || r.col || '_fkey', r.col
      );
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- B. admin queue / monitor indexes
-- ===========================================================================
-- Reported-media tab: open reports, oldest first.
CREATE INDEX IF NOT EXISTS idx_media_reports_status ON media_reports (status, created_at);
-- Enquiry monitor: recent enquiries, and the spam rule "same phone to more
-- than 10 vendors in 1 h" (P1-13).
CREATE INDEX IF NOT EXISTS idx_quote_requests_created ON quote_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_requests_phone_created ON quote_requests (phone, created_at);
-- User search by phone (P1-9) and "last active admin" checks.
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, status);
-- Vendor documents per vendor (vendor detail page).
CREATE INDEX IF NOT EXISTS idx_vendor_documents_vendor ON vendor_documents (vendor_id, created_at DESC);
-- Audit viewer filtered by actor.
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log (actor_id, created_at DESC);
