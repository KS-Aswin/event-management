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

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Apply the database schema:**
   ```bash
   node db/migrate.mjs
   ```
   (This runs `db/schema.sql` against `DATABASE_URL`. Safe to re-run — it uses `CREATE TABLE IF NOT EXISTS`.)

5. **Run the dev server:**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000

## What's built so far

- `/` — placeholder landing page with links to sign in / sign up
- `/signup` — real signup form (customer or vendor role), creates a user in Postgres, hashes the password, signs the person in
- `/login` — real login form, verifies against the stored password hash
- `/dashboard` — protected page (redirects to `/login` if not signed in) — currently just a placeholder proving the session loop works; the real dashboard UI from the mockup isn't built here yet
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — the underlying API routes

**Not wired yet:** Google OAuth (the button is present but disabled — needs a real Google Cloud OAuth client, which only the project owner can create), the full dashboard/settings/vendor-search UI from the mockup, and the vendor listing/booking data model.

## Database schema

See `db/schema.sql`. Currently just a `users` table (id, name, email, password_hash, role, created_at). More tables (vendors, listings, quote requests, etc.) will be added as those features get built — each addition should get its own reviewed `ALTER TABLE` / `CREATE TABLE` statement appended to that file, with a note here.

## Testing

No automated test suite for this app yet (unlike the `demo/` folder, which has a jsdom click-through suite). Manual testing so far has covered, via `curl` against a running dev server:
- Register → duplicate email rejected (409) → weak password rejected (400)
- Dashboard blocked without a session, redirects to `/login`
- Dashboard accessible with a valid session, shows correct name/role
- Login with correct password succeeds, wrong password rejected (401) with a generic error (doesn't reveal whether the email exists)
- Vendor role registers and displays correctly, separate from customer role
- Logout clears the session

Adding a real automated test suite (e.g. Playwright for the UI, or a lighter API-level test script) is on the backlog — see `PROJECT_LOG.md`.
