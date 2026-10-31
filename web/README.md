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
   - `SESSION_SECRET` — a long random string (at least 32 characters; placeholder values are rejected), e.g. `openssl rand -base64 48`

   `npm run db:migrate`, `npm run db:seed` and `npm run test:api` load `.env.local` automatically (Node 20.19+ `--env-file-if-exists`).

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Apply the database schema:**
   ```bash
   npm run db:migrate
   ```
   (This applies the numbered SQL files in `db/migrations/` to `DATABASE_URL`, in order. Each file runs once and is recorded in a `schema_migrations` table, so it is safe to re-run.)

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
- `/dashboard` — protected page (redirects to `/login` if not signed in), role-specific content: vendors see real leads/stats from `quote_requests` (or a prompt to create a listing), customers see their real submitted quote requests
- `/dashboard/create-listing` — a vendor account creates their own listing, making them findable in `/search`
- `/dashboard/edit-listing` — edit an existing listing (shares the same form component as create, via a `mode` prop)
- `/settings` — real profile editing (name/email) and notification preference toggles, all persisted to Postgres; logout
- `/about`, `/help`, `/privacy`, `/for-vendors` — static informational pages
- A single shared `<Header>` component (in `app/header.tsx`), rendered once in the root layout — handles back navigation, the logo, the search box (on `/search`), and signed-in/signed-out state consistently across every page
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — auth
- `GET /api/vendors`, `POST /api/vendors` (create a listing), `GET /api/vendors/[id]`, `PATCH /api/vendors/[id]` (edit a listing), `POST /api/vendors/[id]/quotes` — vendor data, listing management, and quote requests
- `PATCH /api/quotes/[id]` — a vendor updates a lead's status (pending/responded/booked/declined), shown as a dropdown on the dashboard
- `PATCH /api/account` — update profile/preferences
- `POST /api/vendors/[id]/reviews` — a logged-in customer submits a star rating + review, shown on the vendor's profile page. One review per customer per vendor; the vendor's aggregate rating and review count are recalculated in the same transaction as the insert.
- `GET /api/suggest?q=` — search typeahead: matching categories, locations, and vendor names from our own data (not real address autocomplete — see "Not wired yet")
- `POST`/`DELETE /api/vendors/[id]/favorite` — save/unsave a vendor, shown as a heart icon on vendor cards and profile pages, listed on the customer dashboard

**Not wired yet:** Google OAuth (button present but disabled — needs a real Google Cloud OAuth client), page-view tracking (so "profile visitors" isn't shown — only real countable stats are), customer notifications when a quote's status changes, real address/place autocomplete (current typeahead only suggests things already in our own database — full Kerala place-name suggestions would need a Google Places API key).

## Database schema

See `db/migrations/`. Tables: `users`, `vendors`, `vendor_reviews`, `quote_requests`, `favorites`, `districts`, `categories`, `services`, `portfolio_items`, `quote_request_services`. Run `npm run db:seed` after migrating to populate sample vendors (the same 9 used in the `/demo` mockup, so both stay consistent).

**`db:seed` is destructive:** it deletes all vendors, reviews, quotes and favourites and re-inserts the samples. It refuses to run when the database holds non-seed data (extra or owned listings, quotes, real reviews, favourites) unless the database name ends in `_test` or you pass `npm run db:seed -- --force` (or set `SEED_CONFIRM=1`). Never point it at a database you care about.

## Testing

There's a real automated test suite now: `web/tests/api.test.mjs` — about 120 checks covering registration validation, login (including CSRF Origin/Content-Type checks and the login rate limit), protected-route redirects, vendor search (all filter types + sort ordering), vendor detail lookup, quote request submission, vendor listing creation, editing a listing, quote status updates, review submission (including the vendor rating/count actually recalculating), **favorites** (add, idempotent re-add, remove, dashboard reflects it), **search suggestions** (category/location/vendor-name matches, short-query and no-match edge cases), settings updates, logout, and role-specific dashboard content reflecting real data.

To run it:
```bash
npm run db:migrate   # if you haven't already
npm run db:seed      # ensures the 9 sample vendors exist
npm run dev           # in one terminal, leave running
npm run test:api      # in another terminal
```

It's safe to re-run repeatedly. Every user it creates uses a run-unique `<prefix>-<RUN_ID>@example.com` email, and at the start and end of each run it deletes those test users and the listings, quotes and reviews they own (directly in the `DATABASE_URL` database, which must be on localhost; it refuses a non-local `BASE_URL`). So the absolute count checks on the 9 seeded vendors keep passing without re-seeding. If a run is interrupted, the next run cleans up the leftovers.

There is no separate `.env.test` / `DATABASE_URL_TEST` setup: the suite uses whatever database the dev server uses. To keep test data away from your dev data, create a `vela_test` database, point `DATABASE_URL` at it for both the dev server and the tests, and run `npm run db:migrate && npm run db:seed` once (seeding a `_test` database never needs `--force`).

Type checking: `npm run typecheck`.

