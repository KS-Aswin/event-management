# Vela — Event Marketplace

**Vela** is a Kerala-based marketplace connecting customers with event vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists, and more).

This repo has two parts:

## `/web` — the real app (in progress)

A real Next.js + PostgreSQL application. This is what's actively being built now. See [`web/README.md`](./web/README.md) for setup instructions, and [`PROJECT_LOG.md`](./PROJECT_LOG.md) for the full history of decisions and progress — **read that file first if you're picking this project up in a new session.**

Currently working: real signup/login with a Postgres-backed users table, hashed passwords, session cookies, and a protected dashboard route. Not yet built: the full mockup UI (vendor search, profiles, quote requests, settings), Google OAuth, and the vendor/listing data model.

## `/demo` — the original front-end mockup

A single-file, no-backend HTML/CSS/JS prototype used to design and validate the UI before building the real app. Everything in it is hardcoded sample data — nothing persists. Kept around as a design reference. See [`demo/`](./demo/) — open `demo/index.html` directly in a browser, or run `node demo/tests_click-through.js` (needs `jsdom`) to see its automated click-through test suite.

## Where to start

- **Continuing development?** Read [`PROJECT_LOG.md`](./PROJECT_LOG.md) — it's written specifically so a new chat session (or a new contributor) can pick up with full context.
- **Just want to see the UI design?** Open `demo/index.html`.
- **Setting up the real app locally?** See [`web/README.md`](./web/README.md).
