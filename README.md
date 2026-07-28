# Vela — Event Marketplace Demo

A single-file interactive prototype of **Vela**, a Kerala-based marketplace connecting customers with event vendors (venues, photographers, caterers, decorators, DJs, makeup artists, mehendi artists, and more).

This is a **front-end demo only** — all data is hardcoded sample data, there is no backend, and nothing is persisted between sessions.

## What's included

- **`index.html`** — the entire app (HTML, CSS, and vanilla JS in one file). Open it directly in a browser, or serve it with GitHub Pages.
- **`tests_click-through.js`** — a headless test script (using `jsdom`) that simulates a user clicking through every major flow (search, filter, view a vendor profile, request a quote, sign up, log in, dashboard, settings, logout, static pages) and asserts the app behaves correctly at each step.

## Features demoed

- Google-style minimal home page with an animated search placeholder
- Vendor search with category, location, rating, and sort filters
- Vendor profile pages with packages and reviews
- "Request a quote" flow
- Sign up / log in (customer or vendor role) with a simulated logged-in dashboard
- Vendor dashboard (leads, profile visitors, conversion) vs. customer dashboard (event checklist)
- Settings page (profile, notification preferences, logout)
- Static pages: About, Help (FAQ), Privacy, For Vendors

## Running the tests

```bash
npm install jsdom
node tests_click-through.js
```

## Notes

- Vendor images are illustrated CSS/SVG tiles rather than photos, since this is meant to run anywhere (including sandboxed previews) without depending on external image hosting.
- This was built iteratively as a product mockup / conversation starter, not production code — no backend, no real authentication, no data persistence.
