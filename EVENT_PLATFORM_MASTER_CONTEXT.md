# EVENT_PLATFORM_MASTER_CONTEXT.md

Main source of truth for this project. Any AI session (or developer) must read
this file fully before changing code, continue from the current phase, and
update this file after each completed task.

Product working name: **Vela** (was "EventSphere" in the first draft).

---

## 1. What we are building

A LinkedIn-style marketplace for event services. Profiles and past work matter
most, not just a price list.

- **Customers** browse vendors, open profiles, look at past work (photos and
  video links), compare, save favorites, and contact vendors.
- **Vendors** are either a **company** (event management group) or an
  **individual** (photographer, caterer, makeup artist...). They create a
  profile, list services, upload work, and receive inquiries (leads).
- **Core feature (modular selection):** a company can sell its work in parts.
  A customer sees an event, likes only the decoration and photography, picks
  those services, and sends ONE inquiry for just those. The company replies
  with only those. Customers can also mix vendors (photographer from A,
  decoration from B, catering from C).

Feel: premium, visual, celebration-focused, portfolio-driven. Not corporate.

Colors: white, soft black, gold accents, warm tones (current app uses green
`#0f6d52` + gold `#c9a227`).

## 2. Market and expansion

1. **Kerala first** (14 districts, INR, Malayalam later, WhatsApp-first contact).
2. Rest of India, state by state (the `districts` table already has a `state`
   column so new states are data, not code).
3. Other countries later (GCC/UAE was the first idea; moved to later).

Kerala specifics to support: district filter, sadhya catering, nikah, church
and temple events, chenda melam, WhatsApp click-to-chat, UPI payments later.

## 3. Business model

**Customers use Vela free. Vendors pay to be found and to reach customers**
(the LinkedIn idea: free basic profile, paid reach). Full detail, prices,
database design, rules and tests are in **`docs/MONETIZATION_SPEC.md`**.

1. Lead unlock credits: inquiries arrive with contact details hidden; 1 credit reveals them.
2. Vendor subscription plans: Starter (free), Pro, Premium (more services, photos, credits, badge, ranking).
3. Featured placement by district + category (always labeled "Featured").
4. Later: booking commission, sponsored ads.

Launch plan: first about 3 months billing OFF ("Founding Vendor" offer) to build
supply, then switch billing ON behind the `BILLING_ENABLED` flag. Nothing is
built yet; it is Phase 6.

## 4. Real tech stack (decided, replaces the first draft)

The first draft said React + Vite + Express + Prisma. The real app was built
and tested on the stack below, so the stack below is the truth.

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + React + TypeScript, in `web/` |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL via plain `pg` and hand-written SQL |
| Migrations | Numbered SQL files in `web/db/migrations/`, run by `npm run db:migrate` |
| Auth | Own JWT session cookie (`jose`) + `bcryptjs`. Roles: customer, vendor, admin |
| File storage | Supabase Storage (bucket) for images; video = pasted YouTube/Instagram links |
| Hosting (live) | Vercel (app) + Supabase (Postgres + Storage) |
| Mobile | Mobile-first website, installable as a PWA. Native app later on the same API |

Why no Prisma: its engine binaries were blocked in the dev sandbox. Plain SQL
is simpler and works everywhere.

## 5. Rules (keep)

DO NOT: rewrite working architecture, rename folders at random, regenerate
finished modules, add temporary hacks.
ONLY: extend, add modular features, keep quality, keep naming consistent.

- Validate input in every API route. Check roles on every protected route.
- Ownership checks live inside the SQL `WHERE` clause (pattern already used).
- Never commit secrets. `.env*` is gitignored.
- Every new feature gets API tests; the suite must pass before it is "done".
- Next.js here has API changes vs older versions: check
  `web/node_modules/next/dist/docs/` before writing route handlers
  (`params`/`searchParams` are Promises, `cookies()` is async).

## 6. Data model (target)

Existing: `users`, `vendors`, `vendor_reviews`, `quote_requests`, `favorites`.

Added by migration `002`:

- `users.role` gains `admin`.
- `districts` (state, name): all 14 Kerala districts.
- `categories`: Venue, Photography, Videography, Catering, Decoration, DJ & Music,
  Makeup, Mehendi, Event Management, Sound & Lighting, Rental, Event Host.
- `vendors` gains: `vendor_type` (company | individual), `district_id`, `phone`,
  `whatsapp`, `logo_url`, `cover_image_url`, `status` (pending | approved | rejected).
- `services`: what a vendor sells (one vendor, many services; each with its own
  category, price-from, unit, description).
- `portfolio_items`: work samples (image or video link), optionally tied to a
  service, with caption and order.
- `quote_request_services`: which services a customer asked for in one inquiry.

## 7. Phases (Kerala launch)

Update the checkboxes as work completes.

**Phase 0 - Plan and cleanup**
- [x] Master plan rewritten for Kerala + real stack (this file)
- [x] Numbered migrations instead of one schema file

**Phase 1 - Data model**
- [x] Migration 002: districts, categories, services, portfolio, inquiry services, admin role (tested on real Postgres)
- [x] Data layer + API for services (owner-only create/edit/delete) - written, SQL tested; **needs `npm run lint`, build and `test:api` run locally**
- [x] Seed: Kerala districts, vendor types, services per sample vendor - written; **run `npm run db:seed` locally**
- [x] API tests written for all of the above - **not yet executed**
- [ ] Vendor type (company/individual) chosen at vendor signup
- [ ] Services management screen in the vendor dashboard (API exists)

**Phase 2 - Uploads**
- [ ] Supabase Storage bucket + upload API (image type/size checks, resize)
- [ ] Portfolio manager in vendor dashboard
- [ ] Cover photo and logo

**Phase 3 - LinkedIn-style profile and modular inquiry**
- [ ] Vendor page: cover, logo, services list, work gallery per service
- [ ] Customer ticks services, sends one inquiry for only those
- [ ] Event builder: shortlist across vendors with a total budget

**Phase 4 - Kerala discovery**
- [ ] District, category, budget filters; search by service
- [ ] WhatsApp button; pagination; DB indexes for search

**Phase 5 - Trust and safety**
- [ ] Phone OTP for vendors
- [ ] Admin dashboard: approve vendors (enforce `vendors.status`), remove listings, handle reports
- [ ] Email verification, password reset, report button
- [ ] Rate limiting on login/signup/inquiry

**Phase 6 - Revenue (see `docs/MONETIZATION_SPEC.md`)**
- [ ] Migration 003: plans, subscriptions, credit ledger, lead unlocks, payments, webhooks, featured placements
- [ ] Entitlements and plan limits enforced on the server
- [ ] Locked leads + unlock with credits (transaction-safe)
- [ ] Razorpay (test mode): credit packs, subscriptions, webhook
- [ ] Featured placement and ranking rules
- [ ] Billing page, public pricing page, admin revenue dashboard
- [ ] `BILLING_ENABLED` flag, default OFF in production

**Phase 7 - Go live**
- [ ] Vercel + Supabase production setup, secrets in host settings
- [ ] CI: lint, typecheck, build, API tests on every push
- [ ] Browser (Playwright) tests for main flows
- [ ] Error monitoring, DB backups, privacy + terms pages, domain, GST/CA check

**Phase 8 - Later**
- [ ] Online booking and UPI payments, commission
- [ ] Native mobile app, Malayalam, more states, AI recommendations

## 8. Test and release workflow

Per change:
1. Branch: `feature/<name>`.
2. Local checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`.
3. `npm run db:migrate && npm run db:seed`, start the app, `npm run test:api`.
   Use a separate **test database** (not the dev one) so test runs do not pollute data.
4. Push. CI repeats step 2-3 with a Postgres container.
5. Preview deploy (Vercel) with its own database branch; click through the
   main flows (checklist below).
6. Merge to `main` = production deploy. Smoke test the live site (5 minutes).
7. If broken, roll back in Vercel, then fix on a branch.

Manual smoke checklist: sign up (customer, vendor) - create/edit listing - add a
service - search by district/category - open vendor page - send inquiry for
selected services - vendor sees the lead and changes status - customer sees
status - favorite and review - settings save - logout.

## 9. Estimated running cost (live, rough, check current prices)

About INR 4,000-5,000 per month: Vercel Pro (US$20), Supabase Pro (from US$25),
domain (INR 500-800 per year), OTP SMS (about INR 0.15-0.25 per SMS, plus a
one-time DLT registration). Free tiers are fine while building (Vercel Hobby is
non-commercial only; Supabase free pauses after 1 week idle).

## 10. Open items and notes

- Decide the final public brand name and domain.
- Local dev setup is in `web/README.md`. Production env vars: `DATABASE_URL`,
  `SESSION_SECRET`, (later) Supabase URL and service key.
- Status approval flow (`vendors.status`) is stored now but enforced in Phase 5;
  until then new listings default to `approved`.

## 11. Change log

- 2026-10-29: Rewrote this plan for Kerala-first launch and the real stack.
  Added migration 002 (profiles, services, portfolio, districts, categories).
- 2026-10-29: Added revenue plan (`docs/MONETIZATION_SPEC.md`) as Phase 6 and the
  agent prompt (`AGENT_PROMPT.md`).
