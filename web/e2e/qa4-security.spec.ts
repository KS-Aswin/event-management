import { test, expect, signUp, runTag } from "./helpers";

// QA round 4 (security/a11y/links/perf). Reproduces bugs found in qa4; each
// test is test.fail until the bug is fixed (then drop the .fail).

// QA4-SEC-1: the root layout builds the header from getSession(), which only
// checks the cookie's signature. A session ended elsewhere (password change
// or "Sign out of other devices" on another device, or a copied cookie after
// logout) still shows the signed-in header (avatar, account menu, bell,
// customer tab bar / vendor workspace nav) on public pages, and with a
// logged-out token (revoked_sessions) even on /login itself; the cookie is
// never cleared there.
test("QA4-SEC-1: a session ended on another device doesn't keep the signed-in header", async ({ browser, page }, testInfo) => {
  const tag = runTag(testInfo);
  const creds = { name: "E2E QA4 Stale", email: `e2e-qa4-stale-${tag}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: "e2e-qa4-password-1" };
  await signUp(page, "customer", creds);

  // Another device signs in and changes the password (signs out every other device).
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const signedIn = await otherPage.request.post("/api/auth/login", { data: { email: creds.email, password: creds.password } });
  expect(signedIn.status()).toBe(200);
  const changed = await otherPage.request.post("/api/account/password", { data: { currentPassword: creds.password, newPassword: "e2e-qa4-password-2" } });
  expect(changed.status()).toBe(200);
  await other.close();

  // This device's session is dead (API says 401)...
  expect((await page.request.get("/api/notifications")).status()).toBe(401);
  // ...but the home page still renders the signed-in header.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /account menu/i })).toHaveCount(0);
});

// QA4-SEC-2: PATCH /api/account checks whether the new email is taken BEFORE
// asking for the current password, and has no rate limit. Any signed-in user
// (free signup) can test whether any email has a Vela account at ~100
// requests a second: 409 "already in use" vs 400 "Enter your current
// password". /api/auth/register gives the same answer but is limited to 10
// per 15 minutes per IP.
test("QA4-SEC-2: email change doesn't reveal registered emails without the password", async ({ page, browser }, testInfo) => {
  const tag = runTag(testInfo);
  const victim = { name: "E2E QA4 Victim", email: `e2e-qa4-victim-${tag}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: "e2e-qa4-password-1" };
  const v = await browser.newContext();
  await signUp(await v.newPage(), "customer", victim);
  await v.close();

  const creds = { name: "E2E QA4 Enum", email: `e2e-qa4-enum-${tag}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: "e2e-qa4-password-1" };
  await signUp(page, "customer", creds);
  const taken = await page.request.patch("/api/account", { data: { email: victim.email } });
  const free = await page.request.patch("/api/account", { data: { email: `e2e-qa4-free-${tag}@example.com` } });
  // Without the current password both must get the same answer.
  expect(taken.status()).toBe(free.status());
  expect((await taken.json()).field).toBe("currentPassword");
});
