import { test, expect, runTag, signUp, type Creds } from "./helpers";

// QA round 2, vendor group: reproductions of new issues (not fixes).
// Each test is marked test.fail() until the bug is fixed.
//
//   QA2-VENDOR "contact details not masked in About / Specialities / photo captions"
//   Offering descriptions mask phone numbers and links ("Call me at ••• or ..."),
//   and the offering form tells the vendor "Phone numbers and links are hidden
//   from customers". The About text, Specialities (tags) and photo captions
//   are saved and shown on the public profile unmasked.

test.describe("qa2 vendor findings", () => {
  let vendor: Creds;

  test.beforeAll(({}, testInfo) => {
    const tag = runTag(testInfo);
    vendor = { name: `Quinn Qatwo ${tag}`, email: `e2e-vendor-qa2-${tag}@example.com`, password: "e2e-pass-12345" };
  });

  test("QA2 vendor: phone number in About / Specialities is masked on the profile", async ({ page }) => {
    test.fail(true, "QA2 vendor finding: About and Specialities are not contact-masked");
    await signUp(page, "vendor", vendor);
    await expect(page).toHaveURL(/\/vendor\/onboarding/);
    const res = await page.request.post("/api/vendors", {
      data: {
        name: `Qatwo Studio ${vendor.email.slice(0, 24)}`,
        category: "Photography",
        location: "Kochi",
        price: 25000,
        experience: "3 yrs",
        about: "Automated e2e listing for the qa2 vendor findings.",
      },
    });
    expect(res.status()).toBe(201);
    const id = (await res.json()).vendor.id as number;

    const patch = await page.request.patch("/api/vendor/profile", {
      data: {
        about: "Candid wedding photography across Kerala. WhatsApp 9847012345 or visit www.example.com for dates.",
        tags: ["call 9847012345"],
      },
    });
    expect(patch.status()).toBe(200);

    await page.goto(`/vendors/${id}?preview=1`);
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("9847012345");
    expect(body).not.toContain("www.example.com");
  });
});
