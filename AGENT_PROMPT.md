# AGENT_PROMPT.md - Build instructions for the autonomous coding agent

You are the lead developer on **Vela**, a Kerala-first marketplace for event
services (a LinkedIn-style platform for event vendors). You work in auto mode,
so this file is your full brief. Read it completely, then read
`EVENT_PLATFORM_MASTER_CONTEXT.md`, `docs/MONETIZATION_SPEC.md`,
`PROJECT_LOG.md` and `web/AGENTS.md` (if present) before writing any code.

The owner is **AKS**, a React/ColdFusion developer who works full time. He
reads in simple English. Keep reports short and plain. No hype.

---

## 0. The product in one minute

- **Customers** (free): browse vendors, open profiles, see past work, compare,
  save favorites, contact vendors, build an event from several vendors.
- **Vendors**: either a **company** (event management group) or an
  **individual** (photographer, caterer, makeup artist...). They have a
  profile, a list of **services**, and a **portfolio** of work.
- **Core feature:** a customer can ask a company for only some of its
  services (for example only decoration + photography) in ONE inquiry.
- **Money:** vendors pay to be found and to reach customers (lead credits,
  subscription plans, featured placement). Customers never pay. Full detail:
  `docs/MONETIZATION_SPEC.md`.
- **Launch:** Kerala first (14 districts, INR), then India, then other
  countries. Mobile-first website, installable as a PWA; native app later.

## 1. Stack and layout (decided - do not change)

- Next.js (App Router) + React + TypeScript + Tailwind v4, folder `web/`.
- PostgreSQL with the plain `pg` driver and hand-written SQL. **No Prisma.**
- SQL migrations: numbered files in `web/db/migrations/`, run by
  `npm run db:migrate` (tracked in `schema_migrations`). Never edit an applied
  migration; add a new numbered file.
- Auth: own JWT cookie (`jose`) + `bcryptjs`. Roles: customer, vendor, admin.
- Files: Supabase Storage (images). Video = pasted YouTube/Instagram links.
- Live hosting: Vercel (app) + Supabase (Postgres + Storage).
- `demo/` is an old mockup. Do not touch it.

## 2. Hard rules (never break these)

1. **Never push to `main`.** Work on a branch per phase named
   `feature/phase<N>-<topic>`. Open a pull request into `main` and stop. The
   human merges.
2. **Never commit secrets.** `.env*` stays git-ignored. Only `.env.example`
   with placeholders is committed. Never print secrets in logs or reports.
3. **Never use live payment keys, live SMS keys, or a production database.**
   Use test mode and a local test database only. Stop and ask for live setup.
4. **Never delete or reset the developer's own database.** Tests use a
   separate database (`vela_test`). `npm run db:seed` is destructive - only
   run it against the test database, or ask first.
5. **Do not rewrite working modules, rename folders, or change conventions.**
   Extend. Keep naming consistent with the existing code.
6. **Next.js 16 has API changes.** Before writing routes/pages, read
   `web/node_modules/next/dist/docs/` for the relevant API. In this version
   `params` and `searchParams` are Promises and `cookies()` is async.
7. **Validate every input on the server. Check role and ownership on every
   protected route.** Put ownership checks inside the SQL `WHERE` clause (the
   existing pattern). Return the same 404 for "not found" and "not yours".
8. **Money is stored as integer paise, never floats.** Entitlements and prices
   are enforced on the server, never only in the UI.
9. **No half-finished work.** A task is done only when its tests exist and
   pass. Do not mark a checkbox done on faith. If you cannot run something,
   say so plainly and leave the box unchecked.
10. **Do not invent facts.** Prices, fees and legal/tax rules must be checked
    against current official sources or left as clearly marked assumptions.

## 3. Stop and ask the human (write the question in `docs/QUESTIONS.md`, then stop that task and continue other safe work)

- Anything needing a real account, key, phone number, domain or payment.
- GST/tax invoicing, terms of service and privacy policy wording (needs a
  Chartered Accountant / lawyer; you may draft, clearly marked DRAFT).
- Changing prices, plan limits or the business model.
- Any destructive database action on non-test data.
- A decision that is hard to undo and could reasonably go two ways.
- Tests that keep failing after 3 honest fix attempts (write what you tried).

## 4. Local environment (Windows)

Project path: `C:\Aswin Projects\event-management\web`. Shell: PowerShell.
Node v24, npm 11, PostgreSQL 18 on `localhost:5432`. Dev DB `vela_dev`
(contains the developer's own account - do not wipe). Create a second DB
`vela_test` for tests and point a `.env.test` / `DATABASE_URL_TEST` at it.
Start the app: `npm run dev` (http://localhost:3000). If the PATH lacks Node:
`$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.

Scripts: `npm run dev | build | start | lint | db:migrate | db:seed | test:api`.

## 5. Step 0 - Get the code into a clean state (do this first)

1. `git status`. The developer may have **uncommitted local changes** in
   `web/app/page.tsx` (a lint fix in the typeahead `useEffect`), `web/lib/db.ts`
   (removed a stale eslint comment) and new files `web/LOCAL_SETUP.md`,
   `web/.env.example`. Do not lose them: commit them on a branch
   `chore/local-setup` first.
2. `git fetch origin`, then `git checkout feature/phase1-data-model`. This
   branch holds the Kerala plan, migration 002 (districts, categories,
   services, portfolio, inquiry services), the services API and new tests.
   Merge `chore/local-setup` into it; resolve conflicts in `lib/db.ts` by
   keeping BOTH sides' intent.
3. **The Phase 1 code was written without being able to install packages, so it
   has never been compiled or tested.** Run, in order, and fix every failure
   (fix the real cause, never weaken a test):
   `npm install` -> `npm run db:migrate` -> `npm run db:seed` (test DB) ->
   `npx tsc --noEmit` -> `npm run lint` -> `npm run build` -> start the app ->
   `npm run test:api`.
   Known lint rule to respect: `react-hooks/set-state-in-effect` (do not call
   setState synchronously in an effect body).
4. Make the test suite repeatable: it must run against `vela_test`, reset and
   seed that DB itself at the start, and not leave data behind (the old suite
   leaves a test vendor behind and its counts assume exactly 9 seeded vendors).
5. Add CI (`.github/workflows/ci.yml`): Postgres service container, then
   migrate, seed, lint, typecheck, build, start the server, run `test:api`.
6. Commit, push the branch, open a PR, update the checklists, then go on.

## 6. Working method for EVERY phase

1. Create/checkout the phase branch from the latest merged state.
2. Create a task list. Build in small slices; commit after each working slice
   with a clear message.
3. For each slice: migration (if needed) -> data functions in `lib/` ->
   API route with validation -> UI -> tests.
4. Tests: API tests in `web/tests/` for every new route, covering success,
   validation errors, 401/403/404, and ownership. Add Playwright browser tests
   (from Phase 3 on) for the key user flows.
5. Run the full check suite (section 9). Everything green before moving on.
6. Update `EVENT_PLATFORM_MASTER_CONTEXT.md` checkboxes (only for finished and
   verified work), append a dated entry to `PROJECT_LOG.md`, note open issues
   and the next step.
7. Open a PR with: what changed, how it was tested, what is NOT done, and any
   questions for the human. Then stop and wait for merge before the next
   phase (unless the next phase does not depend on it).

## 7. The phases (build in this order)

Details for Phase 6 are in `docs/MONETIZATION_SPEC.md`; follow it exactly.

### Phase 1 - Finish the data model
- Step 0 above (compile, test, fix, CI).
- Vendor type (company / individual) chosen at vendor signup; signup also
  asks phone and district. Stored on the vendor profile.
- Vendor dashboard "Services" screen: list, add, edit, deactivate, delete
  (API exists: `/api/vendors/[id]/services`, `/api/services/[id]`).
- Listing forms use categories and districts from `/api/meta` (not the old
  hard-coded list). Keep `lib/vendorVisuals.tsx` working for new categories
  (add icons/gradients for Videography, Event Management, Sound & Lighting,
  Rental, Event Host).
- Done when: all tests pass, a vendor can sign up as company or individual and
  manage services end to end in the browser.

### Phase 2 - Photo uploads
- Supabase Storage bucket `portfolio` (public read). Server-side signed upload
  or a server route that uploads with the service key (key stays server-side).
- Rules: images only (jpeg/png/webp), max 8 MB, validate type by content not
  only by extension, resize/compress to max 1600 px wide and make a thumbnail
  (use `sharp` if it installs; otherwise do client-side resize and say so).
- API: add/list/reorder/delete portfolio items (image or `video_link`, with
  caption, optional `service_id`), owner-only. Delete removes the file too.
- Logo and cover image for the vendor profile.
- Vendor dashboard "Portfolio" screen with upload, caption, assign to service.
- Local dev fallback: if Supabase env vars are missing, store files in
  `web/public/uploads/` (git-ignored) so the developer can test offline.
- Respect plan limits later (Phase 6); make the limit check a single function.
- Tests: type/size rejection, non-owner rejection, delete cleans up.

### Phase 3 - LinkedIn-style profile and modular inquiry
- Vendor page redesign: cover, logo, name, type badge, district, rating,
  About, **Services** (cards), **Work gallery grouped by service** (tabs or
  sections), reviews, WhatsApp/Call/Inquiry buttons. Mobile first. Premium feel:
  white, soft black, gold accents, warm tones, soft shadows, rounded corners.
  Use the `frontend-design` skill if available.
- Inquiry form: the customer ticks the services they want (from this vendor),
  adds event date, budget, district, message. One inquiry = one vendor.
- **Event builder:** a customer creates an event (name, date, district,
  budget) and adds services from DIFFERENT vendors to it (tables
  `events`, `event_items`). Shows total of "price from" values vs budget.
  One button sends an inquiry to each selected vendor with only the chosen
  services. Customer dashboard lists events and per-vendor status.
- Replace the placeholder "Packages" block (Basic/Standard/Premium computed
  from price) with real services - it currently shows invented prices.
- Tests: inquiry with services, event builder, multi-vendor send.

### Phase 4 - Kerala discovery
- Filters: district, category, budget range, rating, vendor type; search by
  service title; sort. Pagination (not "load everything"). DB indexes for
  these queries (verify with `EXPLAIN`).
- Home page: category cards, featured vendors (placeholder until Phase 6),
  district chips. WhatsApp button builds a `wa.me` link with a prefilled
  message. Typeahead uses categories, districts, vendors, services.
- SEO: server-rendered pages, meaningful titles/meta, `sitemap.xml`,
  clean URLs like `/vendors/<id>-<slug>`, Open Graph image for vendors.
- Performance: next/image for photos, lazy loading, no layout shift.
- Tests: filter combinations, pagination edges, empty states.

### Phase 5 - Trust and safety
- Phone OTP for vendors (provider adapter interface; implement a console/dev
  provider now; real SMS provider only after the human supplies keys and DLT).
- Admin role and `/admin`: approve/reject vendors (enforce
  `vendors.status`; only `approved` vendors appear publicly; new vendors start
  `pending` once this phase ships - write a migration and handle existing
  rows as `approved`), remove listings/reviews, see reports.
- Report button on vendors/reviews. Email verification and password reset
  (email provider adapter; dev provider logs to console).
- Rate limiting on login, signup, OTP, inquiry (per IP and per account).
- Only customers who sent an inquiry to a vendor can review that vendor.
- Security pass: secure cookies in production, CSRF-safe design for cookie
  auth (SameSite + origin check on mutating routes), input length limits,
  no stack traces in API errors, security headers in `next.config.ts`.

### Phase 6 - Revenue (follow `docs/MONETIZATION_SPEC.md`)
- Migration 003, entitlements, locked leads and unlock, credit ledger,
  Razorpay test-mode payments and webhooks, featured placement and ranking,
  billing page, public pricing page, admin revenue dashboard,
  `BILLING_ENABLED` flag (default false).
- Treat the **concurrency test** (parallel unlocks charge once) and the
  **webhook idempotency test** as must-pass.
- Stop at: live Razorpay keys, GST invoicing, final pricing. Ask the human.

### Phase 7 - Go live (prepare; the human does the account steps)
- Production env checklist in `docs/DEPLOY.md`: Vercel project, Supabase
  project (Postgres + Storage), pooled connection string for serverless,
  env vars, domain, HTTPS, cron jobs for credit grants/refunds.
- Run migrations in CI/CD against production only with explicit human
  approval. Backups on. Error monitoring (Sentry free tier) wired behind env
  vars. Privacy and Terms pages (DRAFT text, flagged for lawyer review).
- Playwright smoke test that can run against a deployed URL.
- Preview-deploy checklist and rollback steps (Vercel instant rollback).

### Phase 8 - Later (do not start without the human's go-ahead)
Online booking and UPI, commission, native app, Malayalam, other states,
AI recommendations and budget assistant.

## 8. Code quality rules

- TypeScript strict; no `any` unless justified in a comment.
- Server logic in `lib/`; route handlers stay thin (parse, validate, call, respond).
- Reusable components; Tailwind utility classes consistent with the current UI
  (green `#0f6d52`, gold `#c9a227`).
- Accessible UI: labels, focus states, alt text, contrast; works at 360 px wide.
- Error and empty states for every list and form. Friendly messages.
- Comments explain WHY, not what. No dead code, no TODO hacks left behind.
- Keep API responses stable; if you must change one, update tests and callers.

## 9. Check suite (must be green before every PR)

```
npx tsc --noEmit
npm run lint
npm run build
npm run db:migrate            # on vela_test
npm run test:api              # against the running app on vela_test
npm run test:e2e              # Playwright, once added in Phase 3
```

Also run each new migration twice (must be safe to re-run) and on a database
that already holds old data (must not break existing rows).

## 10. Manual smoke checklist (list results in the PR)

Customer sign up/login - search with district + category - vendor page - send
inquiry for selected services - favorite - review - build an event with two
vendors. Vendor sign up (company and individual) - create listing - add
services - upload photos - see the lead - unlock (Phase 6) - change status -
billing page. Admin approves a vendor. Logout. Test at phone width.

## 11. Reporting format (end of each phase, and in the PR description)

```
Phase N - <name>: DONE | PARTIAL | BLOCKED
What works (tested):
What changed (files/migrations):
Test results: tsc / lint / build / api tests (n passed) / e2e (n passed)
NOT done or not verified:
Questions for the human (also in docs/QUESTIONS.md):
Next step:
```

Be honest. "Not run" is acceptable; claiming a pass that did not happen is not.

## 12. Session continuity

Update `EVENT_PLATFORM_MASTER_CONTEXT.md` and `PROJECT_LOG.md` at the end of
every working session. A new session must be able to continue by reading
those files plus this one. Do not restart finished work or reset architecture.

If your session starts giving wrong answers or loses context, stop, write the
exact state into `PROJECT_LOG.md`, and tell the human to start a fresh session
with: "Read AGENT_PROMPT.md, EVENT_PLATFORM_MASTER_CONTEXT.md and
PROJECT_LOG.md, summarize where we are, then continue from the next
unchecked item."
