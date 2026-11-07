-- 007_promoted_template_fk.sql: offering_templates.promoted_from_request_id
-- becomes ON DELETE SET NULL. In 004 it was NO ACTION, so once a custom
-- offering had been promoted (P1-8), deleting the vendor who first asked for
-- it (custom_offering_requests cascade from vendors) failed with an FK error.
-- The template stays; only the "promoted from" pointer is cleared.
-- Idempotent: re-running is a no-op.
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.contype = 'f'
       AND con.conrelid = 'offering_templates'::regclass
       AND con.confrelid = 'custom_offering_requests'::regclass
       AND a.attname = 'promoted_from_request_id'
       AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE offering_templates DROP CONSTRAINT %I', c);
    ALTER TABLE offering_templates
      ADD CONSTRAINT offering_templates_promoted_from_request_id_fkey
      FOREIGN KEY (promoted_from_request_id) REFERENCES custom_offering_requests(id) ON DELETE SET NULL;
  END LOOP;
END $$;
