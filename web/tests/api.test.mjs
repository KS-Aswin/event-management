// Automated end-to-end test suite for the Vela API.
//
// This replaces the manual curl/psql testing that was done by hand in
// Sessions 4 and 5 (see PROJECT_LOG.md) with a real, repeatable script.
//
// Prerequisites:
//   1. Postgres running, schema applied, vendors seeded:
//        npm run db:migrate && npm run db:seed
//   2. Dev server running in another terminal:
//        npm run dev
//
// Then run:
//   npm run test:api
//
// Each run uses randomized emails for anything that creates a user, so
// it's safe to run repeatedly without manual cleanup between runs.
//
// IMPORTANT: this suite also creates a real vendor listing (via
// POST /api/vendors) as part of testing that flow, and that listing is
// NOT cleaned up afterward. The vendor-count/category-count assertions
// near the top assume exactly the 9 seeded vendors exist and run BEFORE
// the listing-creation section for that reason. If you run this suite
// twice in a row without re-running `npm run db:seed` in between, the
// count-based assertions will fail (correctly — the counts really did
// change) even though nothing is actually broken. Re-seed before each
// run to get a clean comparison.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RUN_ID = Date.now();

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

async function request(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
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
  return { status: res.status, data, text, cookie: extractCookie(res) };
}

async function main() {
  console.log(`Running against ${BASE_URL} (run id ${RUN_ID})\n`);

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

  // ---------- Protected routes ----------
  const dashNoAuth = await request("/dashboard", { });
  checkTrue("dashboard: redirects when logged out (30x)", dashNoAuth.status >= 300 && dashNoAuth.status < 400);

  const dashAuth = await request("/dashboard", { cookie: customerCookie });
  check("dashboard: accessible with valid session (200)", dashAuth.status, 200);

  // ---------- Vendors: search/filter ----------
  const allVendors = await request("/api/vendors");
  check("vendors: all 9 seeded vendors returned", allVendors.data?.vendors?.length, 9);

  const byCategory = await request("/api/vendors?category=Photography");
  check("vendors: category filter (Photography = 2)", byCategory.data?.vendors?.length, 2);

  const byLocation = await request("/api/vendors?location=Kochi");
  check("vendors: location filter (Kochi = 2)", byLocation.data?.vendors?.length, 2);

  const byRating = await request("/api/vendors?minRating=4.8");
  check("vendors: min rating filter (4.8+ = 4)", byRating.data?.vendors?.length, 4);

  const byQuery = await request("/api/vendors?q=drone");
  check("vendors: text search on tags (drone = 1)", byQuery.data?.vendors?.length, 1);

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

  const vendorDashAfterListing = await request("/dashboard", { cookie: vendorCookie });
  checkTrue(
    "vendor dashboard: shows the new listing's stats after creating it",
    vendorDashAfterListing.text.includes("Total leads")
  );

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

  const vendorDashAfterStatusChange = await request("/dashboard", { cookie: vendorCookie });
  checkTrue(
    "vendor dashboard: status dropdown reflects the update",
    vendorDashAfterStatusChange.text.includes("responded")
  );

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
  const vendorDashWithLead = await request("/dashboard", { cookie: vendorCookie });
  checkTrue("vendor dashboard: lead shows which service was asked for",
    vendorDashWithLead.text.includes("Wedding film (updated)"));

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
  check("services: deleting twice returns 404", svcDeleteAgain.status, 404);

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
  check("vendor dashboard: reachable with vendor session (200)", vendorDashHtml.status, 200);
  checkTrue(
    "vendor dashboard: shows vendor-specific content (stats), not customer content",
    vendorDashHtml.text.includes("Profile visitors") && !vendorDashHtml.text.includes("Venue — booked")
  );

  // ---------- Summary ----------
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failed checks:", failures.join(", "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  console.error("\nIs the dev server running? Try: npm run dev (in another terminal), then re-run this.");
  process.exit(1);
});
