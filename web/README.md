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
   - Optional: `APP_URL` (used in email links), `RESEND_API_KEY` + `EMAIL_FROM` (real emails; without them emails are printed in the server console), `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` (photo uploads; without them vendors paste an https image link), `RATE_LIMIT=on` (rate limiting is on automatically in production)

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Apply the database schema:**
   ```bash
   node db/migrate.mjs
   ```
   (This runs `db/schema.sql` against `DATABASE_URL`. Safe to re-run — every statement is idempotent, so it also upgrades an older database.)
   Then add sample vendors with `npm run db:seed` (refuses to run in production unless `SEED_FORCE=1`).

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

**Not wired yet (older note, see the section below for the current list):** Google OAuth (button present but disabled — needs a real Google Cloud OAuth client), page-view tracking (so "profile visitors" isn't shown — only real countable stats are), customer notifications when a quote's status changes, real address/place autocomplete (current typeahead only suggests things already in our own database — full Kerala place-name suggestions would need a Google Places API key).

## Added in the "complete Vela" pass

- **Accounts:** forgot/reset password (single-use hashed tokens, 1 hour), email verification, change password, delete account (asks for password). Emails are lowercased; passwords 8–72 chars.
- **Vendor tools:** packages (`/dashboard/packages`), portfolio photos (`/dashboard/portfolio`), unavailable dates (`/dashboard/availability`), real "Profile visitors (30 days)" and lead stats. Customers cannot request a quote on a blocked date; marking a quote *booked* blocks that date automatically.
- **Messages and notifications:** chat thread per quote request (`/dashboard/quotes/[id]`, refreshes every 8 s), in-app bell with unread count (`/notifications`) plus an email copy.
- **Search:** pagination, a *Trending* sort (recent leads x5 + views over 30 days), featured vendors first, `%` and `_` searched as plain text.
- **Home page:** Featured vendors. **Dashboard:** recommended vendors for customers (best-rated vendor in categories they haven't tried).
- **Admin:** `/admin` to verify / feature / hide listings. Admin is never creatable from the app. Make one with:
  ```bash
  npm run db:make-admin -- someone@example.com
  ```
- **Hardening:** rate limits on login/register/quotes/messages, validation helpers, security headers, 404 and error pages.

### Deploying (suggested: Vercel + Neon)
1. Create a Neon Postgres database and use the **pooled** connection string as `DATABASE_URL`.
2. Run `npm run db:migrate` once against it (from your computer, with `DATABASE_URL` set).
3. In Vercel, set the root directory to `web`, and add the env vars above (`SESSION_SECRET`, `APP_URL`, and Resend/Cloudinary if you use them).
4. Note: rate limiting is in memory (per server instance), so it is a basic guard, not a complete one.

### Still not built
Stripe payments/commission, AI planner, Google sign-in, Google Places autocomplete, several listings per vendor, SMS, session logout-everywhere after a password reset (sessions are stateless JWTs).

## Database schema

See `db/schema.sql`. Tables: `users`, `vendors`, `vendor_reviews`, `quote_requests`, `favorites`, `vendor_packages`, `portfolio_items`, `vendor_unavailable_dates`, `notifications`, `quote_messages`, `auth_tokens`, `vendor_views`. Run `node db/seed.mjs` after migrating to populate sample vendors (the same 9 used in the `/demo` mockup, so both stay consistent) — safe to re-run, it only replaces the sample (ownerless) vendors and never touches real vendor listings.

## Testing

There's a real automated test suite now: `web/tests/api.test.mjs` — about 150 checks covering registration validation, login, protected-route redirects, vendor search (all filter types + sort ordering), vendor detail lookup, quote request submission, vendor listing creation, editing a listing, quote status updates, review submission (including the vendor rating/count actually recalculating), **favorites** (add, idempotent re-add, remove, dashboard reflects it), **search suggestions** (category/location/vendor-name matches, short-query and no-match edge cases), settings updates, logout, role-specific dashboard content, and the newer features (pagination, packages, portfolio, availability, messages, notifications, admin guard, password change/reset, delete account).

To run it:
```bash
npm run db:migrate   # if you haven't already
npm run db:seed      # ensures the 9 sample vendors exist
npm run dev           # in one terminal, leave running
npm run test:api      # in another terminal
```

It's safe to re-run repeatedly — anything that creates a user uses a timestamp-based unique email each run, so it won't collide with previous runs' data.

