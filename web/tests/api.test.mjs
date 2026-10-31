// Automated end-to-end test suite for the Vela API.
//
// This replaces the manual curl/psql testing that was done by hand in
// Sessions 4 and 5 (see PROJECT_LOG.md) with a real, repeatable script.
//
// Prerequisites:
//   1. Postgres running, schema applied, vendors seeded (once):
//        npm run db:migrate && npm run db:seed
//   2. Dev server running in another terminal:
//        npm run dev
//
// Then run:
//   npm run test:api      (loads DATABASE_URL from .env.local)
//
// Re-runnable: every user, listing and quote this suite creates is tagged
// with a unique RUN_ID and deleted again at the end (leftovers from earlier,
// interrupted runs are removed at the start), so the count assertions on the
// 9 seeded vendors keep passing without re-seeding. Cleanup talks to the
// database in DATABASE_URL directly and only touches rows matching the test
// patterns below (<prefix>-<digits>@example.com users and what they own).
// Both BASE_URL and DATABASE_URL must point at localhost.

import pg from "pg";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RUN_ID = Date.now();
const DATABASE_URL = process.env.DATABASE_URL;
const TEST_IP = `10.${Math.floor(RUN_ID / 65536) % 256}.${Math.floor(RUN_ID / 256) % 256}.${RUN_ID % 256}`;

function isLocalHost(url) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
if (!isLocalHost(BASE_URL)) {
  console.error(`Refusing to run against non-local BASE_URL ${BASE_URL}.`);
  process.exit(1);
}

// Users this suite creates: <prefix>-<digits>@example.com
const TEST_EMAIL_REGEX =
  "^(test-customer|test-vendor|other-vendor|weak|badrole|nobody|ratelimit|wiz-vendor|wiz-other)-[0-9]+@example[.]com$";

async function cleanupTestData(label) {
  if (!DATABASE_URL || !isLocalHost(DATABASE_URL)) {
    console.log(`(skipping ${label} DB cleanup: DATABASE_URL missing or not localhost)`);
    return;
  }
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN");
    const users = await client.query("SELECT id FROM users WHERE email ~ $1", [TEST_EMAIL_REGEX]);
    const ids = users.rows.map((r) => r.id);
    // Owned listings first (their services, reviews, media rows and quotes
    // cascade), then users. Uploaded files live under uploads/vendors/<id>.
    const v = await client.query("DELETE FROM vendors WHERE owner_id = ANY($1::int[]) RETURNING id", [ids]);
    const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(WEB_DIR, "uploads"));
    for (const row of v.rows) rmSync(path.join(uploadsRoot, "vendors", String(row.id)), { recursive: true, force: true });
    const q = await client.query(
      "DELETE FROM quote_requests WHERE message LIKE 'Automated test run %' OR customer_id = ANY($1::int[])",
      [ids]
    );
    const r = await client.query("DELETE FROM vendor_reviews WHERE customer_id = ANY($1::int[])", [ids]);
    const u = await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
    await client.query("COMMIT");
    if (u.rowCount || v.rowCount || q.rowCount || r.rowCount) {
      console.log(
        `(${label} cleanup: removed ${u.rowCount} users, ${v.rowCount} listings, ${q.rowCount} quotes, ${r.rowCount} reviews)`
      );
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log(`(${label} DB cleanup failed: ${err.message})`);
  } finally {
    await client.end().catch(() => {});
  }
}

// The 9 vendors db/seed.mjs inserts (same as the /demo mockup).
const SEEDED_VENDOR_NAMES = new Set([
  "Backwater Grand Palace", "Studio Frames by Arun", "Malabar Spice Caterers",
  "Petal & Palm Decor", "DJ Rhythm Kerala", "Glow Bridal Studio", "Henna Dreams",
  "Grand Vista Convention Centre", "Momentz Cinematics",
]);
function seededCount(res) {
  const list = res.data?.vendors;
  return Array.isArray(list) ? list.filter((v) => SEEDED_VENDOR_NAMES.has(v.name)).length : undefined;
}

let pass = 0;
let fail = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`PASS - ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`FAIL - ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
  }
}

function checkTrue(label, cond) {
  check(label, cond, true);
}

// Minimal cookie jar — good enough for a single-session test script.
function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(";")[0];
}

// Read-only helper for checks that have no public page yet (e.g. the vendor
// workspace replaced the old /dashboard HTML; its pages land in P0 wave 2).
async function dbQuery(sql, params = []) {
  if (!DATABASE_URL || !isLocalHost(DATABASE_URL)) return null;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

function isVendorPath(location) {
  const p = new URL(location ?? "/", BASE_URL).pathname;
  return p === "/vendor" || p.startsWith("/vendor/");
}

function redirectsToVendor(res) {
  return [307, 308].includes(res.status) && isVendorPath(res.headers?.location);
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // Per-run client IP, so the server's in-memory per-IP rate limits
      // (quotes, register) start fresh for each run instead of tripping on a
      // quick re-run. Only works because the local server trusts this header.
      "X-Forwarded-For": TEST_IP,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON response (e.g. an HTML page) — that's fine, `text` still has it
  }
  return { status: res.status, data, text, cookie: extractCookie(res), headers: { location: res.headers.get("location") } };
}

async function main() {
  console.log(`Running against ${BASE_URL} (run id ${RUN_ID})\n`);
  await cleanupTestData("pre-run");

  // ---------- Auth: registration ----------
  const customerEmail = `test-customer-${RUN_ID}@example.com`;
  const reg1 = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Test Customer", email: customerEmail, password: "password123", role: "customer" },
  });
  check("register: new customer succeeds (201)", reg1.status, 201);
  check("register: returns correct role", reg1.data?.user?.role, "customer");
  checkTrue("register: sets a session cookie", !!reg1.cookie);
  const customerCookie = reg1.cookie;

  const reg2 = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Test Customer", email: customerEmail, password: "password123", role: "customer" },
  });
  check("register: duplicate email rejected (409)", reg2.status, 409);

  const reg3 = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Weak Pw", email: `weak-${RUN_ID}@example.com`, password: "123", role: "customer" },
  });
  check("register: weak password rejected (400)", reg3.status, 400);

  const reg4 = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Bad Role", email: `badrole-${RUN_ID}@example.com`, password: "password123", role: "admin" },
  });
  check("register: invalid role rejected (400)", reg4.status, 400);

  const vendorEmail = `test-vendor-${RUN_ID}@example.com`;
  const regVendor = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Test Vendor Co", email: vendorEmail, password: "password123", role: "vendor" },
  });
  check("register: vendor role stored correctly", regVendor.data?.user?.role, "vendor");
  const vendorCookie = regVendor.cookie;

  // ---------- Auth: login ----------
  const loginOk = await request("/api/auth/login", {
    method: "POST",
    body: { email: customerEmail, password: "password123" },
  });
  check("login: correct password succeeds (200)", loginOk.status, 200);
  checkTrue("login: sets a session cookie", !!loginOk.cookie);

  const loginBad = await request("/api/auth/login", {
    method: "POST",
    body: { email: customerEmail, password: "wrongpassword" },
  });
  check("login: wrong password rejected (401)", loginBad.status, 401);
  check("login: generic error message (no email enumeration)", loginBad.data?.error, "Incorrect email or password.");

  const loginNoUser = await request("/api/auth/login", {
    method: "POST",
    body: { email: `nobody-${RUN_ID}@example.com`, password: "password123" },
  });
  check("login: nonexistent email gives same generic error", loginNoUser.data?.error, loginBad.data?.error);
  check("login: nonexistent email also 401 (not 404 — no enumeration)", loginNoUser.status, 401);

  // ---------- Auth: CSRF + rate limiting ----------
  const loginTextPlain = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ email: customerEmail, password: "password123" }),
  });
  check("login: text/plain body rejected (415, blocks form-based login CSRF)", loginTextPlain.status, 415);

  const loginCrossSite = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ email: customerEmail, password: "password123" }),
  });
  check("login: cross-site Origin rejected (403)", loginCrossSite.status, 403);

  const logoutCrossSite = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  check("logout: cross-site Origin rejected (403)", logoutCrossSite.status, 403);

  const rlEmail = `ratelimit-${RUN_ID}@example.com`;
  let rlStatus = null;
  let rlRetryAfter = null;
  for (let i = 0; i < 11; i++) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rlEmail, password: "wrongpassword" }),
    });
    rlStatus = res.status;
    rlRetryAfter = res.headers.get("retry-after");
    await res.text();
  }
  check("login: 11th failed attempt for one email is rate-limited (429)", rlStatus, 429);
  checkTrue("login: 429 includes a Retry-After header", !!rlRetryAfter);

  // ---------- Protected routes ----------
  const dashNoAuth = await request("/dashboard", { });
  // With a loading.tsx boundary the page streams, so redirect() arrives as a
  // 200 carrying a NEXT_REDIRECT to /login instead of a 30x status.
  checkTrue(
    "dashboard: redirects to /login when logged out",
    (dashNoAuth.status >= 300 && dashNoAuth.status < 400) ||
      (dashNoAuth.status === 200 && dashNoAuth.text.includes("NEXT_REDIRECT;replace;/login"))
  );

  const dashAuth = await request("/dashboard", { cookie: customerCookie });
  check("dashboard: accessible with valid session (200)", dashAuth.status, 200);

  // ---------- Vendors: search/filter ----------
  // Counts are scoped to the 9 seeded vendors (by name), so listings created
  // by hand or by other tools in the same local DB don't break these checks.
  const allVendors = await request("/api/vendors");
  check("vendors: all 9 seeded vendors returned", seededCount(allVendors), 9);

  const byCategory = await request("/api/vendors?category=Photography");
  check("vendors: category filter (Photography = 2)", seededCount(byCategory), 2);
  checkTrue("vendors: category filter returns only Photography",
    (byCategory.data?.vendors ?? []).every((v) => v.category === "Photography"));

  const byLocation = await request("/api/vendors?location=Kochi");
  // Kochi also matches vendors in Ernakulam district (Kochi is in Ernakulam):
  // the two Kochi vendors plus DJ Rhythm Kerala.
  check("vendors: location filter (Kochi = 3 incl. Ernakulam district)", seededCount(byLocation), 3);

  const byRating = await request("/api/vendors?minRating=4.8");
  check("vendors: min rating filter (4.8+ = 4)", seededCount(byRating), 4);

  const byQuery = await request("/api/vendors?q=drone");
  check("vendors: text search on tags (drone = 1)", seededCount(byQuery), 1);

  const sortedByPriceLow = await request("/api/vendors?sort=priceLow");
  const prices = sortedByPriceLow.data?.vendors?.map((v) => v.price) ?? [];
  const isAscending = prices.every((p, i) => i === 0 || p >= prices[i - 1]);
  checkTrue("vendors: sort=priceLow actually ascending", isAscending);

  // ---------- Vendors: detail ----------
  const vendorDetail = await request("/api/vendors/1");
  check("vendor detail: correct name for id 1", vendorDetail.data?.vendor?.name, "Backwater Grand Palace");
  checkTrue("vendor detail: includes reviews array", Array.isArray(vendorDetail.data?.reviews));

  const vendorMissing = await request("/api/vendors/99999");
  check("vendor detail: nonexistent id returns 404", vendorMissing.status, 404);

  const vendorBadId = await request("/api/vendors/not-a-number");
  check("vendor detail: non-numeric id returns 400", vendorBadId.status, 400);

  // ---------- Quote requests ----------
  const quoteOk = await request("/api/vendors/3/quotes", {
    method: "POST",
    body: {
      name: "Quote Test",
      phone: "9999900000",
      eventDate: "2027-03-14",
      budget: "200000",
      message: `Automated test run ${RUN_ID}`,
    },
  });
  check("quote: valid submission accepted (201)", quoteOk.status, 201);

  const quoteMissingPhone = await request("/api/vendors/3/quotes", {
    method: "POST",
    body: { name: "No Phone" },
  });
  check("quote: missing phone rejected (400)", quoteMissingPhone.status, 400);

  const quoteBadVendor = await request("/api/vendors/99999/quotes", {
    method: "POST",
    body: { name: "Test", phone: "9999900000" },
  });
  check("quote: nonexistent vendor returns 404", quoteBadVendor.status, 404);

  // ---------- Vendor listing creation ----------
  const listingNoAuth = await request("/api/vendors", {
    method: "POST",
    body: { name: "x", category: "Venue", location: "x", price: 1000, experience: "1 yr", about: "test about" },
  });
  check("create listing: rejected without auth (401)", listingNoAuth.status, 401);

  const listingAsCustomer = await request("/api/vendors", {
    method: "POST",
    body: { name: "x", category: "Venue", location: "x", price: 1000, experience: "1 yr", about: "test about" },
    cookie: customerCookie,
  });
  check("create listing: rejected for customer role (403)", listingAsCustomer.status, 403);

  const listingBadCategory = await request("/api/vendors", {
    method: "POST",
    body: {
      name: "Test Biz",
      category: "NotARealCategory",
      location: "Kochi",
      price: 5000,
      experience: "2 yrs",
      about: "A test business for the automated suite.",
    },
    cookie: vendorCookie,
  });
  check("create listing: invalid category rejected (400)", listingBadCategory.status, 400);

  const listingOk = await request("/api/vendors", {
    method: "POST",
    body: {
      name: `Automated Test Studio ${RUN_ID}`,
      category: "Photography",
      location: "Kochi",
      price: 30000,
      experience: "3 yrs",
      tags: ["Test", "Automated"],
      about: "A test business created by the automated suite.",
    },
    cookie: vendorCookie,
  });
  check("create listing: valid submission accepted (201)", listingOk.status, 201);
  const createdVendorId = listingOk.data?.vendor?.id;
  checkTrue("create listing: response includes new vendor id", typeof createdVendorId === "number");

  const listingDuplicate = await request("/api/vendors", {
    method: "POST",
    body: {
      name: "Second Listing Attempt",
      category: "Venue",
      location: "Kochi",
      price: 5000,
      experience: "1 yr",
      about: "Trying to create a second listing for the same account.",
    },
    cookie: vendorCookie,
  });
  check("create listing: second listing for same owner rejected (409)", listingDuplicate.status, 409);

  // P0-2: /dashboard is retired for vendors; they are sent to the /vendor workspace.
  const vendorDashAfterListing = await request("/dashboard", { cookie: vendorCookie });
  checkTrue("vendor dashboard: /dashboard redirects a vendor to /vendor", redirectsToVendor(vendorDashAfterListing));

  // ---------- Customer dashboard reflects a real quote request ----------
  const customerQuote = await request(`/api/vendors/${createdVendorId}/quotes`, {
    method: "POST",
    body: { name: "Dashboard Test", phone: "9999911111", message: "checking dashboard reflects this" },
    cookie: customerCookie,
  });
  check("quote: logged-in customer's quote accepted (201)", customerQuote.status, 201);

  const customerDashAfterQuote = await request("/dashboard", { cookie: customerCookie });
  checkTrue(
    "customer dashboard: shows the vendor just requested a quote from",
    customerDashAfterQuote.text.includes(`Automated Test Studio ${RUN_ID}`)
  );

  // ---------- Edit listing ----------
  const editNoAuth = await request(`/api/vendors/${createdVendorId}`, {
    method: "PATCH",
    body: { name: "Hacked Name" },
  });
  check("edit listing: rejected without auth (401)", editNoAuth.status, 401);

  const editByOtherUser = await request(`/api/vendors/${createdVendorId}`, {
    method: "PATCH",
    body: { name: "Wrong Owner Edit" },
    cookie: customerCookie, // not the owner of this listing
  });
  check("edit listing: rejected when not the owner (404, not leaked as 403)", editByOtherUser.status, 404);

  const editOk = await request(`/api/vendors/${createdVendorId}`, {
    method: "PATCH",
    body: { name: `Renamed Studio ${RUN_ID}`, price: 45000 },
    cookie: vendorCookie,
  });
  check("edit listing: owner can update their own listing (200)", editOk.status, 200);
  check("edit listing: name actually changed", editOk.data?.vendor?.name, `Renamed Studio ${RUN_ID}`);
  check("edit listing: unset fields left unchanged (category still Photography)", editOk.data?.vendor?.category, "Photography");

  const editBadVendorId = await request(`/api/vendors/999999999`, {
    method: "PATCH",
    body: { name: "Doesn't matter" },
    cookie: vendorCookie,
  });
  check("edit listing: nonexistent vendor id returns 404", editBadVendorId.status, 404);

  // ---------- Quote status updates ----------
  // Submit a fresh quote against createdVendorId specifically for this section.
  const freshQuote = await request(`/api/vendors/${createdVendorId}/quotes`, {
    method: "POST",
    body: { name: "Status Test Customer", phone: "9999955555" },
  });
  const quoteIdForStatusTest = freshQuote.data?.quote?.id;
  checkTrue("quote status setup: got a quote id to test with", typeof quoteIdForStatusTest === "number");

  const statusNoAuth = await request(`/api/quotes/${quoteIdForStatusTest}`, {
    method: "PATCH",
    body: { status: "booked" },
  });
  check("quote status: rejected without auth (401)", statusNoAuth.status, 401);

  const statusInvalid = await request(`/api/quotes/${quoteIdForStatusTest}`, {
    method: "PATCH",
    body: { status: "not_a_real_status" },
    cookie: vendorCookie,
  });
  check("quote status: invalid status value rejected (400)", statusInvalid.status, 400);

  const statusByWrongVendor = await request(`/api/quotes/${quoteIdForStatusTest}`, {
    method: "PATCH",
    body: { status: "booked" },
    cookie: customerCookie, // has no vendor listing at all
  });
  check("quote status: rejected when caller doesn't own the vendor listing (404)", statusByWrongVendor.status, 404);

  const statusOk = await request(`/api/quotes/${quoteIdForStatusTest}`, {
    method: "PATCH",
    body: { status: "responded" },
    cookie: vendorCookie,
  });
  check("quote status: owner can update status (200)", statusOk.status, 200);
  check("quote status: status actually changed", statusOk.data?.quote?.status, "responded");

  const statusRows = await dbQuery("SELECT status FROM quote_requests WHERE id = $1", [quoteIdForStatusTest]);
  if (statusRows) check("quote status: change is stored", statusRows[0]?.status, "responded");

  // ---------- Reviews ----------
  const vendorBeforeReview = await request(`/api/vendors/${createdVendorId}`);
  const reviewsCountBefore = vendorBeforeReview.data?.vendor?.reviews_count;

  const reviewNoAuth = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 5, body: "Great service overall" },
  });
  check("review: rejected without auth (401)", reviewNoAuth.status, 401);

  const reviewBadRating = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 7, body: "Rating out of range" },
    cookie: customerCookie,
  });
  check("review: out-of-range rating rejected (400)", reviewBadRating.status, 400);

  const reviewTooShort = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 4, body: "ok" },
    cookie: customerCookie,
  });
  check("review: body too short rejected (400)", reviewTooShort.status, 400);

  const reviewOwnListing = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 5, body: "Reviewing my own business, shouldn't be allowed" },
    cookie: vendorCookie, // vendorCookie owns createdVendorId
  });
  check("review: rejected when reviewing your own listing (403)", reviewOwnListing.status, 403);

  const reviewOk = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 5, body: "Excellent to work with, highly recommend for weddings." },
    cookie: customerCookie,
  });
  check("review: valid submission accepted (201)", reviewOk.status, 201);

  const reviewDuplicate = await request(`/api/vendors/${createdVendorId}/reviews`, {
    method: "POST",
    body: { rating: 3, body: "Trying to review the same vendor twice" },
    cookie: customerCookie,
  });
  check("review: duplicate review by same customer rejected (409)", reviewDuplicate.status, 409);

  const vendorAfterReview = await request(`/api/vendors/${createdVendorId}`);
  check(
    "review: vendor's reviews_count incremented",
    vendorAfterReview.data?.vendor?.reviews_count,
    reviewsCountBefore + 1
  );
  check(
    "review: vendor's rating recalculated to the new review's rating",
    Number(vendorAfterReview.data?.vendor?.rating),
    5
  );

  const reviewBadVendor = await request(`/api/vendors/999999999/reviews`, {
    method: "POST",
    body: { rating: 4, body: "Reviewing a vendor that doesn't exist" },
    cookie: customerCookie,
  });
  check("review: nonexistent vendor returns 404", reviewBadVendor.status, 404);

  const profilePageAfterReview = await request(`/vendors/${createdVendorId}`);
  checkTrue(
    "vendor profile page: shows the newly submitted review text",
    profilePageAfterReview.text.includes("Excellent to work with")
  );

  // ---------- Favorites ----------
  const favNoAuth = await request(`/api/vendors/1/favorite`, { method: "POST" });
  check("favorite: rejected without auth (401)", favNoAuth.status, 401);

  const favAdd = await request(`/api/vendors/1/favorite`, { method: "POST", cookie: customerCookie });
  check("favorite: add succeeds (200)", favAdd.status, 200);
  check("favorite: response confirms favorited=true", favAdd.data?.favorited, true);

  const favAddAgain = await request(`/api/vendors/1/favorite`, { method: "POST", cookie: customerCookie });
  check("favorite: adding the same vendor twice doesn't error (idempotent, 200)", favAddAgain.status, 200);

  const dashWithFavorite = await request("/dashboard", { cookie: customerCookie });
  checkTrue(
    "customer dashboard: shows the favorited vendor",
    dashWithFavorite.text.includes("Backwater Grand Palace")
  );

  const favRemove = await request(`/api/vendors/1/favorite`, { method: "DELETE", cookie: customerCookie });
  check("favorite: remove succeeds (200)", favRemove.status, 200);
  check("favorite: response confirms favorited=false", favRemove.data?.favorited, false);

  const favBadVendorId = await request(`/api/vendors/not-a-number/favorite`, {
    method: "POST",
    cookie: customerCookie,
  });
  check("favorite: non-numeric vendor id rejected (400)", favBadVendorId.status, 400);

  // ---------- Search suggestions ----------
  const suggestShort = await request("/api/suggest?q=k");
  check("suggest: query under 2 chars returns empty results (not an error)", suggestShort.status, 200);
  check("suggest: query under 2 chars returns no vendors", suggestShort.data?.vendors?.length, 0);

  const suggestCategory = await request("/api/suggest?q=Photo");
  checkTrue(
    "suggest: partial category match found (Photography)",
    suggestCategory.data?.categories?.includes("Photography")
  );

  const suggestLocation = await request("/api/suggest?q=Koc");
  checkTrue(
    "suggest: partial location match found (Kochi)",
    suggestLocation.data?.locations?.includes("Kochi")
  );

  const suggestVendorName = await request("/api/suggest?q=Backwater");
  checkTrue(
    "suggest: partial vendor name match found (Backwater Grand Palace)",
    suggestVendorName.data?.vendors?.some((v) => v.name === "Backwater Grand Palace")
  );

  const suggestNoMatch = await request("/api/suggest?q=zzzznomatchzzzz");
  check("suggest: no matches returns empty arrays, not an error", suggestNoMatch.status, 200);
  check(
    "suggest: no matches — all three categories empty",
    (suggestNoMatch.data?.categories?.length ?? -1) +
      (suggestNoMatch.data?.locations?.length ?? -1) +
      (suggestNoMatch.data?.vendors?.length ?? -1),
    0
  );

  // ---------- Settings ----------
  const settingsNoAuth = await request("/api/account", {
    method: "PATCH",
    body: { name: "Hacker" },
  });
  check("settings: rejected without auth (401)", settingsNoAuth.status, 401);

  const settingsUpdate = await request("/api/account", {
    method: "PATCH",
    body: { name: "Updated Test Name", emailNotifications: false },
    cookie: customerCookie,
  });
  check("settings: update succeeds (200)", settingsUpdate.status, 200);
  check("settings: name actually changed", settingsUpdate.data?.user?.name, "Updated Test Name");
  check("settings: email_notifications actually changed", settingsUpdate.data?.user?.emailNotifications, false);

  const settingsEmailConflict = await request("/api/account", {
    method: "PATCH",
    body: { email: vendorEmail }, // already taken by the vendor test account
    cookie: customerCookie,
  });
  check("settings: email conflict with another account rejected (409)", settingsEmailConflict.status, 409);

  // ---------- Kerala lookups, services, portfolio, modular inquiries ----------
  const meta = await request("/api/meta");
  check("meta: reachable (200)", meta.status, 200);
  checkTrue("meta: includes new categories (Videography, Event Management)",
    meta.data?.categories?.includes("Videography") && meta.data?.categories?.includes("Event Management"));
  check("meta: all 14 Kerala districts present", meta.data?.districts?.length, 14);
  checkTrue("meta: Ernakulam is a district", meta.data?.districts?.some((d) => d.name === "Ernakulam"));

  const seededDetail = await request("/api/vendors/1");
  checkTrue("vendor detail: includes a services array with at least one service",
    Array.isArray(seededDetail.data?.services) && seededDetail.data.services.length >= 1);
  checkTrue("vendor detail: includes a portfolio array", Array.isArray(seededDetail.data?.portfolio));
  check("vendor detail: vendor has a type and approved status",
    [seededDetail.data?.vendor?.vendor_type, seededDetail.data?.vendor?.status], ["company", "approved"]);

  const seededServices = await request("/api/vendors/1/services");
  const seededServiceId = seededServices.data?.services?.[0]?.id;
  checkTrue("services: public list for a seeded vendor works", typeof seededServiceId === "number");

  const newListingServices = await request(`/api/vendors/${createdVendorId}/services`);
  check("services: a newly created listing gets one starting service",
    [newListingServices.data?.services?.length, newListingServices.data?.services?.[0]?.category], [1, "Photography"]);

  const svcBody = { category: "Videography", title: "Wedding highlight film", description: "3-minute film", priceFrom: 25000, priceUnit: "event" };
  const svcNoAuth = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: svcBody });
  check("services: create rejected without auth (401)", svcNoAuth.status, 401);
  const svcAsCustomer = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: svcBody, cookie: customerCookie });
  check("services: create rejected for customer role (403)", svcAsCustomer.status, 403);
  const svcBadCategory = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: { ...svcBody, category: "Nope" }, cookie: vendorCookie });
  check("services: invalid category rejected (400)", svcBadCategory.status, 400);
  const svcBadPrice = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: { ...svcBody, priceFrom: -5 }, cookie: vendorCookie });
  check("services: negative price rejected (400)", svcBadPrice.status, 400);
  const svcBadUnit = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: { ...svcBody, priceUnit: "fortnight" }, cookie: vendorCookie });
  check("services: invalid price unit rejected (400)", svcBadUnit.status, 400);

  const otherVendorReg = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Other Vendor", email: `other-vendor-${RUN_ID}@example.com`, password: "password123", role: "vendor" },
  });
  const otherVendorCookie = otherVendorReg.cookie;
  const svcNotOwner = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: svcBody, cookie: otherVendorCookie });
  check("services: create on someone else's listing rejected (404)", svcNotOwner.status, 404);

  const svcCreate = await request(`/api/vendors/${createdVendorId}/services`, { method: "POST", body: svcBody, cookie: vendorCookie });
  check("services: owner can create a service (201)", svcCreate.status, 201);
  const newServiceId = svcCreate.data?.service?.id;
  check("services: created service has the right category and price",
    [svcCreate.data?.service?.category, svcCreate.data?.service?.price_from], ["Videography", 25000]);

  const svcPatchNotOwner = await request(`/api/services/${newServiceId}`, { method: "PATCH", body: { title: "Hacked" }, cookie: otherVendorCookie });
  check("services: edit by non-owner rejected (404)", svcPatchNotOwner.status, 404);
  const svcPatchOk = await request(`/api/services/${newServiceId}`, { method: "PATCH", body: { title: "Wedding film (updated)", priceFrom: 30000 }, cookie: vendorCookie });
  check("services: owner can edit (200)", svcPatchOk.status, 200);
  check("services: edit changed title and price",
    [svcPatchOk.data?.service?.title, svcPatchOk.data?.service?.price_from], ["Wedding film (updated)", 30000]);

  // Modular inquiry: ask for only some services.
  const quoteWithServices = await request(`/api/vendors/${createdVendorId}/quotes`, {
    method: "POST",
    body: { name: "Modular Customer", phone: "9999966666", serviceIds: [newServiceId] },
  });
  check("quote with services: accepted (201)", quoteWithServices.status, 201);
  const quoteForeignService = await request(`/api/vendors/${createdVendorId}/quotes`, {
    method: "POST",
    body: { name: "Modular Customer", phone: "9999966666", serviceIds: [seededServiceId] },
  });
  check("quote with services: another vendor's service rejected (400)", quoteForeignService.status, 400);
  const quoteBadIds = await request(`/api/vendors/${createdVendorId}/quotes`, {
    method: "POST",
    body: { name: "Modular Customer", phone: "9999966666", serviceIds: "all" },
  });
  check("quote with services: malformed serviceIds rejected (400)", quoteBadIds.status, 400);
  // The lead keeps a snapshot of the unit(s) the customer asked for (P0-15 data side).
  const leadUnitRows = await dbQuery(
    "SELECT snapshot->>'title' AS title FROM quote_request_services WHERE quote_request_id = $1",
    [quoteWithServices.data?.quote?.id ?? quoteWithServices.data?.id ?? -1]
  );
  if (leadUnitRows) checkTrue("lead units: lead stores which service was asked for",
    leadUnitRows.some((r) => r.title === "Wedding film (updated)"));

  // Deactivated services disappear from the public list; delete is owner-only.
  const svcDeactivate = await request(`/api/services/${newServiceId}`, { method: "PATCH", body: { active: false }, cookie: vendorCookie });
  check("services: owner can deactivate (200)", svcDeactivate.status, 200);
  const afterDeactivate = await request(`/api/vendors/${createdVendorId}/services`);
  check("services: deactivated service hidden from public list", afterDeactivate.data?.services?.length, 1);

  const svcDeleteNotOwner = await request(`/api/services/${newServiceId}`, { method: "DELETE", cookie: otherVendorCookie });
  check("services: delete by non-owner rejected (404)", svcDeleteNotOwner.status, 404);
  const svcDeleteOk = await request(`/api/services/${newServiceId}`, { method: "DELETE", cookie: vendorCookie });
  check("services: owner can delete (200)", svcDeleteOk.status, 200);
  const svcDeleteAgain = await request(`/api/services/${newServiceId}`, { method: "DELETE", cookie: vendorCookie });
  // A service that past enquiries refer to is kept (deactivated) rather than
  // deleted, so removing it again is a harmless 200; a real delete gives 404.
  check("services: deleting twice returns 404 (or 200 if kept for past leads)",
    svcDeleteAgain.status, svcDeleteOk.data?.mode === "deactivated" ? 200 : 404);

  // ---------- Logout ----------
  const logout = await request("/api/auth/logout", { method: "POST", cookie: customerCookie });
  check("logout: succeeds (200)", logout.status, 200);

  // ---------- Role-specific dashboard content ----------
  const customerDashHtml = await request("/dashboard", { cookie: customerCookie });
  checkTrue(
    "customer dashboard: shows customer-specific content (quote requests section)",
    customerDashHtml.text.includes("quote request")
  );

  const vendorDashHtml = await request("/dashboard", { cookie: vendorCookie });
  checkTrue("vendor dashboard: vendor session on /dashboard is sent to /vendor", redirectsToVendor(vendorDashHtml));
  const customerOnVendor = await request("/vendor/leads", { cookie: customerCookie });
  checkTrue("role guard: customer on /vendor/* is redirected away",
    [307, 308].includes(customerOnVendor.status) && !isVendorPath(customerOnVendor.headers.location));
  const legacyLeads = await request("/dashboard/leads/5", { cookie: vendorCookie });
  check("legacy redirect: /dashboard/leads/5 -> /vendor/leads/5 (308)", `${legacyLeads.status} ${new URL(legacyLeads.headers.location ?? "/", BASE_URL).pathname}`, "308 /vendor/leads/5");
  const adminAsVendor = await request("/admin", { cookie: vendorCookie });
  check("role guard: /admin is 404 for a vendor", adminAsVendor.status, 404);

  await p0VendorWorkspace({ customerCookie, vendorCookie, legacyLeadId: quoteWithServices.data?.quote?.id ?? quoteWithServices.data?.id });

  await cleanupTestData("post-run");

  // ---------- Summary ----------
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failed checks:", failures.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

// ---------- P0 vendor workspace (PRODUCT_PLAN section 8, P0-16) ----------
// Role guards, onboarding save/resume/submit, uploads (type, size, duplicate,
// ownership), video links, offerings ("Other" + contact masking), package-only
// enquiries, unit-only enquiries and own-leads-only.

/** Raw-body request (uploads): no JSON content type, body sent as-is. */
async function rawRequest(url, { method = "PUT", body, cookie, contentType = "application/octet-stream" } = {}) {
  const res = await fetch(new URL(url, BASE_URL), {
    method,
    headers: { "Content-Type": contentType, "X-Forwarded-For": TEST_IP, ...(cookie ? { Cookie: cookie } : {}) },
    body,
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, data };
}

const fixture = (name) => readFileSync(path.join(WEB_DIR, "db", "fixtures", "media", name));

/** Reserve -> PUT bytes -> complete. Returns the last response. */
async function uploadImage(cookie, buf, { contentType = "image/jpeg", purpose = "gallery", albumId } = {}) {
  const r = await request("/api/vendor/media/uploads", {
    method: "POST",
    cookie,
    body: { kind: "image", purpose, contentType, bytes: buf.byteLength, ...(albumId ? { albumId } : {}) },
  });
  if (r.status !== 201) return r;
  const put = await rawRequest(r.data.uploadUrl, { body: buf, cookie, contentType });
  if (put.status !== 200) return put;
  return request(`/api/vendor/media/uploads/${r.data.assetId}/complete`, { method: "POST", cookie, body: {} });
}

async function p0VendorWorkspace({ vendorCookie, legacyLeadId }) {
  const reg = async (prefix, role, name) =>
    (await request("/api/auth/register", {
      method: "POST",
      body: { name, email: `${prefix}-${RUN_ID}@example.com`, password: "password123", role },
    })).cookie;
  const wiz = await reg("wiz-vendor", "vendor", "Wizard Vendor");
  const other = await reg("wiz-other", "vendor", "Other Wizard Vendor");
  const customer = (await request("/api/auth/register", {
    method: "POST",
    body: { name: "P0 Customer", email: `test-customer-${RUN_ID + 1}@example.com`, password: "password123", role: "customer" },
  })).cookie;
  checkTrue("p0 setup: test accounts registered", !!(wiz && other && customer));

  // Role guards: customers and anonymous callers never reach /api/vendor/*.
  for (const p of ["/api/vendor/listing", "/api/vendor/offerings", "/api/vendor/media", "/api/vendor/leads", "/api/vendor/home", "/api/vendor/profile"]) {
    check(`role guard: customer on ${p} is 403`, (await request(p, { cookie: customer })).status, 403);
  }
  check("role guard: anonymous /api/vendor/listing is 401", (await request("/api/vendor/listing")).status, 401);
  check("role guard: customer upload reserve is 403",
    (await request("/api/vendor/media/uploads", { method: "POST", cookie: customer, body: { kind: "image", contentType: "image/jpeg", bytes: 100 } })).status, 403);

  // ---- Onboarding: draft at step 1, save each step, resume, submit minimum ----
  const tax = (await request("/api/meta/taxonomy")).data;
  checkTrue("taxonomy: categories and templates load", Array.isArray(tax?.categories) && Array.isArray(tax?.templates));
  const cat = (slug) => tax.categories.find((c) => c.slug === slug);
  const tpl = (code) => tax.templates.find((t) => t.code === code);
  const em = cat("event-management");
  const ernakulam = tax.districts.find((d) => d.name === "Ernakulam") ?? tax.districts[0];

  check("onboarding: no listing yet", (await request("/api/vendor/listing", { cookie: wiz })).data?.listing, null);
  check("onboarding: media before a listing is 409 NO_LISTING",
    (await request("/api/vendor/media", { cookie: wiz })).data?.code, "NO_LISTING");
  let r = await request("/api/vendor/listing", {
    method: "POST",
    cookie: wiz,
    body: { name: `Wizard Events ${RUN_ID}`, vendorType: "company", primaryCategoryId: em.id, districtId: ernakulam.id, phone: "98470 12345" },
  });
  check("onboarding: step 1 creates a draft (201)", [r.status, r.data?.listing?.status], [201, "draft"]);
  check("onboarding: phone stored as E.164", r.data?.listing?.phone, "+919847012345");
  r = await request("/api/vendor/listing", {
    method: "PATCH",
    cookie: wiz,
    body: {
      about: "Wedding planners in Kochi. We run decor, photography and the day itself for families across Kerala.",
      languages: ["Malayalam", "English"], yearsExperience: 7, onboardingStep: 3,
      serviceAreas: [{ districtId: ernakulam.id, travelFee: null, travelNote: "" }],
    },
  });
  check("onboarding: a step saves (200) and moves the step forward", [r.status, r.data?.listing?.onboardingStep], [200, 3]);
  r = await request("/api/vendor/listing", { method: "PATCH", cookie: wiz, body: { onboardingStep: 2 } });
  check("onboarding: the saved step never goes back", r.data?.listing?.onboardingStep, 3);
  r = await request("/api/vendor/listing", { cookie: wiz });
  check("onboarding: resume returns the saved step and fields", [r.data?.listing?.onboardingStep, r.data?.listing?.yearsExperience], [3, 7]);
  check("onboarding: bad GSTIN rejected with its field",
    (await request("/api/vendor/listing", { method: "PATCH", cookie: wiz, body: { gstin: "123" } })).data?.field, "gstin");

  r = await request("/api/vendor/listing/submit", { method: "POST", cookie: wiz });
  check("submit: blocked without offerings and photos (400 INCOMPLETE)",
    [r.status, r.data?.code, r.data?.missing?.includes("images"), r.data?.missing?.includes("offering")], [400, "INCOMPLETE", true, true]);

  // ---- Offerings: units, "Other" with contact masking, package-only ----
  r = await request("/api/vendor/offerings", {
    method: "POST",
    cookie: wiz,
    body: { templateId: tpl("day-of-coordination").id, priceMode: "from", priceFrom: 25000, priceUnit: "event", saleMode: "separate" },
  });
  check("offerings: unit from the taxonomy created (201)", r.status, 201);
  const dayOfId = r.data?.offering?.id;
  r = await request("/api/vendor/offerings", {
    method: "POST",
    cookie: wiz,
    body: { templateId: tpl("theme-design").id, priceMode: "from", priceFrom: 40000, priceUnit: "event", saleMode: "package_only" },
  });
  check("offerings: package-only unit created", [r.status, r.data?.offering?.sale_mode], [201, "package_only"]);
  const themeId = r.data?.offering?.id;
  r = await request("/api/vendor/offerings", {
    method: "POST",
    cookie: wiz,
    body: { categoryId: cat("traditional-music").id, customName: "Kolkali team call 98470 12345", priceMode: "fixed", priceFrom: 15000, priceUnit: "event" },
  });
  check("offerings: 'Other' creates the unit and a custom request", [r.status, typeof r.data?.customRequestId], [201, "number"]);
  check("offerings: phone number in a custom name is flagged", r.data?.flaggedContact, true);
  checkTrue("offerings: phone number in a custom name is masked", !/98470/.test(r.data?.offering?.title ?? "98470"));
  r = await request("/api/vendor/packages", {
    method: "POST",
    cookie: wiz,
    body: { title: "Signature package", priceMode: "fixed", priceFrom: 60000, items: [{ serviceId: dayOfId, qty: 1 }, { serviceId: themeId, qty: 1 }] },
  });
  check("packages: built from own units (201)", [r.status, r.data?.items?.length], [201, 2]);

  // ---- Uploads: type, size, duplicate, ownership; logo/cover; video links ----
  const photos = ["kerala-celebrations-co-1.jpg", "kerala-celebrations-co-2.jpg", "kerala-celebrations-co-3.jpg"].map(fixture);
  r = await uploadImage(wiz, photos[0]);
  check("upload: a JPEG goes through reserve, PUT and complete (201)", r.status, 201);
  const firstAsset = r.data?.asset;
  checkTrue("upload: thumb, card and full variants are served from /media",
    ["thumb", "card", "full"].every((k) => typeof firstAsset?.urls?.[k] === "string" && firstAsset.urls[k].startsWith("/media/")));
  check("upload: a draft vendor's photo waits for review", firstAsset?.status, "pending_review");
  if (firstAsset?.urls?.thumb) {
    const media = await fetch(new URL(firstAsset.urls.thumb, BASE_URL));
    check("upload: /media serves the variant as WebP", [media.status, media.headers.get("content-type")], [200, "image/webp"]);
  }
  r = await uploadImage(wiz, photos[0]);
  check("upload: the same file twice is a duplicate, not a second row", [r.status, r.data?.duplicate, r.data?.asset?.id], [200, true, firstAsset?.id]);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4000, 32)]);
  check("upload: a PDF named as JPEG is refused by magic bytes (415)", (await uploadImage(wiz, pdf)).status, 415);
  check("upload: a declared GIF type is refused (415)",
    (await request("/api/vendor/media/uploads", { method: "POST", cookie: wiz, body: { kind: "image", contentType: "image/gif", bytes: 1000 } })).status, 415);
  check("upload: over 15 MB declared is refused (413)",
    (await request("/api/vendor/media/uploads", { method: "POST", cookie: wiz, body: { kind: "image", contentType: "image/jpeg", bytes: 16 * 1024 * 1024 } })).status, 413);
  const small = await request("/api/vendor/media/uploads", { method: "POST", cookie: wiz, body: { kind: "image", contentType: "image/jpeg", bytes: 1000 } });
  check("upload: a body bigger than the cap is refused (413)",
    (await rawRequest(small.data?.uploadUrl ?? "/api/vendor/media/uploads/0/file", { body: Buffer.alloc(16 * 1024 * 1024 + 1, 1), cookie: wiz })).status, 413);
  for (const buf of photos.slice(1)) await uploadImage(wiz, buf);
  const cover = await uploadImage(wiz, fixture("kerala-celebrations-co-cover.jpg"), { purpose: "cover" });
  check("upload: cover photo (201)", cover.status, 201);
  r = await request("/api/vendor/media/cover", { method: "PUT", cookie: wiz, body: { mediaId: cover.data?.asset?.id } });
  check("media: set as cover", [r.status, r.data?.mediaId], [200, cover.data?.asset?.id]);

  r = await request("/api/vendor/media/links", { method: "POST", cookie: wiz, body: { url: "https://youtu.be/aqz-KE-bpKQ" } });
  check("video link: YouTube link parsed (201)", [r.status, r.data?.asset?.provider ?? r.data?.asset?.externalProvider, r.data?.asset?.externalId], [201, "youtube", "aqz-KE-bpKQ"]);
  check("video link: other sites refused (400)",
    (await request("/api/vendor/media/links", { method: "POST", cookie: wiz, body: { url: "https://example.com/video.mp4" } })).status, 400);

  // Ownership: another vendor can't see, edit or delete these assets.
  await request("/api/vendor/listing", {
    method: "POST",
    cookie: other,
    body: { name: `Other Wizard ${RUN_ID}`, vendorType: "individual", primaryCategoryId: cat("photography").id, districtId: ernakulam.id, phone: "+919847000001" },
  });
  check("ownership: other vendor GET of this asset is 404", (await request(`/api/vendor/media/${firstAsset?.id}`, { cookie: other })).status, 404);
  check("ownership: other vendor PATCH of this asset is 404",
    (await request(`/api/vendor/media/${firstAsset?.id}`, { method: "PATCH", cookie: other, body: { caption: "mine" } })).status, 404);
  check("ownership: other vendor DELETE of this asset is 404", (await request(`/api/vendor/media/${firstAsset?.id}`, { method: "DELETE", cookie: other })).status, 404);
  check("ownership: other vendor can't PUT bytes into this upload (404)",
    (await rawRequest(`/api/vendor/media/uploads/${firstAsset?.id}/file`, { body: photos[1], cookie: other })).status, 404);
  check("ownership: other vendor can't set it as their cover (404)",
    (await request("/api/vendor/media/cover", { method: "PUT", cookie: other, body: { mediaId: firstAsset?.id } })).status, 404);
  check("ownership: other vendor's offering is 404", (await request(`/api/vendor/offerings/${dayOfId}`, { cookie: other })).status, 404);

  // Submit now that the minimum is there: pending, not public.
  r = await request("/api/vendor/listing/submit", { method: "POST", cookie: wiz });
  check("submit: with a priced unit, cover and 3 photos -> pending", [r.status, r.data?.listing?.status], [200, "pending"]);
  const wizId = r.data?.listing?.id;
  check("submit: a pending listing is not public (404)", (await request(`/api/vendors/${wizId}`)).status, 404);
  check("submit: submitting twice is 409", (await request("/api/vendor/listing/submit", { method: "POST", cookie: wiz })).status, 409);

  // ---- Enquiries on a seeded event company (db/seed.mjs) ----
  const seeded = await dbQuery(
    `SELECT s.id, s.title, s.sale_mode, s.kind FROM services s JOIN vendors v ON v.id = s.vendor_id
      WHERE v.name = 'Kerala Celebrations Co.' AND v.owner_id IS NULL ORDER BY s.id`
  );
  if (seeded?.length) {
    const vendorId = (await dbQuery("SELECT id FROM vendors WHERE name = 'Kerala Celebrations Co.'"))[0].id;
    const pkgOnly = seeded.find((s) => s.sale_mode === "package_only" && s.kind === "unit");
    const separate = seeded.find((s) => s.sale_mode === "separate" && s.kind === "unit");
    const quote = (body) => request(`/api/vendors/${vendorId}/quotes`, {
      method: "POST",
      body: { name: "P0 Customer", phone: "9999955555", message: `Automated test run ${RUN_ID}`, ...body },
    });
    r = await quote({ serviceIds: [pkgOnly.id] });
    check("enquiry: a package-only unit alone is 400 PACKAGE_ONLY", [r.status, r.data?.code], [400, "PACKAGE_ONLY"]);
    r = await quote({ units: [{ serviceId: separate.id, qty: 2 }] });
    check("enquiry: a separately bookable unit alone is accepted (201)", r.status, 201);
    const rows = await dbQuery(
      "SELECT service_id, qty::float AS qty FROM quote_request_services WHERE quote_request_id = $1",
      [r.data?.quote?.id ?? r.data?.id ?? -1]
    );
    check("enquiry: the lead stores only that unit with its quantity", rows?.map((x) => [x.service_id, x.qty]), [[separate.id, 2]]);
  } else {
    check("enquiry: seeded event company present (run npm run db:seed)", false, true);
  }

  // ---- Leads: a vendor only ever sees their own ----
  if (legacyLeadId) {
    r = await request("/api/vendor/leads", { cookie: vendorCookie });
    const own = r.data?.leads?.find((l) => l.id === legacyLeadId);
    checkTrue("leads: owner sees the lead with its requested units", !!own && Array.isArray(own.units) && own.units.length >= 1);
    r = await request("/api/vendor/leads", { cookie: other });
    checkTrue("leads: another vendor's list doesn't include it", Array.isArray(r.data?.leads) && !r.data.leads.some((l) => l.id === legacyLeadId));
    check("leads: another vendor opening it is 403", (await request(`/api/vendor/leads/${legacyLeadId}`, { cookie: other })).status, 403);
    check("leads: another vendor changing its status is 403",
      (await request(`/api/vendor/leads/${legacyLeadId}`, { method: "PATCH", cookie: other, body: { status: "booked" } })).status, 403);
    check("leads: a customer can't list vendor leads (403)", (await request("/api/vendor/leads", { cookie: customer })).status, 403);
  }

  // ---- Pages: vendor workspace renders for its vendor, guards for others ----
  for (const p of ["/vendor", "/vendor/onboarding", "/vendor/offerings", "/vendor/media", "/vendor/leads", "/vendor/profile", "/vendor/areas", "/vendor/reviews", "/vendor/settings"]) {
    check(`page: ${p} renders for its vendor (200)`, (await request(p, { cookie: wiz })).status, 200);
  }
  r = await request("/vendor/media", { cookie: customer });
  checkTrue("page: customer on /vendor/media is redirected away", [307, 308].includes(r.status) && !isVendorPath(r.headers.location));
  r = await request("/vendor/media");
  checkTrue("page: signed-out /vendor/media goes to login with next",
    [307, 308].includes(r.status) && (r.headers.location ?? "").includes("/login") && (r.headers.location ?? "").includes("next=%2Fvendor%2Fmedia"));

  // Delete by the owner removes the asset.
  r = await request(`/api/vendor/media/${firstAsset?.id}`, { method: "DELETE", cookie: wiz });
  check("media: owner can delete (200)", r.status, 200);
  check("media: deleted asset is gone (404)", (await request(`/api/vendor/media/${firstAsset?.id}`, { cookie: wiz })).status, 404);
}

main().catch((err) => {
  console.error("FATAL:", err);
  console.error("\nIs the dev server running? Try: npm run dev (in another terminal), then re-run this.");
  process.exit(1);
});
