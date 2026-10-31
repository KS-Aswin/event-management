# Vela — Event Marketplace

**Vela** is a Kerala-based marketplace connecting customers with event vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists, and more).

This repo has two parts:

## `/web` — the real app (in progress)

A real Next.js + PostgreSQL application. This is what's actively being built now. See [`web/README.md`](./web/README.md) for setup instructions, and [`PROJECT_LOG.md`](./PROJECT_LOG.md) for the full history of decisions and progress — **read that file first if you're picking this project up in a new session.**

Currently working: signup/login (hashed passwords, session cookies), vendor search with filters and typeahead, vendor profiles with services and reviews, quote requests and lead management, vendor listing create/edit, favourites, settings, and role-specific dashboards, all on Postgres (schema in `web/db/migrations/`). Not yet built: Google OAuth, payments/monetization, notifications, and an admin moderation UI. See `web/README.md` for the full list.

## `/demo` — the original front-end mockup

A single-file, no-backend HTML/CSS/JS prototype used to design and validate the UI before building the real app. Everything in it is hardcoded sample data — nothing persists. Kept around as a design reference. See [`demo/`](./demo/) — open `demo/index.html` directly in a browser, or run `node demo/tests_click-through.js` from the repo root to see its automated click-through test suite (43 checks). It needs `jsdom`, which is not declared anywhere, so install it once with `npm install --no-save jsdom`.

## Where to start

- **Continuing development?** Read [`PROJECT_LOG.md`](./PROJECT_LOG.md) — it's written specifically so a new chat session (or a new contributor) can pick up with full context.
- **Just want to see the UI design?** Open `demo/index.html`.
- **Setting up the real app locally?** See [`web/README.md`](./web/README.md).
