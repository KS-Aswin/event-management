# PROJECT_LOG.md — Vela (event-management)

> **If you are Claude, starting a new chat:** read this entire file first. It tells you what this project is, what's been built, what's known-broken, and what to do next. At the **end of every session**, update the "Session Log" section below with what changed — this file is the only memory that survives between chats.
>
> Repo: https://github.com/KS-Aswin/event-management
> This file (fetchable directly): https://raw.githubusercontent.com/KS-Aswin/event-management/main/PROJECT_LOG.md

---

## 1. What this is

**Vela** is an event-vendor marketplace for Kerala (weddings, birthdays, corporate events). Customers search/filter vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists), view profiles, and request quotes. Vendors get a dashboard.

**The repo has two parts — don't confuse them:**

- **`/demo`** — the original single-file HTML/CSS/JS mockup. No backend, no persistence, hardcoded sample data. Built first to design and validate the UI. Still useful as a visual reference for what the real app's UI should eventually look like.
- **`/web`** — the **real app**, being actively built now (started 2026-07-28, Session 4). Next.js + PostgreSQL, with real signup/login, hashed passwords, and a real database. This is where new feature work happens going forward.

**Origin:** Started as a rough product brainstorm (a much bigger multi-phase platform idea — AI planning, full marketplace, vendor CRM, etc.). We scoped down to a minimal front-end demo first (`/demo`), validated the UI/UX there across several sessions, and are now rebuilding it as a real app (`/web`) one feature at a time, using the demo as the design reference.

## 2. Current state (as of last session)

### `/web` (the real app) — where things stand

**Working (built and tested against a real database):**
- Next.js 16 (App Router, TypeScript) + Tailwind v4
- PostgreSQL schema (`web/db/schema.sql`): `users`, `vendors`, `vendor_reviews`, `quote_requests` — see file for exact columns
- Full auth: `POST /api/auth/register` (validates, rejects duplicate emails/weak passwords), `POST /api/auth/login` (generic error on failure, no email enumeration), `POST /api/auth/logout`. JWT session cookie via `jose`, httpOnly, 7-day expiry.
- **A single shared `<Header>`** (`app/header.tsx`), rendered once from the root layout — not duplicated per page. Handles back nav, logo, the search box (on `/search` only), and signed-in/out state everywhere consistently.
- `/` — real home page (search + category chips, links into `/search`)
- `/search` — real vendor search/filter/sort, backed by Postgres, filter state lives in the URL (shareable links, real browser back button works correctly)
- `/vendors/[id]` — real vendor profile: about, packages, real reviews, working "Request quote" modal (persists to `quote_requests`)
- `/signup`, `/login` — match the `/demo` mockup's visual design, wired to real API routes. Google button present but disabled (no OAuth client yet)
- `/dashboard` — protected, role-specific, **now real data**: vendors see real lead counts/list from `quote_requests` (or a prompt to create a listing if they don't have one), customers see their actual submitted quote requests linked to the vendor
- `/dashboard/create-listing` — a vendor account creates their own listing, which then makes them findable in `/search` and gives them real dashboard stats
- `/dashboard/edit-listing` — edit an existing listing (shares the `ListingForm` component with create, via a `mode` prop)
- Vendor dashboard leads now have a **status dropdown** (`pending`/`responded`/`booked`/`declined`), backed by `PATCH /api/quotes/[id]`
- **Customers can submit real reviews** — star rating + text, one per customer per vendor, vendor's aggregate rating/count recalculated transactionally. Blocks self-review and duplicate review, both tested.
- **Search typeahead** on the home page — suggests matching categories/locations/vendor names as you type (from our own DB, not real address autocomplete — that would need a Google Places API key)
- **Favorites/shortlist** — heart icon on vendor cards and profile pages, saved list shown on the customer dashboard
- `/settings` — real profile edit (name/email) + notification toggles, persisted to Postgres
- `/about`, `/help`, `/privacy`, `/for-vendors` — static pages with real written copy
- `web/db/seed.mjs` — seeds 9 sample vendors + reviews matching `/demo`'s data, so both versions are consistent
- **`web/tests/api.test.mjs`** — real automated test suite, 84 checks, run with `npm run test:api` against a live dev server. See Session 6–10 log entries.
- Tested via `npm run build` (must pass — TypeScript + compile check) plus the automated suite above before every commit.
- `/demo` mockup now has a live shareable link via GitHub Pages (`gh-pages` branch) — see Session 9 for how that was set up.

**Known limitations / deliberate decisions:**
- **Not using Prisma.** Its query-engine binary is hosted on `binaries.prisma.sh`, unreachable from this sandbox's network. Using the plain `pg` driver + hand-written SQL instead (`web/db/schema.sql` + `web/db/migrate.mjs`). Worth reconsidering if developing somewhere with normal network access.
- **Not using `next/font/google`.** Same class of problem (fetches at build time). Using a plain CSS `@import` in `globals.css` instead — arguably more robust anyway, not just a workaround.
- **No NextAuth/Auth.js.** Hand-rolled auth (bcrypt + jose + httpOnly cookies) to avoid a third dependency-compatibility risk after the above two surprises. Legitimate common pattern, not a hack — revisit if the project wants more OAuth providers later.
- **This Next.js version (16.2.12) is newer than what's likely in Claude's training data** — read `node_modules/next/dist/docs/` before assuming an API. Confirmed so far: `cookies()`, page `params`, and `searchParams` are all `Promise`s that need `await`.
- **Background processes (dev server, Postgres) don't survive between separate tool calls in this sandbox** — always start them together with whatever you're about to test, in one shell invocation, or they'll be gone by the next command.
- Vendors are static seed data — no real vendor account owns/edits a listing yet (see backlog).

### `/demo` (the mockup) — unchanged, see the detailed feature list further down this file from earlier sessions.


- Home page (Google-style, centered search, animated placeholder, category chips)
- Search results page with filters (category, location, min rating, sort) — filters use custom chip-style checkboxes (not native checkboxes) with a "Clear all" reset and a mobile-collapsible filter panel
- Vendor profile pages (about, packages, reviews) — vendor "photos" are **illustrated CSS/SVG gradient tiles per category**, not real photos (see "Known limitations" below for why)
- "Request a quote" modal (fake submit, shows a toast, no real backend)
- Sign up / Log in, with a customer/vendor role toggle, fake Google sign-in button
- Logged-in state persists across navigation (single shared header component renders "Hi, {name} / Logout" vs. "Sign in")
- Dashboard — different content for customer role (sample event checklist) vs. vendor role (sample stats: visitors, leads, conversion)
- Settings page (edit name/email, toggle notification prefs, logout, disabled "delete account")
- Static pages: About, Help (FAQ), Privacy, For Vendors — with real written copy, not lorem ipsum
- Back-button navigation works consistently everywhere (single shared header + a view history stack — this was a real bug earlier, fixed by centralizing the header instead of duplicating nav markup per page)
- Automated test suite (`tests_click-through.js`, uses jsdom) simulates a user clicking through every flow above and asserts nothing throws and views transition correctly. **Run this after any change**, see section 5.

**Known limitations (intentional, not bugs):**
- No backend — nothing persists after a page reload. All "sessions," "quotes," "settings changes" are in-memory JS variables only.
- Vendor images are illustrated tiles, not real photos. **This was a deliberate fix, not an oversight**: real hotlinked photos (tried Unsplash direct URLs) do not load inside Claude's sandboxed artifact preview — external image requests appear to be blocked there. If you move this to a real hosted environment (GitHub Pages, Vercel, etc.) outside the Claude sandbox, real `<img src="https://...">` tags would likely work fine there — this hasn't been tested outside the sandbox yet.
- Google Fonts (`Poppins`/`Inter`) are loaded via `@import` from `fonts.googleapis.com` — same sandbox caveat may apply; falls back gracefully to system fonts if blocked.
- No real form validation beyond browser-default `required` attributes.
- No accessibility audit has been done beyond basic alt text / aria-labels on icon buttons.

## 3. File structure

```
/README.md                        ← top-level overview, points here and to demo/web READMEs
/PROJECT_LOG.md                   ← this file — session history + handoff notes

/demo/                            ← original front-end-only mockup (no backend)
  index.html                      ← the entire mockup app (HTML+CSS+JS, single file)
  tests_click-through.js          ← jsdom test suite: node demo/tests_click-through.js

/web/                             ← the REAL app — Next.js + PostgreSQL, active development
  README.md                       ← setup instructions (env vars, DB, running locally)
  app/                            ← Next.js App Router pages + API routes
    page.tsx                      ← real home page (search + category chips)
    header.tsx                    ← the ONE shared header, rendered from layout.tsx — don't duplicate this per-page
    layout.tsx                    ← root layout — fetches session once, renders Header + children
    globals.css                   ← Tailwind v4 theme + brand colors + font import
    login/page.tsx                ← real login form (client component)
    signup/page.tsx               ← real signup form (client component, reads ?role= from URL)
    dashboard/page.tsx            ← protected dashboard, role-specific content (server component)
    settings/page.tsx             ← protected settings (server component, fetches user record)
    settings/settings-form.tsx    ← client component: profile fields, notification toggles, logout
    search/page.tsx               ← vendor search results (server component, reads searchParams)
    search/search-filters.tsx     ← client component: chip filters, updates URL query string
    vendors/[id]/page.tsx         ← vendor profile (server component)
    vendors/[id]/quote-button.tsx ← client component: quote request modal
    about/page.tsx, help/page.tsx, privacy/page.tsx, for-vendors/page.tsx  ← static pages
    api/auth/register/route.ts    ← POST — create user, hash password, start session
    api/auth/login/route.ts       ← POST — verify password, start session
    api/auth/logout/route.ts      ← POST — clear session
    api/account/route.ts          ← PATCH — update name/email/notification prefs
    api/vendors/route.ts          ← GET — search/filter/sort vendors
    api/vendors/[id]/route.ts     ← GET — single vendor + reviews
    api/vendors/[id]/quotes/route.ts ← POST — submit a quote request
  lib/
    db.ts                         ← pg Pool singleton + all query functions (users, vendors, reviews, quotes)
    password.ts                   ← bcrypt hash/verify
    session.ts                    ← JWT session cookie create/read/destroy
    vendorVisuals.tsx              ← category → gradient+icon mapping, <VendorTile> component
  db/
    schema.sql                    ← the actual DB schema (source of truth) — users, vendors, vendor_reviews, quote_requests
    migrate.mjs                   ← applies schema.sql to $DATABASE_URL — node db/migrate.mjs
    seed.mjs                      ← populates sample vendors/reviews — node db/seed.mjs (idempotent)
  .env.example                    ← template for required env vars (DATABASE_URL, SESSION_SECRET)
```

## 4. Next steps / backlog (not yet done)

Roughly in priority order — pick up wherever makes sense:

- [ ] **Deploy the real app somewhere** (Vercel + a hosted Postgres like Neon) — still the biggest gap, needs the user's account creation. In progress as of Session 9/10.
- [ ] **Real location/address autocomplete** (Google Places API) — the current typeahead (Session 10) only suggests locations/vendors/categories that already exist in our own database, not arbitrary Kerala place names. Needs a Google Maps Platform API key from the user.
- [ ] **Vendor stats are still incomplete on purpose.** "Profile visitors" and "conversion rate" aren't shown since there's no page-view tracking.
- [ ] **No customer-facing notification when a quote's status changes.**
- [ ] **Google OAuth** — needs a real Google Cloud OAuth client from the user.
- [ ] Revisit the original bigger product brief (AI planner, full vendor CRM, admin panel, etc.) if/when ready to scope further.
- [ ] No mobile-specific manual testing has been done on `/web` yet.
- [ ] The API test suite covers backend behavior well but not UI rendering/interaction — consider Playwright later if UI regressions become a concern.
- [ ] Favorites has no "remove" button on the dashboard list itself yet — you'd need to go to the vendor's profile page and un-heart it there.

## 5. How to verify changes before committing

**For `/demo` changes:**

```bash
npm install jsdom       # if not already installed
node demo/tests_click-through.js
```
Should print `0 failed / 43 checks` (the check count may grow over time — that's fine, just confirm 0 failed).

**For `/web` changes:**
```bash
cd web
npm install
cp .env.example .env.local   # fill in DATABASE_URL and SESSION_SECRET
npm run db:migrate           # apply schema
npm run db:seed              # populate sample vendors
npm run build                # catches TypeScript errors — must succeed
npm run dev                  # in one terminal, leave running
npm run test:api             # in another terminal — should print "N passed, 0 failed"
```
Both `npm run build` and `npm run test:api` should pass with zero failures before committing anything in `/web`. If you add a new API route or behavior, add a corresponding check to `web/tests/api.test.mjs` in the same commit — don't let the suite fall behind the code.

## 6. Session Log

> Add a new dated entry each session, newest at the top. Keep entries short — a few lines of what changed and why, not a full diff.

### 2026-07-28 — Session 10 (search typeahead, favorites/shortlist)
- User asked specifically for "while typing, locations list down" (search suggestions) and to build anything else useful that doesn't need new credentials from them. Built two features:
- **Search typeahead** (`GET /api/suggest?q=`) — as you type in the home page search box (2+ characters, debounced 250ms), a dropdown shows matching categories, locations, and vendor names, grouped. Clicking a category/location jumps straight to filtered `/search` results; clicking a vendor goes straight to their profile. Closes on outside click or Escape (deliberately not on input blur, since blur fires before a click on a suggestion registers — would have closed the dropdown before the click could land).
  - **Honest limitation, noted in the backlog:** this only suggests things that already exist in our database (vendor locations/names/categories) — it is NOT real address autocomplete like Google Maps. Real place-name autocomplete for all of Kerala would need the Google Places API, which needs a Google Cloud API key from the user. Didn't want to leave that distinction implicit.
- **Favorites/shortlist** — heart-icon toggle button (`lib/favorite-button.tsx`, shared between vendor cards on `/search` and the vendor profile page), backed by `POST`/`DELETE /api/vendors/[id]/favorite`. New `favorites` table with a unique constraint on `(customer_id, vendor_id)` so toggling is idempotent (`ON CONFLICT DO NOTHING` on add). Customer dashboard now has a "Your favorites" section.
- Caught and fixed my own editing mistake mid-session: a `str_replace` accidentally deleted the `FavoriteVendor` interface while adding a new function nearby (the old string being replaced included the interface, the replacement didn't). Caught it with a quick `grep` before running the build, not by the build failing — worth doing that check proactively when a `str_replace` on a shared file feels like it might have touched more than intended.
- Extended `web/tests/api.test.mjs` to 84 checks (from 69): favorites (add, idempotent re-add, remove, no-auth, bad id, dashboard reflects it), search suggestions (short query returns empty not an error, category/location/vendor-name matches, no-match case).
- Full suite run against a freshly-seeded database: **84 passed, 0 failed**. Clean `npm run build` (24 routes).
- Updated `web/README.md` and this file.

### 2026-07-28 — Session 9 (customer reviews, GitHub Pages for the demo)
- **Reviews can now be submitted for real.** Added `customer_id` to `vendor_reviews` (nullable — seed reviews don't have one), plus a partial unique index (`WHERE customer_id IS NOT NULL`) preventing the same customer from reviewing the same vendor twice. Added `POST /api/vendors/[id]/reviews` and a star-rating `ReviewForm` client component on the vendor profile page.
- `createVendorReview` runs the insert **and** the vendor's aggregate rating/review-count recalculation inside a single DB transaction (`BEGIN`/`COMMIT`, with `SELECT ... FOR UPDATE` on the vendor row to avoid a race if two reviews land at the same time). Recomputes the average from every review each time rather than incrementally adjusting a running average — simpler to reason about correctly, and the table will never be large enough for that to matter performance-wise.
- Blocks two specific misuse cases explicitly, each with its own test: a vendor reviewing their own listing (403), and a customer reviewing the same vendor twice (409, caught via the DB's unique constraint — `pg` error code `23505` — rather than a separate check-then-insert, so it's race-safe too).
- The profile page now shows, depending on who's looking: the review form (signed in, hasn't reviewed yet, not their own listing), "you've already reviewed this vendor" (signed in, already reviewed), a sign-in prompt (logged out), or nothing (viewing your own listing).
- **Finally resolved the long-pending GitHub Pages request.** Since GitHub's Pages API only serves from a branch's `/` or `/docs`, and `/demo` is neither, created a dedicated `gh-pages` branch containing just `demo/index.html` copied to the branch root — keeps `main`'s `/demo` folder as the actual source of truth, `gh-pages` is just a deploy target. Pushed that branch successfully, but **enabling Pages itself via the API failed** — the fine-grained PAT's "Administration: write" scope doesn't cover the separate "Pages" permission category GitHub's Pages API requires, and gave a 403. Talked the user through flipping the one setting manually (Settings → Pages → source = `gh-pages` branch, root) — no new token needed since it's just a repo setting, not a write operation.
- Extended `web/tests/api.test.mjs` to 69 checks (from 59): review submission (success + all rejection cases: no auth, bad rating range, body too short, own-listing, duplicate, nonexistent vendor), confirms the vendor's `reviews_count` and `rating` actually update correctly after a real review lands, confirms the new review's text actually renders on the profile page (not just that the API call succeeded).
- Full suite run against a freshly-seeded database: **69 passed, 0 failed**. Clean `npm run build` (22 routes).
- **Also in progress this session (not yet complete):** walking the user through real deployment — Neon for Postgres, Vercel for hosting, importing from this repo with root directory set to `web/`. Waiting on the user to create those accounts; I'll finish the database schema setup on the live Neon instance once they share the connection string.
- Updated `web/README.md` and this file.

### 2026-07-28 — Session 8 (edit listing, respond to leads)
- Added `PATCH /api/vendors/[id]` — a vendor can now edit their own listing (name, category, location, price, experience, tags, about). Refactored `create-listing-form.tsx` into a shared `ListingForm` component with `mode="create" | "edit"`, used by both `/dashboard/create-listing` (unchanged) and the new `/dashboard/edit-listing`.
- Added `PATCH /api/quotes/[id]` — a vendor can change a lead's status (`pending` → `responded`/`booked`/`declined`) via a dropdown on the dashboard (`lead-status-control.tsx`, optimistic update with rollback on failure).
- **Security detail worth remembering:** both new PATCH routes check ownership *inside* the SQL `WHERE` clause (`WHERE id = $1 AND owner_id = $2`) rather than as a separate "fetch then check" step. This means there's no window for a race condition, and — just as importantly — a caller editing someone else's listing/quote gets the same 404 whether the id doesn't exist at all or exists but isn't theirs. Returning 403 instead would leak "this id is real, you just can't touch it," which is a minor but real information leak. Test suite explicitly checks for 404, not 403, in both cases.
- Extended `web/tests/api.test.mjs` to 59 checks (from 46): edit-listing (success, no-auth, wrong-owner, nonexistent-id, confirms unedited fields stay unchanged), quote status updates (success, no-auth, invalid status value, wrong-owner, dashboard reflects the change).
- Full suite run against a freshly-seeded database: **59 passed, 0 failed**. Clean `npm run build` (20 routes).
- Updated `web/README.md` and this file.

### 2026-07-28 — Session 7 (dashboard now shows real data, vendors can create listings)
- **Removed the last remaining fake data from the app.** The dashboard used to show honestly-labeled sample stats/checklists — now it shows real data, which required solving vendor ownership first (a vendor account had no way to actually own a listing before this):
  - Added `POST /api/vendors` — a vendor account creates their own listing (name, category, location, price, experience, tags, about). Rejects: not signed in (401), signed in as customer (403), invalid category (400), already has a listing (409).
  - Added `/dashboard/create-listing` — the form for the above, only reachable by a vendor without an existing listing (redirects away otherwise).
  - Rewrote `/dashboard`: vendor view now shows real counts (total leads, pending leads, review count) and a real recent-enquiries list from `quote_requests`, or a "create your listing" prompt if they don't have one yet. Customer view now shows their actual submitted quote requests (vendor name/category, event date, status), linked to the vendor's profile, or an empty state pointing to `/search` if they haven't requested any yet.
  - Added DB functions: `findVendorByOwner`, `createVendorListing`, `findQuoteRequestsByCustomer` (joined with vendor name/category), `findQuoteRequestsByVendor`.
  - Deliberately did **not** fake "profile visitors" or "conversion rate" for vendors since there's no page-view tracking to back those numbers — removed them rather than keep showing sample numbers next to now-real ones, which would have been misleading in a different way (mixing real and fake data on the same screen).
- Extended `web/tests/api.test.mjs` to 46 checks (from 37): listing creation (success + all 4 rejection cases), vendor dashboard reflecting the new listing's real stats, customer dashboard reflecting a real submitted quote.
- **Caught a real bug in the test suite itself** (not the app) while doing this: an old assertion checked the dashboard HTML for `"Venue" + "booked"`, which was leftover hardcoded sample text from *before* this session's rewrite — it broke correctly once the fake data was removed, which is exactly what a good test should do, but the assertion needed updating to check for real content instead of being deleted. Worth remembering: when replacing fake/sample data with real data, always re-check existing test assertions for hardcoded strings tied to the old fake data, don't just add new tests and assume old ones still make sense.
- Full suite run against a freshly-seeded database: **46 passed, 0 failed**. Clean `npm run build` (19 routes).
- Updated `web/README.md` and this file.

### 2026-07-28 — Session 6 (automated API test suite)
- Built `web/tests/api.test.mjs` — a real, repeatable automated test suite (37 checks) replacing the manual curl/psql testing from Sessions 4–5. Covers: registration validation (duplicate email, weak password, invalid role), login (correct/wrong password, confirms no email enumeration on failure), protected-route redirects, vendor search (every filter type + sort-order correctness, not just count), vendor detail 404/400 handling, quote request submission + validation, settings updates (including the auth-required check and an email-conflict check), logout, and — importantly — actually checks that the *customer* vs *vendor* dashboard render different, role-correct content (not just that both return 200).
- Design choice: uses a timestamp-based unique email per run (`test-customer-${RUN_ID}@example.com`) for anything that creates a user, so the suite is safe to re-run repeatedly without needing to reset the database between runs.
- Added `npm run db:migrate`, `npm run db:seed`, `npm run test:api` convenience scripts to `package.json`.
- Caught and fixed a bug in my own first draft of the test script (a check that only verified a response *wasn't* JSON, rather than actually checking dashboard content) before it was ever committed — see the `text` field added to the `request()` helper so assertions can check rendered HTML, not just JSON responses.
- Ran the full suite against a real, freshly-seeded database: **37 passed, 0 failed**, exit code 0.
- Updated `web/README.md` (Testing section) and this file. Removed "add automated tests" from the backlog since it's now done.
- Reconfirmed the sandbox quirk from Session 5: Postgres + the dev server must be started together with the test run in one shell invocation, or they get killed between tool calls. Added a proper readiness poll (`curl` retry loop) instead of a fixed `sleep`, since route count has grown enough that a fixed sleep occasionally wasn't long enough.

### 2026-07-28 — Session 5 (vendor search, profiles, quotes, settings)
- Extended the schema: `vendors`, `vendor_reviews`, `quote_requests` tables, plus `email_notifications`/`sms_notifications` columns on `users` (see `web/db/schema.sql`).
- Wrote `web/db/seed.mjs` — seeds the same 9 sample vendors + reviews used in `/demo`, so both versions show consistent data. Idempotent (clears and re-inserts).
- Added DB query functions in `lib/db.ts`: `findVendors` (with query/category/location/minRating/sort filters), `findVendorById`, `findAllLocations`, `findReviewsByVendor`, `createQuoteRequest`, `updateUser`.
- Built `lib/vendorVisuals.tsx` — React port of the demo's illustrated category tiles (gradient + SVG icon per category), so vendor "photos" render consistently without depending on external images.
- **Centralized navigation properly this time**: built a single `<Header>` client component, rendered once in the root layout (`app/layout.tsx`), which fetches the session server-side and passes it down. This was a deliberate response to the exact bug class that caused problems in `/demo` (duplicated per-page headers drifting out of sync) — here it's structurally impossible to duplicate since there's only one `Header` instantiation in the whole app.
- Built real pages, each backed by the database: `/` (home/search entry), `/search` (filters + results, filter state lives in the URL query string — shareable, uses the browser's real back button correctly, no hand-rolled view-stack needed since these are real routes), `/vendors/[id]` (profile + real reviews + working quote-request modal), `/settings` (real profile edit + notification toggles, persisted), `/about`, `/help`, `/privacy`, `/for-vendors`.
- Added API routes: `GET /api/vendors`, `GET /api/vendors/[id]`, `POST /api/vendors/[id]/quotes`, `PATCH /api/account`.
- Rewrote `/dashboard` with real role-specific content (still sample stats/checklist data, honestly labeled as such in the UI — not yet tied to real quote-request data).
- Confirmed `params` and `searchParams` are `Promise`s in this Next.js version for both pages and route handlers (`await params`) — checked the bundled docs first rather than assuming, per the `AGENTS.md` warning.
- **Tested for real again**: ran `npm run build` (clean, 18 routes, no errors), then ran the dev server against a real Postgres database and hit it with 15 `curl`/`psql` checks covering vendor search filters (category, location, rating, text search on tags), vendor detail lookup + 404 handling, quote request submission + validation, and settings updates + the auth-required check. 14/14 real behaviors correct (one reported "failure" was a bug in the test script's own assertion, not the app — logged so it's not mistaken for a real issue later).
- Updated `web/README.md` and this file.
- **Known gap carried forward:** background processes (the dev server, Postgres) do not persist between separate tool calls in this sandbox — every testing session needs `service postgresql start` + `npm run dev` re-run together in one shell invocation. Not a project bug, just a sandbox quirk worth remembering next session so time isn't wasted rediscovering it.

### 2026-07-28 — Session 4 (real app started)
- User decided on stack for the real app: Next.js (App Router, TypeScript) + Tailwind v4 + PostgreSQL, with a real backend from day one (not mocked) — see chat for the decision process.
- Installed PostgreSQL locally in the dev sandbox and created a `vela_dev` database, to actually build and test against instead of writing backend code blind.
- Scaffolded the Next.js app in `/web` via `create-next-app`.
- **Hit two dependency/network dead-ends in this sandbox, worked around both rather than faking success:**
  - Prisma's query-engine binary is hosted on `binaries.prisma.sh`, which this sandbox's network policy blocks (confirmed with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` — still 403'd on the actual binary fetch, not just the checksum). Removed Prisma, switched to the plain `pg` driver with hand-written SQL (`web/db/schema.sql` + `web/db/migrate.mjs`).
  - `next/font/google` (used by default in the create-next-app template) also fetches at build time from a Google-owned CDN — same class of problem. Removed it, switched to a plain CSS `@import` in `globals.css` (fetched by the browser at runtime instead, which sidesteps the issue entirely).
- Read this Next.js version's bundled docs (`node_modules/next/dist/docs/`) before writing route handlers, since `web/AGENTS.md` explicitly warns this version (16.2.12) has API changes from what's likely in training data — confirmed e.g. `cookies()` is `async` here.
- Built real signup (`POST /api/auth/register`) and login (`POST /api/auth/login`) API routes: bcrypt password hashing, duplicate-email rejection (409), weak-password rejection (400), generic error on wrong password (401, doesn't reveal whether the email exists), JWT session cookie (via `jose`) on success.
- Built `/signup` and `/login` pages matching the `/demo` mockup's visual design (Tailwind, same green/gold brand colors, same layout/copy), including the customer/vendor role toggle and a disabled "Continue with Google" button (honestly labeled as not-yet-connected rather than faked).
- Built a protected `/dashboard` placeholder page + logout, to prove the full session loop works — not the real dashboard UI yet, that's next.
- **Tested for real, not just written**: ran the actual dev server and hit every API route with `curl` against the live local Postgres database — registered a user, confirmed duplicate email and weak password get rejected, confirmed the dashboard redirects when logged out and shows correct name/role when logged in, confirmed login with wrong password fails with the right error, registered a second user as a vendor and confirmed the role stored/displayed correctly, logged out, and directly queried the `users` table in Postgres to confirm both rows were really there. All passed.
- Ran `npm run build` (production build, includes TypeScript checking) — succeeded with no errors.
- Restructured the repo: moved the old mockup into `/demo`, added the new app as `/web`, rewrote the top-level `README.md` to explain the split, wrote `web/README.md` with local setup steps.
- Confirmed no secrets leaked into the commit (`.env.local` correctly gitignored, only `.env.example` with placeholder values is committed).
- **Open question for next session:** GitHub Pages for `/demo` was asked about at the end of Session 3, no answer received yet — still pending.

### 2026-07-28 — Session 3
- Diagnosed and fixed: vendor images weren't loading because the Claude artifact sandbox blocks external image requests (not a code bug — confirmed by testing both Unsplash and picsum.photos URLs, neither loaded). Replaced all vendor photos with illustrated CSS/SVG gradient tiles, one style per category (Venue, Photography, Catering, Decoration, DJ & Music, Makeup, Mehendi).
- Re-ran the full 43-check automated test suite after the fix — all passing.
- Created the GitHub repo `KS-Aswin/event-management` (public) and pushed the code for the first time, in 3 commits (README/gitignore, app v1, test suite).
- Created this file (`PROJECT_LOG.md`) for cross-session continuity.
- **Open question for next session:** does the user want GitHub Pages enabled? (asked, awaiting answer)

### 2026-07-28 — Session 2 (rebuild)
- Full navigation rebuild: replaced per-page duplicated header markup with a single shared header component (`renderHeader()`), fixing a class of bugs where back buttons / sign-in state were inconsistent across pages.
- Added a real logged-in dashboard (role-specific: customer vs. vendor), a Settings page, and real static pages (About, Help, Privacy, For Vendors) — previously these were dead `#` links.
- Replaced native checkboxes in the filter panel with custom chip-style toggles (better visual feedback, matches the rest of the UI).
- Sourced real Unsplash photo URLs for vendor images (later found not to work in the sandbox — see Session 3).
- Built a jsdom-based automated test script and used it to verify the rebuild before showing the user (43 checks, initially caught a `window.session` scoping issue in the test itself, fixed).

### 2026-07-28 — Session 1 (initial mockup)
- Took the original big product brief (full marketplace platform: AI planner, vendor CRM, admin panel, multi-phase rollout) and scoped it down to a minimal front-end demo, matching a "simple like Google" home page aesthetic per the user's request.
- Built the first version: Google-style home page, then expanded into a full click-through demo (search results with filters, vendor profile pages, quote request modal) with realistic sample data (9 vendors across 7 categories, Kerala locations, realistic pricing).
- Added sign up / log in UI (customer vs. vendor role toggle).
- Fixed several reported UX bugs: native-checkbox styling, missing back buttons, filters not clearing.

---

## 7. Conventions to keep following

- Single-file app (`index.html`) — don't split into multiple files unless the user asks, keeps it trivially easy to preview/share.
- Keep the visual style: minimal, Google-inspired, green (`#0f6d52`) + gold (`#c9a227`) accent, Inter/Poppins fonts, generous whitespace.
- Any new interactive feature should get a corresponding check added to `tests_click-through.js`, and the suite should be run (and pass) before telling the user it's done.
- Don't reintroduce hotlinked external images without testing whether they actually render in the current preview context first.
- Update this file before ending a session — that's the whole point of it.
