// Unit tests for the vendor business profile validation (P0-13) and the
// profile-strength rule set on the vendor home (P0-12). No server or DB.
// Run with:  node --test tests/profile-validation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseE164,
  normaliseGstin,
  normalisePincode,
  parseProfileBody,
  parseAreasBody,
  travelLabel,
} from "../app/api/vendor/profile/validate.ts";
import { profileStrength } from "../app/vendor/profile-strength.ts";

test("E.164: Indian numbers in common formats", () => {
  for (const raw of ["9847012345", "98470 12345", "+91 98470-12345", "919847012345", "09847012345"]) {
    assert.equal(normaliseE164(raw), "+919847012345", raw);
  }
});

test("E.164: other countries need + and a country code", () => {
  assert.equal(normaliseE164("+971 50 123 4567"), "+971501234567");
  assert.equal(normaliseE164("12345"), null);
  assert.equal(normaliseE164("5847012345"), null); // Indian mobiles start 6-9
  assert.equal(normaliseE164("+0 123456789"), null);
  assert.equal(normaliseE164("98470abcde"), null);
});

test("GSTIN: format and check character", () => {
  assert.equal(normaliseGstin("27AAPFU0939F1ZV"), "27AAPFU0939F1ZV");
  assert.equal(normaliseGstin("27aapfu0939f1zv"), "27AAPFU0939F1ZV");
  assert.equal(normaliseGstin("27AAPFU0939F1ZA"), null, "wrong check char");
  assert.equal(normaliseGstin("99AAPFU0939F1ZV"), null, "bad state code");
  assert.equal(normaliseGstin("27AAPFU0939F1Z"), null, "too short");
});

test("PIN code: 6 digits, not starting with 0", () => {
  assert.equal(normalisePincode("682016"), "682016");
  assert.equal(normalisePincode("682 016"), "682016");
  assert.equal(normalisePincode("082016"), null);
  assert.equal(normalisePincode("68201"), null);
});

test("parseProfileBody: valid patch is normalised", () => {
  const r = parseProfileBody(
    {
      name: "  Lens   & Light ",
      vendorType: "company",
      primaryCategoryId: "3",
      additionalCategoryIds: [3, 4, 4, 5],
      phone: "98470 12345",
      whatsapp: "",
      gstin: "27aapfu0939f1zv",
      pincode: "682016",
      languages: ["Malayalam", "english", "English"],
      tags: "Candid, Drone",
      instagramUrl: "instagram.com/lenslight",
      maxGuests: "500",
      yearsExperience: 7,
    },
    2026
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    name: "Lens & Light",
    vendorType: "company",
    primaryCategoryId: 3,
    additionalCategoryIds: [4, 5],
    phone: "+919847012345",
    whatsapp: null,
    gstin: "27AAPFU0939F1ZV",
    pincode: "682016",
    languages: ["Malayalam", "english"],
    tags: ["Candid", "Drone"],
    instagramUrl: "https://instagram.com/lenslight",
    maxGuests: 500,
    yearsExperience: 7,
  });
});

test("parseProfileBody: errors name the field", () => {
  const cases = [
    [{ name: "A" }, "name"],
    [{ phone: "12" }, "phone"],
    [{ phone: "" }, "phone"],
    [{ gstin: "ABC" }, "gstin"],
    [{ pincode: "12345" }, "pincode"],
    [{ yearEstablished: 2030 }, "yearEstablished"],
    [{ maxEventsPerDay: 0 }, "maxEventsPerDay"],
    [{ instagramUrl: "facebook.com/x" }, "instagramUrl"],
    [{ vendorType: "team" }, "vendorType"],
    [{ fssaiNo: "123" }, "fssaiNo"],
  ];
  for (const [body, field] of cases) {
    const r = parseProfileBody(body, 2026);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.field, field);
    assert.equal(r.code, "VALIDATION");
  }
});

test("parseProfileBody: absent keys are untouched, empty optional text clears", () => {
  const r = parseProfileBody({ landmark: "", gstin: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { landmark: null, gstin: null });
});

test("parseAreasBody: dedupes, zero fee = free, validates", () => {
  const r = parseAreasBody({
    areas: [
      { districtId: 2, travelFee: "5000" },
      { districtId: 2, travelFee: 1 },
      { districtId: 3, travelFee: 0, travelNote: "  stay by client " },
    ],
    travelOutsideKerala: true,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.areas, [
    { districtId: 2, travelFee: 5000, travelNote: null },
    { districtId: 3, travelFee: null, travelNote: "stay by client" },
  ]);
  assert.equal(r.travelOutsideKerala, true);
  assert.equal(parseAreasBody({ areas: [{ districtId: "x" }] }).ok, false);
  assert.equal(parseAreasBody({ areas: [{ districtId: 1, travelFee: -5 }] }).ok, false);
  assert.equal(parseAreasBody({}).ok, false);
});

test("travelLabel (PRODUCT_PLAN 3.6)", () => {
  assert.equal(travelLabel(5000, null), "₹5,000 travel");
  assert.equal(travelLabel(null, "ask"), "Travel on request");
  assert.equal(travelLabel(null, ""), "No travel fee");
});

test("profileStrength: percentage matches the rule set", () => {
  const none = {
    checklist: { basics: false, logo: false, cover: false, areas: false, languages: false },
    media: { images: 0 },
    offerings: { active: 0, packages: 0 },
  };
  assert.equal(profileStrength(none, "").percent, 0);
  const all = {
    checklist: { basics: true, logo: true, cover: true, areas: true, languages: true },
    media: { images: 6 },
    offerings: { active: 3, packages: 1 },
  };
  const full = profileStrength(all, "x".repeat(150));
  assert.equal(full.percent, 100);
  assert.equal(full.done, full.total);
  // 5 photos is not enough; 149 characters of about is not enough.
  const partial = profileStrength({ ...all, media: { images: 5 } }, "x".repeat(149));
  assert.equal(partial.done, full.total - 2);
  assert.equal(partial.percent, Math.round(((full.total - 2) / full.total) * 100));
});
