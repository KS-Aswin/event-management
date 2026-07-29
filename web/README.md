# Vela — web app (real build)

This is the real Next.js + PostgreSQL app, replacing the static `demo/` mockup one page at a time. See `/PROJECT_LOG.md` at the repo root for full context on decisions and progress.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4**
- **PostgreSQL**, accessed via the `pg` package with hand-written SQL (not Prisma — see note below)
- **Auth**: custom session cookies (JWT via `jose`, httpOnly cookie), passwords hashed with `bcryptjs`. Not NextAuth/Auth.js — kept it simple and dependency-light for now.

### Why not Prisma?

Prisma needs to download a native query-engine binary from `binaries.prisma.sh` on first install/migrate. That domain isn't reachable from the sandbox this was built in, so Prisma could never actually run there. Rather than build against a tool that couldn't be tested, we switched to the plain `pg` driver (pure JS, no binary download) with SQL files in `/db`. This should work anywhere with normal network access — if you want to reintroduce Prisma later (e.g. once developing outside a restricted sandbox), that's a reasonable option to revisit.

## Local setup

1. **Install PostgreSQL** if you don't have it, and create a database:
   ```bash
   createdb vela_dev
   ```

2. **Copy the env file and fill it in:**
   ```bash
   cp .env.example .env.local
   ```
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — a long random string, e.g. `openssl rand -base64 32`

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Apply the database schema:**
   ```bash
   node db/migrate.mjs
   ```
   (This runs `db/schema.sql` against `DATABASE_URL`. Safe to re-run — it uses `CREATE TABLE IF NOT EXISTS`.)

5. **Run the dev server:**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000

## What's built so far

- `/` — real Google-style home page with animated search placeholder and category chips, ported from the demo
- `/search` — real vendor search: category/location/rating filters and sort, all driving real Postgres queries via URL params (shareable/bookmarkable search URLs)
- `/vendors/[id]` — real vendor profile page: about, packages, real reviews from the database, and a working "Request quote" modal that saves to the database
- `/signup` — real signup form (customer or vendor role), creates a user in Postgres, hashes the password, signs the person in. Accepts `?role=vendor` to preset the role (used by the "For Vendors" page's CTA)
- `/login` — real login form, verifies against the stored password hash
- `/dashboard` — protected page (redirects to `/login` if not signed in), role-specific content (vendor stats vs. customer event checklist — currently sample content, not yet tied to real quote-request data)
- `/settings` — real profile editing (name/email) and notification preference toggles, all persisted to Postgres; logout
- `/about`, `/help`, `/privacy`, `/for-vendors` — static informational pages
- A single shared `<Header>` component (in `app/header.tsx`), rendered once in the root layout — handles back navigation, the logo, the search box (on `/search`), and signed-in/signed-out state consistently across every page
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — auth
- `GET /api/vendors`, `GET /api/vendors/[id]`, `POST /api/vendors/[id]/quotes` — vendor data + quote requests
- `PATCH /api/account` — update profile/preferences

**Not wired yet:** Google OAuth (button present but disabled — needs a real Google Cloud OAuth client), vendor accounts actually managing/editing their own listing (vendors are currently seed data — see `db/seed.mjs` — not linked to real vendor user accounts), dashboard stats tied to real quote-request data instead of sample numbers, "my events" tracking for customers.

## Database schema

See `db/schema.sql`. Tables: `users`, `vendors`, `vendor_reviews`, `quote_requests`. Run `node db/seed.mjs` after migrating to populate sample vendors (the same 9 used in the `/demo` mockup, so both stay consistent) — safe to re-run, it clears and re-inserts rather than duplicating.

## Testing

There's a real automated test suite now: `web/tests/api.test.mjs` — 37 checks covering registration validation (duplicate email, weak password, invalid role), login (correct/wrong password, no email enumeration on either failure), protected-route redirects, vendor search (category/location/rating/text-search filters, sort ordering), vendor detail lookup (including 404/400 handling), quote request submission (including validation and 404-vendor handling), settings updates (including the auth-required check and email-conflict check), logout, and role-specific dashboard content.

To run it:
```bash
npm run db:migrate   # if you haven't already
npm run db:seed      # ensures the 9 sample vendors exist
npm run dev           # in one terminal, leave running
npm run test:api      # in another terminal
```

It's safe to re-run repeatedly — anything that creates a user uses a timestamp-based unique email each run, so it won't collide with previous runs' data.

