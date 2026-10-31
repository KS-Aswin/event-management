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

**Prerequisites:** Node.js **20.19 or newer** (checked with Node 24 / npm 11; `package.json` `engines` enforces `>=20.19.0`) and PostgreSQL (checked with 18). On Windows the Postgres tools (`createdb`, `psql`) live in `C:\Program Files\PostgreSQL\<version>\bin`, which the installer does not add to `PATH`; add it, or call them by full path. Run every command below from this `web/` folder.

1. **Install PostgreSQL** if you don't have it, and create a database (pass the user you set up during install; on Windows that is usually `postgres`, and you will be asked for its password):
   ```bash
   createdb -h localhost -U postgres vela_dev
   ```

2. **Copy the env file and fill it in:**
   ```bash
   cp .env.example .env.local
   ```
   - `DATABASE_URL` — your Postgres connection string, e.g. `postgresql://postgres:<password>@localhost:5432/vela_dev` (URL-encode special characters in the password)
   - `SESSION_SECRET` — a long random string (at least 32 characters; placeholder values such as `CHANGE_ME` are rejected), e.g. `openssl rand -base64 48` or `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` (works on Windows without OpenSSL)
   - `NEXT_PUBLIC_SITE_URL` — optional locally (defaults to `http://localhost:3000`); set it to the public `https://` origin in production, it is used for canonical/Open Graph links, `robots.txt` and `sitemap.xml`

   `npm run dev`/`build`/`start` (Next.js) and `npm run db:migrate`, `npm run db:seed`, `npm run test:api`, `npm run test:e2e` all read `.env.local` automatically.

3. **Install dependencies:**
   ```bash
   npm install
   ```
   (npm prints an `ERESOLVE overriding peer dependency` warning for `@napi-rs/wasm-runtime`, an optional ESLint resolver binding. It is harmless.)

4. **Apply the database schema:**
   ```bash
   npm run db:migrate
   ```
   (This applies the numbered SQL files in `db/migrations/` to `DATABASE_URL`, in order. Each file runs once and is recorded in a `schema_migrations` table, so it is safe to re-run.)

5. **Load the sample vendors** (optional, but the home page, search and tests expect them):
   ```bash
   npm run db:seed
   ```
   Read the warning under "Database schema" first: seeding wipes vendor data.

6. **Run the dev server:**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000 (use `npm run dev -- -p 3100` for another port).

### Media uploads (vendor workspace)

Vendor photos and videos are stored through a `StorageAdapter` (`lib/storage/`). Locally the `local` driver writes to `web/uploads/` (git-ignored) and the app serves files at `/media/<key>`. Optional env vars:

- `STORAGE_DRIVER` — `local` (default). `s3`, `r2` and `supabase` are reserved and fail at startup until implemented (P3).
- `UPLOADS_DIR` (or `STORAGE_LOCAL_ROOT`) — another folder for local uploads.
- `MEDIA_VIDEO_UPLOADS` — `true`/`false`; MP4 uploads are on by default except in production.
- `BILLING_ENABLED` — leave unset; until billing ships every vendor gets the Pro media limits.

Image processing uses `sharp` (a regular dependency, MIT; prebuilt binaries for Windows, Linux and Vercel install with `npm install`). Each photo is checked by magic bytes (JPEG/PNG/WebP/HEIC, max 15 MB; MP4 max 50 MB), de-duplicated by sha256 and stored as `thumb`, `card` and `full` WebP variants without EXIF under `uploads/vendors/<vendorId>/<uuid>/`.

Who can see a file under `/media`: approved media is public and cached for a year. Media that is still pending review, rejected or hidden, and every raw `upload.bin`, is served only to the owning vendor and admins (`Cache-Control: private, no-store`); everyone else gets 404. Paths with `..` get 400 and anything under `private/` is never served.

To use another uploads folder, set `UPLOADS_DIR` in `.env.local`. Deleting `uploads/` loses the files but not the database rows; run `npm run db:seed -- --force` to rebuild the sample media.

### Production build (local check)

```bash
npm run build
npm run start            # serves the build on http://localhost:3000 (add -- -p <port> to change it)
```

`npm run lint` and `npm run typecheck` should both pass (lint currently reports one warning, no errors). In production (`NODE_ENV=production`) the session cookie is marked `Secure` and an HSTS header is sent, so serve the site over HTTPS.

## What's built so far

- `/` — real Google-style home page with animated search placeholder and category chips, ported from the demo
- `/search` — real vendor search: category/location/rating filters and sort, all driving real Postgres queries via URL params (shareable/bookmarkable search URLs)
- `/vendors/[id]` — real vendor profile page: about, packages, real reviews from the database, and a working "Request quote" modal that saves to the database
- `/signup` — real signup form (customer or vendor role), creates a user in Postgres, hashes the password, signs the person in. Accepts `?role=vendor` to preset the role (used by the "For Vendors" page's CTA)
- `/login` — real login form, verifies against the stored password hash
- **Vendor workspace** (`role = vendor` only; customers are sent to their own area, signed-out users to `/login`). Vendors land here after login instead of the customer home:
  - `/vendor/onboarding` — 6-step wizard (business type, categories, offerings from the taxonomy with "Other", packages, areas and contact, media), saved per step and resumable; submit moves the listing to `pending`
  - `/vendor` — home: status banner, profile-strength checklist, new leads, bookings, 7-day stats
  - `/vendor/leads`, `/vendor/leads/[id]` — leads inbox with the requested units, notes, follow-up date and WhatsApp link
  - `/vendor/offerings` — offerings (service units with pricing unit, starting price, bookable separately or package-only) and packages built from them
  - `/vendor/media` — photos and videos: logo, cover, albums with captions, reorder, delete, video links and small MP4s
  - `/vendor/profile`, `/vendor/areas` — business details, capacity, languages and contact; service districts and travel
  - `/vendor/reviews`, `/vendor/settings`, and "Preview public profile"
  - Phone layout: bottom tab bar with a More sheet
- `/dashboard/*` — kept only as redirects to the new role areas (see `docs/PRODUCT_PLAN.md` 2.6)
- `/api/vendor/*` — the workspace API; every route checks `role = vendor` and that the record belongs to the signed-in vendor (another vendor's id gets 404/403). `GET /api/meta/taxonomy` returns categories, offering templates and event types from the database.
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
- `GET`/`POST /api/vendors/[id]/services`, `PATCH`/`DELETE /api/services/[id]` — a vendor's services
- `POST /api/reviews/[id]/report` — report a review; stored in `review_reports` for later admin follow-up (there is no admin UI yet)
- `GET /api/meta` — lookup data for forms and filters (categories, Kerala districts, price units)
- `/robots.txt`, `/sitemap.xml`, custom 404/error/loading pages

**Not wired yet:** Google OAuth (button present but disabled — needs a real Google Cloud OAuth client), page-view tracking (so "profile visitors" isn't shown — only real countable stats are), customer notifications when a quote's status changes, real address/place autocomplete (current typeahead only suggests things already in our own database — full Kerala place-name suggestions would need a Google Places API key).

## Database schema

See `db/migrations/`. Tables: `users`, `vendors`, `vendor_reviews`, `quote_requests`, `favorites`, `districts`, `categories`, `services`, `portfolio_items`, `quote_request_services`, `review_reports`, `quote_status_events` (plus `schema_migrations`, written by the migration runner).

`004_vendor_workspace.sql` adds the vendor workspace model: vendor statuses (`draft`, `pending`, `changes_requested`, `approved`, `rejected`, `suspended`) and onboarding progress, offering templates and event types (seeded), service units and packages with add-ons, service areas, `custom_offering_requests`, `media_assets` and `media_albums` (existing `portfolio_items` are copied in), lead unit snapshots and `users.session_version`. It is safe on a fresh or an existing database and a re-run is a no-op. It has only been applied to local databases; review it before running it anywhere else. Run `npm run db:seed` after migrating to populate 12 sample vendors: the 9 used in the `/demo` mockup (so both stay consistent) plus an event company, a chenda troupe and a rental firm. Data lives in `db/seed-data.mjs`. Each vendor gets taxonomy offerings (package-only units, packages, add-ons), service areas, reviews and a logo, cover and gallery photos. Six of them are the plan's archetypes and also get packages and an album: event company (Kerala Celebrations Co.), photographer (with a YouTube link), caterer, venue, chenda troupe (Guruvayur Chenda Sangham) and rental (Thrissur Tent & Rentals); the event company and the caterer each have a package-only unit. The photos are generated placeholders in `db/fixtures/media` (license-free, each under 60 KB; redraw them with `node db/fixtures/make-media.mjs --force`), imported through the storage adapter into `uploads/` with the same WebP variants as real uploads.

**`db:seed` is destructive:** it deletes all vendors, reviews, quotes and favourites and re-inserts the samples. It refuses to run when the database holds non-seed data (extra or owned listings, quotes, real reviews, favourites) unless the database name ends in `_test` or you pass `npm run db:seed -- --force` (or set `SEED_CONFIRM=1`). Never point it at a database you care about.

## Testing

There's a real automated test suite now: `web/tests/api.test.mjs` — about 190 checks. Besides the vendor workspace (customers get 403 on `/api/vendor/*`, onboarding save/resume/submit gate, uploads with wrong type 415 / too large 413 / duplicates / another vendor 404, `/media` hiding pending photos, video links, "Other" offerings, package-only units, own leads only), it covers registration validation, login (including CSRF Origin/Content-Type checks and the login rate limit), protected-route redirects, vendor search (all filter types + sort ordering), vendor detail lookup, quote request submission, vendor listing creation, editing a listing, quote status updates, review submission (including the vendor rating/count actually recalculating), **favorites** (add, idempotent re-add, remove, dashboard reflects it), **search suggestions** (category/location/vendor-name matches, short-query and no-match edge cases), settings updates, logout, and role-specific dashboard content reflecting real data.

To run it:
```bash
npm run db:migrate   # if you haven't already
npm run db:seed      # ensures the 12 sample vendors exist
npm run dev           # in one terminal, leave running
npm run test:api      # in another terminal
```

Unit tests that need no server or database: `npm run test:unit` (offering/attribute validation) and `npm run test:storage` (storage adapter, `/media` route, image processing, video links).

The suite talks to `http://localhost:3000` by default. If your server runs elsewhere, set `BASE_URL` (it must be a localhost URL), e.g. `BASE_URL=http://localhost:3100 npm run test:api` (PowerShell: `$env:BASE_URL="http://localhost:3100"; npm run test:api`). It works against `npm run dev` or a production `npm run start`.

It's safe to re-run repeatedly. Every user it creates uses a run-unique `<prefix>-<RUN_ID>@example.com` email, and at the start and end of each run it deletes those test users and the listings, quotes and reviews they own (directly in the `DATABASE_URL` database, which must be on localhost; it refuses a non-local `BASE_URL`). So the absolute count checks on the 9 seeded vendors keep passing without re-seeding. If a run is interrupted, the next run cleans up the leftovers.

There is no separate `.env.test` / `DATABASE_URL_TEST` setup: the suite uses whatever database the dev server uses. To keep test data away from your dev data, create a `vela_test` database, point `DATABASE_URL` at it for both the dev server and the tests, and run `npm run db:migrate && npm run db:seed` once (seeding a `_test` database never needs `--force`).

### Browser (end-to-end) tests

`e2e/` holds a Playwright suite (public pages, sign-up → listing → quote → lead flows, and `vendor-workspace.spec.ts`: the onboarding wizard end to end, the media manager, the role redirect table, the public gallery and lightbox, and vendor nav at 390px; every test runs at a 390px phone and a 1440px desktop viewport). It starts its own dev server on port 3130 (build output in `.next-e2e/`, so it can run beside `npm run dev`) and uses the `DATABASE_URL` in `.env.local`, which must be on localhost. Users it creates match `e2e-(customer|vendor)-…@example.com` and are deleted before and after each run.

```bash
npx playwright install chromium   # once, downloads the browser
npm run db:seed                    # the suite expects the 12 sample vendors and their media
npm run test:e2e                   # HEADED=1 npm run test:e2e to watch it
```

Results land in `playwright-report/results.json` and failure traces in `test-results/` (both git-ignored). Full-page screenshots of every screen are written **outside the repo**, to `event-management-test-run/` in the folder that contains the repo; set `E2E_SHOT_DIR` to put them somewhere else. `node e2e/make-report.mjs` turns the last run into an HTML report (by default `../../event-management-test-report.html`, outside the repo).

Type checking: `npm run typecheck`. Linting: `npm run lint`.


## What a human still has to do

The code runs locally end to end, but these need a person (accounts, money, legal or product decisions). Item IDs refer to the maintenance tracker (`event-management-tracker.html`, kept next to the repo, not in it).

**Credentials and config**
- Create the real `.env.local` / hosting env vars: `DATABASE_URL` for the production database, a fresh `SESSION_SECRET` (never reuse the local one), and `NEXT_PUBLIC_SITE_URL` set to the public `https://` origin.
- No secrets are in the repo; `.env.example` holds placeholders only.

**Production database and migrations**
- Provision a managed PostgreSQL database (with backups) and run `npm run db:migrate` against it. Review the SQL in `db/migrations/` first; `003_data_integrity.sql` and `004_vendor_workspace.sql` have only been applied to local databases.
- Do **not** run `npm run db:seed` against production: it deletes vendors, quotes, reviews and favourites. Real vendor listings have to be created by vendors (or entered by hand).

**External services (none are wired up yet)**
- Email provider (e.g. Resend) and a sender domain: needed for password reset (EM-038), quote/lead notifications (EM-113) and email verification.
- Google Cloud OAuth client: the "Continue with Google" button is disabled until one exists.
- File storage bucket (e.g. Supabase Storage / S3 / R2) and its credentials for production uploads (EM-118). Locally the `local` driver writes to `uploads/`; a cloud driver for the `StorageAdapter` is planned for P3.
- SMS / WhatsApp provider if phone sign-up or SMS alerts are wanted (EM-047, EM-072); Google Places API key for real place autocomplete.
- A real support email or WhatsApp number to replace the placeholder on `/help` (EM-081).

**Deployment**
- Choose a host (e.g. Vercel or any Node 20.19+ server), set the env vars above, run `npm run build && npm run start` (or the host's equivalent), and serve over HTTPS (session cookies are `Secure` in production).
- Point the domain at it, then check `/robots.txt` and `/sitemap.xml` show the right origin.
- The login/sign-up rate limits are in-memory per server process; with several instances or serverless functions they need a shared store (e.g. Redis).

**Business, legal and product decisions (tracker status `needs-human`)**
- Privacy policy that meets India's DPDP Act and a Terms page: needs the legal entity, a grievance-officer contact and legal review (EM-079).
- Monetization model and the copy that depends on it: `/about` money section and "no cut" claim (EM-083), the `/for-vendors` offer, pricing and vendor counts (EM-078). See `docs/MONETIZATION_SPEC.md`.
- Brand and visual identity direction (EM-100); per-plate vs package price sorting (EM-014).
- Whether to build multi-vendor enquiries / shortlist compare (EM-119), WhatsApp/call buttons with click logging (EM-116) and an availability calendar (EM-117).

**Deferred engineering work (tracker status `deferred`)**
- Session revocation and change-password (EM-111); phone number, district and change-password in settings (EM-072).
- Quote replies, quoted price, cancellation and notifications (EM-113); claiming quotes sent while logged out after signing up (EM-130).
- Return 409 instead of 500 for two simultaneous sign-ups with the same email (EM-133).
- Root layout reads cookies, so static pages render on every request (EM-139); render-blocking font `@import` (EM-099, conflicts with a PROJECT_LOG decision).
- Shared template for info pages (EM-085); dark mode and replacing raw colours with tokens (EM-101).
- An admin moderation UI (review reports are stored in `review_reports` but nobody can see them yet).
