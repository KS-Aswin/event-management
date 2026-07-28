# PROJECT_LOG.md — Vela (event-management)

> **If you are Claude, starting a new chat:** read this entire file first. It tells you what this project is, what's been built, what's known-broken, and what to do next. At the **end of every session**, update the "Session Log" section below with what changed — this file is the only memory that survives between chats.
>
> Repo: https://github.com/KS-Aswin/event-management
> Live file: https://raw.githubusercontent.com/KS-Aswin/event-management/main/index.html (fetchable directly if you have web access)

---

## 1. What this is

**Vela** is a front-end-only prototype of an event-vendor marketplace for Kerala (weddings, birthdays, corporate events). Customers search/filter vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists), view profiles, and request quotes. Vendors get a dashboard. It's a **single self-contained HTML file** — no backend, no database, no real auth. Everything is hardcoded sample data and in-memory JS state that resets on page reload.

**Origin:** Started as a rough product brainstorm (a much bigger multi-phase platform idea — AI planning, full marketplace, vendor CRM, etc., in the original brief). We deliberately scoped it down to a minimal, Google-style front-end demo first, per the MVP thinking in that original brief.

## 2. Current state (as of last session)

**Working:**
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
/index.html                  ← the entire app (HTML+CSS+JS, single file)
/tests_click-through.js      ← jsdom test suite, run with: node tests_click-through.js
/README.md                   ← quick project overview for anyone browsing the repo
/PROJECT_LOG.md              ← this file — session history + handoff notes
```

## 4. Next steps / backlog (not yet done)

Roughly in the order they were being discussed — pick up wherever makes sense:

- [ ] Test real `<img>` photo loading on GitHub Pages (outside the Claude sandbox) — if it works there, could reintroduce real vendor photos for the deployed version while keeping illustrated tiles as the sandbox-safe fallback.
- [ ] Enable GitHub Pages for this repo so there's a live shareable link, not just a downloadable file.
- [ ] Decide if/when to move past "front-end mockup" toward an actual backend (this was flagged as a later-phase decision, not urgent).
- [ ] Revisit the original bigger product brief (AI planner, full vendor CRM, admin panel, etc.) if/when ready to scope a real v2 — that content isn't in this repo, it was discussed in chat only.
- [ ] No mobile-specific manual testing has been done beyond screenshots the user shared during earlier sessions — worth a fresh pass.

## 5. How to verify changes before committing

```bash
npm install jsdom       # if not already installed
node tests_click-through.js
```
Should print `0 failed / 43 checks` (the check count may grow over time — that's fine, just confirm 0 failed).

## 6. Session Log

> Add a new dated entry each session, newest at the top. Keep entries short — a few lines of what changed and why, not a full diff.

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
