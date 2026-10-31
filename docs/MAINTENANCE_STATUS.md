# Product build (31 Oct 2026 →)

## Stages
- **Finished:** product (plan in `docs/PRODUCT_PLAN.md`), vendor (P0 vendor workspace).
- **Interrupted:** admin (P1). Stopped by the 48% soft usage gate at 18:36; its work in progress was committed as `81fe95d` and pushed.
- **Not reached:** customer (P2).

## What each role can do now
- **Vendor:** sign up and finish a 6-step onboarding wizard that saves each step and can be resumed. Then manage offerings and packages, including Other/custom offerings. Upload photos, short MP4s and video links to the media manager (albums, captions, cover/logo, reorder). Edit the business profile and service areas. Work leads in `/vendor/leads` with notes, follow-up dates and WhatsApp. The vendor home shows status, profile strength and 7-day stats.
- **Customer / public:** see real vendor media (gallery, lightbox, videos), offerings grouped by unit, and search cards with cover images. Send enquiries for units (package-only rules are enforced). The customer area `/my` exists only as a shell, because P2 has not started.
- **Admin:** created with `npm run admin:create`. Guarded `/admin` shell (404 for non-admins, API returns 401/403). Every action goes through an audit log helper. Work-in-progress pages and APIs exist for vendors (approve/reject/suspend/verify/owner), reviews (hide/unhide/reports), media, taxonomy/templates, users, enquiries, audit, analytics and the Today inbox. None of these is ticked or reviewed yet.

## Tests (counts of test cases defined; the full suite was not re-run in this handoff)
- `test:api` ≈149 checks; `test:unit` 42 (offering 32 + profile 10); `test:storage` script; `test:admin` 50 (guard 12, moderation 13, ops 13, vendors 12).
- e2e (Playwright): 30 tests (public 13, flows 7, vendor workspace 9, admin shell 1).
- Last reported green: test:unit, test:storage, test:api and test:e2e at the end of P0. The admin tests from the interrupted stage have not been confirmed green.
- At handoff: lint 0 errors (1 warning). `tsc --noEmit` is clean for source. The only errors are 16 in stale `.next/types` (they point to removed `/dashboard` pages). Delete `web/.next` or run a build to clear them.

## Pending per phase
- **P0:** 14 of 16 done. Still open:
  - P0-7: cover/logo crop in the media manager.
  - P0-8: the home page, search filters, `/api/suggest` and the legacy `/api/vendors/[id]` still read the hard-coded CATEGORIES list.
  - Follow-ups: 6 lead tabs (the DB has 4 statuses), an in-page confirm instead of `window.confirm`, and a 404 for another vendor's lead/package page.
- **P1:** 1 of 14 ticked (P1-1). P1-2 to P1-13 have WIP code from `81fe95d` that needs review, test runs and ticking. P1-10 (vendor documents) and P1-14 (`/terms`) need checking for completeness.
- **P2:** nothing started (P2-1 to P2-14: customer home, enquiry v2, guest tracking, quote offers, thread, calendar, search v2, event-type pages, shortlist, compare, reviews v2, mobile bar, notifications, insights).
- **P3:** later, after income. P3-1 (production storage, R2) is required before the first production deploy.

## Decisions the owner must confirm
- The 30 defaults in `docs/PRODUCT_PLAN.md` section 9. The key ones:
  - Admin approval before a listing goes live.
  - Re-review only on name/category/phone edits.
  - Vendor phone stays public while billing is off.
  - Guest enquiries allowed.
  - Multi-vendor cap of 5 per send and 15 per day.
  - Cloudflare R2 for production storage.
  - One role per account.
- Review migrations `004_vendor_workspace.sql` and `005_admin.sql`. They are applied to the LOCAL database only.
- The new dependency `sharp` (image processing).

## Exact next step to resume next week
1. `cd web`, then `npm run db:migrate`. Then run `npm run test:admin`, `npm run test:api` and `npm run test:e2e`. Fix any failures in the WIP admin code.
2. Review and finish P1-2 to P1-14 in order. Tick each in `docs/PRODUCT_PLAN.md` with a _Status_ note.
3. Re-run the pipeline from the `admin` stage, then `customer` (P2). The briefs are `admin.md` and `customer.md` in the run's scratchpad. See memory note "Maintenance run Oct 2026".

---

# Event Management (Vela): maintenance handoff, 31 Oct 2026

Branch `ui-fixes-aswin`. Each stage was committed locally and pushed by the orchestrator. Nothing was deployed, and no live service was touched.

## Stages
- Completed: analyse (understanding report), audit1, verify, fix, allset (clean-setup check plus docs), handoff (this file).
- Not reached: none. Every stage in `stages.txt` has a done file.

## What was fixed (130 of 154 tracker items), most important first
- **Setup/build:** Next 16.2.12 had critical advisories, including RCE on Windows hosts; upgraded to 16.4.3 (EM-145). db:migrate and db:seed now load `.env.local` (EM-142). `.env.example` is committed (EM-143). The seed now has a guard and is documented as destructive (EM-146). Lint passes (EM-144). Typecheck and test scripts were added (EM-150). The Postgres pool has an error listener and timeouts (EM-151). The session secret placeholder is now rejected (EM-154).
- **Functionality / bugs:**
  - Search works again (EM-001, -002, -013, -015, -020, -121, -122).
  - Removed the invented packages, the always-on Verified badge and the fake verification copy (EM-021, -022, -076, -077).
  - The hero no longer covers vendor cards (EM-023).
  - Enquiry messages now show (EM-048).
  - Mixed-case email no longer locks users out (EM-064).
  - Login keeps a safe `?next=` (EM-037, -033).
  - The quote form can pick services (EM-027).
  - Vendors can manage services and portfolio (EM-053).
  - Bad ids or input now get a 4xx instead of a 500 (EM-105, -124).
  - Stale sessions are handled (EM-128).
- **Data integrity:** seeded review counts are kept (EM-102). Ranking is fixed and the test vendor no longer leaks (EM-103). Prices stay in sync (EM-052). No more duplicate listings (EM-134). Status transitions are validated (EM-136). Constraints were added (EM-152). Changes are in the new migration `web/db/migrations/003_data_integrity.sql`, applied to the LOCAL database only.
- **Security:** unpublished vendors are hidden (EM-024, -108). Rate limits added (EM-104, -044). Review abuse blocked (EM-106). Login CSRF fixed (EM-153). Security headers added (EM-115). Vendor GET is trimmed to public fields (EM-114).
- **Performance:** pagination and indexes (EM-016, -112). Typewriter re-renders and reduced motion fixed (EM-008).
- **UX / accessibility / responsive:**
  - The header no longer overflows at 375px (EM-087).
  - Accessible dialogs, labels, switches and focus styles (EM-012, -026, -036, -068, -097).
  - Added footer, 404, error and loading pages, plus metadata, OG tags, a sitemap and JSON-LD (EM-094, -095, -034, -096).
  - Shared UI styles (EM-093).
  - Mobile menu (EM-091). Tap targets fixed (EM-092).
- **Found during testing and fixed:** listing creation rejected the 5 newer categories. Phone and WhatsApp were silently dropped on save.

## Still pending
**Needs you before launch** (full list in `web/README.md` under "What a human still has to do"):
- Production env vars: `DATABASE_URL`, a fresh `SESSION_SECRET` and `NEXT_PUBLIC_SITE_URL`.
- A managed Postgres database. Review migration 003, then run `db:migrate` against it.
- Never run `db:seed` on production.
- Providers: an email provider (password reset EM-038, notifications), a Google OAuth client, a storage bucket (portfolio uploads EM-118), and SMS/WhatsApp (EM-047). Also a real support email (EM-081).
- A legal DPDP-compliant privacy policy and Terms page (EM-079).
- Decisions on monetization and the copy that depends on it (EM-083, EM-078), and on brand direction (EM-100).
- Hosting over HTTPS. The in-memory rate limits need Redis if you run several instances.

**Features not built yet:**
- Forgot password (EM-038)
- Portfolio uploads (EM-118)
- WhatsApp/call buttons with click logging (EM-116)
- Availability calendar (EM-117)
- Multi-vendor enquiry and shortlist compare (EM-119)
- Quote replies, quoted price, cancel and notifications (EM-113)
- Admin moderation UI for review reports

**Open or unverified tracker items:** none open. 15 are deferred and 9 need a human.

**Deferred engineering work:**
- Session revocation and change-password (EM-111, -072)
- Claiming quotes sent while logged out (EM-130)
- Return 409 instead of 500 on a double sign-up (EM-133)
- Per-plate vs package price sort (EM-014)
- Dark mode and tokens (EM-101)
- Shared info-page template (EM-085)
- Root layout cookies make static pages dynamic (EM-139)
- Font `@import` (EM-099, conflicts with a PROJECT_LOG decision)
- Not reached because of network errors during the fix stage:
  - API tests fail when re-run (EM-147)
  - Demo click-through test is broken (EM-148)
  - Stale docs (EM-149). The allset stage refreshed `web/README.md`, but other docs may still be stale.

## Test results (fresh clone, fresh local database)
- `npm run test:api`: 119/119 passed.
- Playwright e2e: 50/50 passed at mobile-390 and desktop-1440, 0 skipped.
- `npm run build` is OK, `tsc` is clean, and lint shows 0 errors (1 old warning).
- Not tested:
  - Anything external: email, OAuth, storage, SMS, payments, a production database or host.
  - Browsers other than Chromium.
  - Load or concurrency beyond the unit checks.
  - A second run of the API suite (EM-147).
  - The `demo/` click-through.

## Verdict
- **The core flows are production-ready from the code side.** Search, vendor profiles, quotes, reviews, auth and dashboards are fixed and tested locally.
- **It is not launch-ready yet.** The shortest list of what's left:
  1. Production env vars and database, then migration 003.
  2. An email provider and a password-reset flow.
  3. A real privacy policy, Terms page and support contact.
  4. A host over HTTPS.
  5. Optionally: portfolio uploads, and the EM-147 and EM-149 cleanups.

## Where things are
- Reports in `C:\Aswin Projects\`:
  - `event-management-understanding.html`
  - `event-management-tracker.html` (all 154 items with status, verification and fix details)
  - `event-management-test-report.html` with screenshots in `event-management-test-run\`
  - this file, also copied to `docs/MAINTENANCE_STATUS.md` in the repo
- Setup and the human to-do list: `web/README.md`.
- **To resume:** all stages are done. For follow-up work, pick the deferred or needs-human items from the tracker (filter by status), fix them on `ui-fixes-aswin`, and set each item's `status`/`fix` in the tracker JSON. The orchestrator scripts and briefs are in the session scratchpad (`pipeline.sh`, `stages.txt`, `*.md`). Add a stage line to `stages.txt` and restart the pipeline to run more stages.
