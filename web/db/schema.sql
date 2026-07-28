-- Vela database schema
-- Apply with: psql "$DATABASE_URL" -f db/schema.sql
-- (or: npm run db:migrate, which runs this file)

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer', 'vendor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
