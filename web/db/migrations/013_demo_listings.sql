-- P3-1 (prodready): demo listings. `npm run db:seed:demo` fills an EMPTY
-- production database with sample vendors so the site isn't blank on launch;
-- they are flagged here and labelled "Demo listing" on the profile and in
-- search, so nobody mistakes them for real businesses. Delete them (or clear
-- the flag) once real vendors are live.
-- Idempotent: safe to run more than once.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
