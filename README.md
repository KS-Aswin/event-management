# Vela — Event Marketplace

**Vela** is a Kerala-based marketplace connecting customers with event vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists, and more).

This repo has two parts:

## `/web`: the real app (live)

A Next.js 16 + PostgreSQL application, **live at <https://vela-drab-psi.vercel.app>**. It runs on Vercel Hobby, with a Supabase free project for Postgres and file storage.
- Setup: [`web/README.md`](./web/README.md)
- Deployment: [`docs/DEPLOY.md`](./docs/DEPLOY.md)
- Latest status and what's pending: [`docs/MAINTENANCE_STATUS.md`](./docs/MAINTENANCE_STATUS.md)
- Product spec: [`docs/PRODUCT_PLAN.md`](./docs/PRODUCT_PLAN.md)

Status as of 2026-11-07: every item in phases P0 to P2 of the plan is built, plus P3-1 (production storage). It went through 5 QA test-and-fix rounds (112 issues logged and handled, each with tests). There are three roles, one per account:
- **Customer:** search by offering, district, budget, date and event type; event-type pages; shortlist and compare; enquiries to up to 5 vendors (guests can send them too, and track them by link); messages; quotes; reviews; notifications; the `/my` area.
- **Vendor:** a 6-step onboarding wizard, offerings and packages, a photo/video media manager, service areas, documents, leads with replies and itemised quotes, an availability calendar, insights.
- **Admin:** created with `npm run admin:create` (or `admin:create:deploy` for production). Vendor approval and verification, review and media moderation, taxonomy, users, enquiries, analytics, and an audit log.

Not built yet (phase P3, planned for after income): payments and billing, email/SMS delivery (it needs an email provider account), and the other P3 items in the plan.

## `/demo` — the original front-end mockup

A single-file, no-backend HTML/CSS/JS prototype used to design and validate the UI before building the real app. Everything in it is hardcoded sample data — nothing persists. Kept around as a design reference. See [`demo/`](./demo/) — open `demo/index.html` directly in a browser, or run `node demo/tests_click-through.js` from the repo root to see its automated click-through test suite (43 checks). It needs `jsdom`, which is not declared anywhere, so install it once with `npm install --no-save jsdom`.

## Where to start

- **Continuing development?** Read [`docs/MAINTENANCE_STATUS.md`](./docs/MAINTENANCE_STATUS.md) for the latest state, then [`PROJECT_LOG.md`](./PROJECT_LOG.md) for the history.
- **Just want to see the UI design?** Open `demo/index.html`.
- **Setting up the real app locally?** See [`web/README.md`](./web/README.md).
