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
- Next.js 16 (App Router, TypeScript) + Tailwind v4 scaffolded in `/web`
- PostgreSQL schema (`web/db/schema.sql`) with a `users` table (id, name, email, password_hash, role, created_at)
- `POST /api/auth/register` — validates input, rejects duplicate emails (409) and weak passwords (400), hashes password with bcrypt, creates user, signs them in
- `POST /api/auth/login` — verifies against the stored hash, generic error on failure (doesn't reveal whether the email exists — deliberate, prevents email enumeration)
- `POST /api/auth/logout` — clears the session cookie
- Session handling: JWT (via `jose`) in an httpOnly cookie, 7-day expiry, verified in `web/lib/session.ts`
- `/signup` and `/login` pages — real forms styled to match the `/demo` mockup's visual design (green `#0f6d52` / gold `#c9a227`, same layout), wired to the real API routes above. Google sign-in button is present but disabled (needs a real Google OAuth client — see backlog)
- `/dashboard` — protected route (redirects to `/login` if no valid session); currently just a placeholder proving the auth loop works, **not** the real dashboard UI from the mockup yet
- All of the above was tested end-to-end with real `curl` requests against a running dev server + a real local Postgres instance — see Session 4 log entry for the full test list. Not covered by an automated test suite yet (see backlog).

**Known limitations / deliberate decisions:**
- **Not using Prisma.** Prisma requires downloading a native engine binary from `binaries.prisma.sh`, which was unreachable from the sandbox this was built in. Switched to the plain `pg` driver + hand-written SQL in `web/db/schema.sql`, applied via `web/db/migrate.mjs`. If you're developing somewhere with normal unrestricted network access, reintroducing Prisma is a reasonable option to reconsider — but the current approach works fine and has no such dependency risk.
- **Not using `next/font/google`.** Same class of problem — it fetches font files at build time, which failed in the sandbox for the same reason. Fonts are loaded via a plain CSS `@import` in `web/app/globals.css` instead (fetched by the browser at runtime, not at build time — so this one's arguably more robust anyway, not just a workaround).
- **No NextAuth/Auth.js.** Given the above two surprises with newer/beta dependencies in this environment, auth was hand-rolled (bcrypt + jose + httpOnly cookies) to avoid a third dependency-compatibility risk. This is a legitimate, common pattern, not a hack — but if the project later wants OAuth providers beyond Google, or magic links, etc., Auth.js is worth revisiting then.
- **This Next.js version (16.2.12) is newer than what's likely in Claude's training data** — it ships its own docs in `node_modules/next/dist/docs/`, and explicitly warns about this in `web/AGENTS.md`. Read the actual docs there before assuming an API (e.g. `cookies()` is `async` in this version).
- No automated tests for `/web` yet (unlike `/demo`, which has a jsdom suite) — manual `curl`-based testing only so far.

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
    page.tsx                      ← placeholder landing page
    login/page.tsx                ← real login form (client component)
    signup/page.tsx               ← real signup form (client component)
    dashboard/page.tsx            ← protected placeholder dashboard (server component)
    dashboard/logout-button.tsx   ← client component (logout needs onClick)
    api/auth/register/route.ts    ← POST — create user, hash password, start session
    api/auth/login/route.ts       ← POST — verify password, start session
    api/auth/logout/route.ts      ← POST — clear session
    globals.css                   ← Tailwind v4 theme + brand colors + font import
    layout.tsx                    ← root layout
  lib/
    db.ts                         ← pg Pool singleton + user queries
    password.ts                   ← bcrypt hash/verify
    session.ts                    ← JWT session cookie create/read/destroy
  db/
    schema.sql                    ← the actual DB schema (source of truth)
    migrate.mjs                   ← applies schema.sql to $DATABASE_URL — node db/migrate.mjs
  .env.example                    ← template for required env vars (DATABASE_URL, SESSION_SECRET)
```

## 4. Next steps / backlog (not yet done)

Roughly in priority order — pick up wherever makes sense:

- [ ] **Build out the real dashboard UI** in `/web` (currently a placeholder) — port the customer/vendor dashboard design from `/demo`'s `renderDashboard()` function.
- [ ] **Build the vendor search/results/profile pages** in `/web`, backed by a real `vendors` table (doesn't exist yet — only `users` exists so far). Use `/demo`'s vendor data shape as the reference for what fields a vendor needs.
- [ ] **Settings page** in `/web` (profile edit, notification prefs) — port from `/demo`.
- [ ] **Add an automated test suite for `/web`** — the manual curl-based testing from Session 4 should become a real script (options: a lightweight Node script hitting the API routes directly like the curl tests did, or Playwright for full browser-level testing including the UI).
- [ ] **Google OAuth** — needs a real Google Cloud OAuth client (client ID + secret), which only the project owner can create in Google Cloud Console. The button is present but disabled until then.
- [ ] Decide on hosting for the real app (Vercel is the natural fit for Next.js) and a real production Postgres (Neon, Supabase, Railway, etc. all have free tiers) — nothing is deployed anywhere yet, everything so far only runs locally / in the dev sandbox.
- [ ] Enable GitHub Pages for the `/demo` folder specifically, so there's a live shareable link for the mockup (not done yet — was asked about, no answer received yet).
- [ ] Test whether `/demo`'s real `<img>` photo idea would work outside the Claude sandbox (e.g. on GitHub Pages) — if so, could reintroduce real vendor photos there; not relevant to `/web` since that runs on a normal server anyway (not sandboxed), so real images should just work there once vendor profiles are built — worth confirming when that point is reached.
- [ ] Revisit the original bigger product brief (AI planner, full vendor CRM, admin panel, etc.) if/when ready to scope further — that content isn't in this repo, it was discussed in chat only.
- [ ] No mobile-specific manual testing has been done on `/web` yet.

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
node db/migrate.mjs          # apply schema to your database
npm run build                # catches TypeScript errors — must succeed
npm run dev                  # then manually test, or hit the API routes with curl
```
There's no automated suite for `/web` yet (see backlog) — until there is, at minimum run `npm run build` and manually verify signup/login/logout work against a real database before committing.

## 6. Session Log

> Add a new dated entry each session, newest at the top. Keep entries short — a few lines of what changed and why, not a full diff.

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
