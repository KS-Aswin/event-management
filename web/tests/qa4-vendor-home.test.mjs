// QA round 4 fixes, vendor home + notifications (event-management-qa-tracker.md):
//   QA-089 the vendor home tells the go-live photo minimum (3) apart from the
//          profile-strength target (6)
//   QA-095 every notification is reachable: /api/notifications pages with
//          offset (and unread=1), the bell and the "Updates from Vela" card
//          link to /notifications, which lists them all and marks them read
//   QA-096 44 px tap targets: notification title links on /vendor and the
//          /vendor/areas "Change" link
//
// Needs a running dev server (BASE_URL) and the LOCAL database:
//
//   BASE_URL=http://localhost:3172 node --env-file-if-exists=.env.local --test tests/qa4-vendor-home.test.mjs
//
// Test users are admtest-qa4vh-<digits>@example.com; they and what they own
// (notifications cascade) are removed at the end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { request, db, closeDb, cleanup, makeVendor, makeCustomer, createListing, WEB_DIR } from "./admin-helpers.mjs";
import { profileStrength, STRENGTH_RULES } from "../app/vendor/profile-strength.ts";

const PREFIX = "qa4vh";
const src = (rel) => readFileSync(path.join(WEB_DIR, rel), "utf8");
/** A page fetch with the HTML text-node separators (<!-- -->) removed. */
async function page(urlPath, cookie) {
  const r = await request(urlPath, { cookie });
  return { ...r, text: r.text.replace(/<!-- -->/g, "") };
}

before(async () => {
  await cleanup(PREFIX);
});

after(async () => {
  await cleanup(PREFIX);
  await closeDb();
});

/** n notifications for userId, oldest first: "qa4vh note 1" is the oldest. */
async function addNotifications(userId, n) {
  await db().query(
    `INSERT INTO notifications (user_id, kind, payload, created_at)
     SELECT $1, 'admin_note',
            jsonb_build_object('title', 'qa4vh note ' || i, 'body', 'Full text of note ' || i || E'\nsecond line'),
            now() - make_interval(mins => $2 - i)
       FROM generate_series(1, $2) AS i`,
    [userId, n]
  );
}

async function approvedVendor() {
  const v = await makeVendor(PREFIX, { name: "Qa4vh Vendor" });
  const listing = await createListing(v.userId, { status: "approved", name: `Qa4vh Studio ${Date.now()}` });
  return { ...v, vendorId: listing.id };
}

// ---------------------------------------------------------------------------
// QA-095
// ---------------------------------------------------------------------------

test("QA-095: /api/notifications pages past the newest 15 with offset, total and unread=1", async () => {
  const v = await makeVendor(PREFIX);
  await addNotifications(v.userId, 22);

  const first = await request("/api/notifications?limit=15", { cookie: v.cookie });
  assert.equal(first.status, 200);
  assert.equal(first.data.items.length, 15);
  assert.equal(first.data.unread, 22);
  assert.equal(first.data.total, 22);
  assert.equal(first.data.items[0].title, "qa4vh note 22", "newest first");

  const rest = await request("/api/notifications?limit=15&offset=15", { cookie: v.cookie });
  assert.equal(rest.status, 200);
  assert.deepEqual(
    rest.data.items.map((n) => n.title),
    [7, 6, 5, 4, 3, 2, 1].map((i) => `qa4vh note ${i}`),
    "the 7 oldest are on the second page"
  );

  // Mark the oldest read by id: it was never in the bell's 15.
  const oldest = rest.data.items.at(-1);
  const m = await request("/api/notifications", { method: "POST", cookie: v.cookie, body: { ids: [oldest.id] } });
  assert.equal(m.status, 200);
  assert.equal(m.data.marked, 1);

  const unread = await request("/api/notifications?limit=50&unread=1", { cookie: v.cookie });
  assert.equal(unread.data.unread, 21);
  assert.equal(unread.data.total, 21, "total counts the filter");
  assert.equal(unread.data.items.length, 21);
  assert.ok(!unread.data.items.some((n) => n.id === oldest.id));

  // Bad paging values fall back to safe defaults.
  const bad = await request("/api/notifications?limit=abc&offset=-5", { cookie: v.cookie });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.items.length, 10);
  assert.equal(bad.data.items[0].title, "qa4vh note 22");
});

test("QA-095: /notifications lists every notification in full, paged, for any signed-in role", async () => {
  const v = await makeVendor(PREFIX);
  await addNotifications(v.userId, 25);

  const p1 = await page("/notifications", v.cookie);
  assert.equal(p1.status, 200);
  assert.match(p1.text, /qa4vh note 25/);
  assert.match(p1.text, /qa4vh note 6\b/);
  assert.doesNotMatch(p1.text, /qa4vh note 5\b/, "20 per page");
  assert.match(p1.text, /1–20 of 25/);
  assert.match(p1.text, /href="\/notifications\?page=2"/);
  assert.match(p1.text, /Full text of note 25/, "the body is shown in full");

  const p2 = await page("/notifications?page=2", v.cookie);
  assert.equal(p2.status, 200);
  assert.match(p2.text, /qa4vh note 1\b/, "the oldest is reachable");
  assert.match(p2.text, /21–25 of 25/);

  const past = await page("/notifications?page=99", v.cookie);
  assert.equal(past.status, 200);
  assert.match(past.text, /21–25 of 25/, "a page past the end shows the last page");

  const unreadOnly = await page("/notifications?filter=unread", v.cookie);
  assert.equal(unreadOnly.status, 200);
  assert.match(unreadOnly.text, /Unread \(25\)/);

  const c = await makeCustomer(PREFIX);
  const cp = await page("/notifications", c.cookie);
  assert.equal(cp.status, 200, "customers have a bell too");
  assert.match(cp.text, /No notifications yet/);

  // Signed out: sent to sign in and back (the root loading boundary streams
  // the page, so the redirect arrives in the body, like /settings).
  const anon = await request("/notifications");
  const target = [303, 307, 308].includes(anon.status) ? anon.headers.location ?? "" : anon.text;
  assert.match(target, /\/login\?next=(%2F|\/)notifications/);
});

test("QA-095: the vendor home card and the bell link to the full list", async () => {
  const v = await approvedVendor();
  await addNotifications(v.userId, 18);
  const home = await request("/vendor", { cookie: v.cookie });
  assert.equal(home.status, 200);
  assert.match(home.text, /data-testid="vendor-notifications-see-all"/);
  assert.match(home.text, /See all (<!-- -->)?18(<!-- -->)? updates/);
  assert.match(home.text, /href="\/notifications"/);

  const bell = src("app/_nav/notification-bell.tsx");
  assert.match(bell, /href="\/notifications"/, "the bell has a See all link");
  assert.match(bell, /data-testid="notifications-see-all"[\s\S]{0,200}min-h-11/);
});

// ---------------------------------------------------------------------------
// QA-089
// ---------------------------------------------------------------------------

test("QA-089: the home banner and the checklist tell the go-live minimum from the strong-profile target", async () => {
  const base = { checklist: { basics: true, logo: true, cover: true, areas: true, languages: true } };
  const s = profileStrength({ ...base, media: { images: 0 }, offerings: { pricedUnits: 3, packages: 1 } }, "");
  const photos = s.items.find((i) => i.key === "photos");
  assert.match(photos.label, new RegExp(`strong profile, show at least ${STRENGTH_RULES.photos} portfolio photos \\(0 so far\\)`));

  // An approved listing with no portfolio photos gets the "missing the basics" banner.
  const v = await approvedVendor();
  const home = await request("/vendor", { cookie: v.cookie });
  assert.equal(home.status, 200);
  assert.match(home.text, /Your live listing is missing the basics/);
  const text = home.text.replace(/<!-- -->/g, "");
  assert.match(text, /at least 3 portfolio photos to go live \(6 or more make a strong profile\)/);
  assert.match(text, /For a strong profile, show at least 6 portfolio photos \(0 so far\)/);
});

// ---------------------------------------------------------------------------
// QA-096
// ---------------------------------------------------------------------------

test("QA-096: notification title links and the areas Change link are 44 px tap targets", async () => {
  const card = src("app/vendor/notifications-list.tsx");
  assert.match(card, /<Link\s+href=\{n\.link\}\s+className="[^"]*\bmin-h-11\b/, "card title link");
  assert.match(card, /vendor-notifications-see-all"\s+className="[^"]*\bmin-h-11\b/);
  const feed = src("app/notifications/notification-feed.tsx");
  assert.match(feed, /<Link href=\{n\.link\}[\s\S]{0,80}className="[^"]*\bmin-h-11\b/, "page title link");
  const areas = src("app/vendor/areas/areas-form.tsx");
  const links = [...areas.matchAll(/<Link\s+href="\/vendor\/profile#location"\s+className="([^"]*)"/g)];
  assert.equal(links.length, 2, "Change and Set it in your profile");
  for (const l of links) assert.match(l[1], /\bmin-h-11\b/);

  // Rendered: the title link on /vendor carries the class.
  const v = await approvedVendor();
  await db().query(
    `INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'admin_note', '{"title":"qa4vh linked","link":"/vendor/profile"}')`,
    [v.userId]
  );
  const home = await request("/vendor", { cookie: v.cookie });
  assert.match(home.text, /<a class="[^"]*min-h-11[^"]*" href="\/vendor\/profile"><span>qa4vh linked/);
});
