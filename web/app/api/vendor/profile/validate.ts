// Validation for the vendor business profile (/api/vendor/profile) and the
// served-districts form (/api/vendor/profile/areas). PRODUCT_PLAN P0-13.
//
// Self-contained on purpose (no imports): the route maps the result onto
// lib/db ListingPatch, and tests/profile-validation.test.mjs imports this file
// directly with Node's type stripping.
//
// PATCH semantics: a key that is absent is left unchanged; a key that is
// present and invalid is an error ({field, error, code:"VALIDATION"}); for the
// optional text fields an empty string or null clears the value.

export type ProfilePatch = {
  name?: string;
  vendorType?: "company" | "individual";
  primaryCategoryId?: number;
  additionalCategoryIds?: number[];
  about?: string;
  yearsExperience?: number | null;
  yearEstablished?: number | null;
  teamSize?: number | null;
  languages?: string[];
  tags?: string[];
  phone?: string | null;
  whatsapp?: string | null;
  districtId?: number;
  location?: string;
  addressLine?: string | null;
  landmark?: string | null;
  pincode?: string | null;
  legalName?: string | null;
  gstin?: string | null;
  fssaiNo?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
  websiteUrl?: string | null;
  travelOutsideKerala?: boolean;
  maxEventsPerDay?: number;
  maxGuests?: number | null;
};

export type ValidationError = { ok: false; field: string; error: string; code: "VALIDATION" };
export type ProfileResult = { ok: true; patch: ProfilePatch } | ValidationError;

export const PROFILE_LIMITS = {
  name: 120,
  legalName: 160,
  about: 2000,
  location: 80,
  address: 200,
  landmark: 120,
  url: 300,
  languages: 10,
  languageLength: 30,
  tags: 10,
  tagLength: 30,
  additionalCategories: 6,
  travelNote: 140,
  travelFee: 1_000_000,
} as const;

/** Suggestions for the languages field (free text is allowed too). */
export const LANGUAGE_OPTIONS = ["Malayalam", "English", "Hindi", "Tamil", "Kannada", "Arabic", "Tulu", "Konkani"];

const fail = (field: string, error: string): ValidationError => ({ ok: false, field, error, code: "VALIDATION" });

function stripControl(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/**
 * Phone in E.164. Indian numbers may be typed as 10 digits, with 0 / 91 / +91
 * and spaces or dashes; they come back as +91XXXXXXXXXX. Other countries must
 * start with + and the country code (+971 50 123 4567).
 */
export function normaliseE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  let d = s;
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Indian GSTIN: 2-digit state code, PAN (5 letters, 4 digits, 1 letter),
 * entity number, 'Z', and a mod-36 check character. Returns the upper-cased
 * GSTIN or null.
 */
export function normaliseGstin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const g = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return null;
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? g : null;
}

/** Indian PIN code: 6 digits, not starting with 0. */
export function normalisePincode(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const p = String(raw).replace(/\s+/g, "");
  return /^[1-9][0-9]{5}$/.test(p) ? p : null;
}

function normaliseUrl(raw: string, hosts: string[] | null): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname.includes(".")) return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  if (hosts && !hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return u.toString();
}

function intField(v: unknown): number | null | "invalid" {
  if (v === null || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d{1,9}$/.test(v.trim())) return Number(v.trim());
  return "invalid";
}

function idField(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

function stringList(v: unknown, maxCount: number, maxLen: number): string[] | null {
  const arr = typeof v === "string" ? v.split(",") : v;
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr as string[]) {
    const t = stripControl(raw).trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > maxLen) return null;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.length > maxCount ? null : out;
}

/**
 * Validates a PATCH body for the business profile. `currentYear` is injectable
 * for tests.
 */
export function parseProfileBody(body: unknown, currentYear = new Date().getFullYear()): ProfileResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body", "Invalid request body.");
  const raw = body as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined;
  const patch: ProfilePatch = {};

  // Optional free text: "" / null clears.
  const optText = (key: keyof ProfilePatch & string, max: number, label: string): ValidationError | null => {
    if (!has(key)) return null;
    const v = raw[key];
    if (v === null) {
      (patch as Record<string, unknown>)[key] = null;
      return null;
    }
    if (typeof v !== "string") return fail(key, `${label} must be text.`);
    const s = stripControl(v).trim().replace(/[ \t]+/g, " ");
    if (s.length > max) return fail(key, `${label} can be at most ${max} characters.`);
    (patch as Record<string, unknown>)[key] = s || null;
    return null;
  };

  if (has("name")) {
    const v = raw.name;
    const s = typeof v === "string" ? stripControl(v).trim().replace(/\s+/g, " ") : "";
    if (s.length < 2 || s.length > PROFILE_LIMITS.name) {
      return fail("name", `Enter your business name (2-${PROFILE_LIMITS.name} characters).`);
    }
    patch.name = s;
  }
  if (has("vendorType")) {
    if (raw.vendorType !== "company" && raw.vendorType !== "individual") {
      return fail("vendorType", "Choose company or individual.");
    }
    patch.vendorType = raw.vendorType;
  }
  if (has("primaryCategoryId")) {
    const n = idField(raw.primaryCategoryId);
    if (n === null) return fail("primaryCategoryId", "Choose your main category.");
    patch.primaryCategoryId = n;
  }
  if (has("additionalCategoryIds")) {
    const v = raw.additionalCategoryIds;
    if (!Array.isArray(v)) return fail("additionalCategoryIds", "Choose other categories from the list.");
    const ids = v.map(idField);
    if (ids.some((x) => x === null)) return fail("additionalCategoryIds", "Choose other categories from the list.");
    const unique = Array.from(new Set(ids as number[]));
    if (unique.length > PROFILE_LIMITS.additionalCategories) {
      return fail("additionalCategoryIds", `Pick at most ${PROFILE_LIMITS.additionalCategories} other categories.`);
    }
    patch.additionalCategoryIds = unique;
  }
  if (has("about")) {
    const v = raw.about;
    if (typeof v !== "string") return fail("about", "About must be text.");
    const s = stripControl(v).trim();
    if (s.length > PROFILE_LIMITS.about) return fail("about", `About can be at most ${PROFILE_LIMITS.about} characters.`);
    patch.about = s;
  }
  if (has("yearsExperience")) {
    const n = intField(raw.yearsExperience);
    if (n === "invalid" || (n !== null && (n < 0 || n > 80))) {
      return fail("yearsExperience", "Years of experience must be a number from 0 to 80.");
    }
    patch.yearsExperience = n;
  }
  if (has("yearEstablished")) {
    const n = intField(raw.yearEstablished);
    if (n === "invalid" || (n !== null && (n < 1900 || n > currentYear))) {
      return fail("yearEstablished", `Year started must be between 1900 and ${currentYear}.`);
    }
    patch.yearEstablished = n;
  }
  if (has("teamSize")) {
    const n = intField(raw.teamSize);
    if (n === "invalid" || (n !== null && (n < 1 || n > 10000))) {
      return fail("teamSize", "Team size must be a number from 1 to 10,000.");
    }
    patch.teamSize = n;
  }
  if (has("languages")) {
    const list = stringList(raw.languages, PROFILE_LIMITS.languages, PROFILE_LIMITS.languageLength);
    if (!list) return fail("languages", `List up to ${PROFILE_LIMITS.languages} languages.`);
    patch.languages = list;
  }
  if (has("tags")) {
    const list = stringList(raw.tags, PROFILE_LIMITS.tags, PROFILE_LIMITS.tagLength);
    if (!list) {
      return fail("tags", `Use at most ${PROFILE_LIMITS.tags} specialities of up to ${PROFILE_LIMITS.tagLength} characters.`);
    }
    patch.tags = list;
  }
  for (const key of ["phone", "whatsapp"] as const) {
    if (!has(key)) continue;
    const v = raw[key];
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      if (key === "phone") return fail("phone", "A phone number is required so customers can reach you.");
      patch.whatsapp = null;
      continue;
    }
    const e164 = normaliseE164(v);
    if (!e164) {
      return fail(
        key,
        key === "phone"
          ? "Enter a valid mobile number, e.g. 98470 12345 or +971 50 123 4567."
          : "Enter a valid WhatsApp number, e.g. 98470 12345."
      );
    }
    patch[key] = e164;
  }
  if (has("districtId")) {
    const n = idField(raw.districtId);
    if (n === null) return fail("districtId", "Choose your home district.");
    patch.districtId = n;
  }
  if (has("location")) {
    const v = raw.location;
    const s = typeof v === "string" ? stripControl(v).trim().replace(/\s+/g, " ") : "";
    if (s.length < 2 || s.length > PROFILE_LIMITS.location) {
      return fail("location", `Enter your town or area (2-${PROFILE_LIMITS.location} characters).`);
    }
    patch.location = s;
  }
  let e: ValidationError | null;
  if ((e = optText("addressLine", PROFILE_LIMITS.address, "Address"))) return e;
  if ((e = optText("landmark", PROFILE_LIMITS.landmark, "Landmark"))) return e;
  if ((e = optText("legalName", PROFILE_LIMITS.legalName, "Registered name"))) return e;
  if (has("pincode")) {
    const v = raw.pincode;
    if (v === null || v === "") patch.pincode = null;
    else {
      const p = normalisePincode(v);
      if (!p) return fail("pincode", "Enter a 6-digit PIN code, e.g. 682016.");
      patch.pincode = p;
    }
  }
  if (has("gstin")) {
    const v = raw.gstin;
    if (v === null || v === "") patch.gstin = null;
    else {
      const g = normaliseGstin(v);
      if (!g) return fail("gstin", "That GSTIN doesn't look right. It has 15 characters, e.g. 32ABCDE1234F1Z5.");
      patch.gstin = g;
    }
  }
  if (has("fssaiNo")) {
    const v = raw.fssaiNo;
    if (v === null || v === "") patch.fssaiNo = null;
    else {
      const s = typeof v === "string" ? v.replace(/\s+/g, "") : "";
      if (!/^[1-2]\d{13}$/.test(s)) return fail("fssaiNo", "An FSSAI licence number has 14 digits.");
      patch.fssaiNo = s;
    }
  }
  const urls: [keyof ProfilePatch & string, string[] | null, string][] = [
    ["instagramUrl", ["instagram.com"], "Enter an Instagram profile link, e.g. instagram.com/yourpage."],
    ["youtubeUrl", ["youtube.com", "youtu.be"], "Enter a YouTube channel link."],
    ["websiteUrl", null, "Enter a website address, e.g. yourbusiness.in."],
  ];
  for (const [key, hosts, msg] of urls) {
    if (!has(key)) continue;
    const v = raw[key];
    if (v === null || v === "") {
      (patch as Record<string, unknown>)[key] = null;
      continue;
    }
    if (typeof v !== "string" || v.length > PROFILE_LIMITS.url) return fail(key, msg);
    const u = normaliseUrl(v, hosts);
    if (!u) return fail(key, msg);
    (patch as Record<string, unknown>)[key] = u;
  }
  if (has("travelOutsideKerala")) {
    if (typeof raw.travelOutsideKerala !== "boolean") return fail("travelOutsideKerala", "Choose yes or no.");
    patch.travelOutsideKerala = raw.travelOutsideKerala;
  }
  if (has("maxEventsPerDay")) {
    const n = intField(raw.maxEventsPerDay);
    if (n === null || n === "invalid" || n < 1 || n > 50) {
      return fail("maxEventsPerDay", "Events per day must be a number from 1 to 50.");
    }
    patch.maxEventsPerDay = n;
  }
  if (has("maxGuests")) {
    const n = intField(raw.maxGuests);
    if (n === "invalid" || (n !== null && (n < 1 || n > 100000))) {
      return fail("maxGuests", "Largest event must be a number of guests from 1 to 100,000.");
    }
    patch.maxGuests = n;
  }
  if (patch.primaryCategoryId !== undefined && patch.additionalCategoryIds) {
    patch.additionalCategoryIds = patch.additionalCategoryIds.filter((id) => id !== patch.primaryCategoryId);
  }
  return { ok: true, patch };
}

export type AreaInput = { districtId: number; travelFee: number | null; travelNote: string | null };
export type AreasResult =
  | { ok: true; areas: AreaInput[]; travelOutsideKerala?: boolean }
  | ValidationError;

/** Validates PUT /api/vendor/profile/areas: {areas:[{districtId, travelFee?, travelNote?}], travelOutsideKerala?}. */
export function parseAreasBody(body: unknown): AreasResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body", "Invalid request body.");
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.areas)) return fail("areas", "Send the list of districts you serve.");
  if (raw.areas.length > 60) return fail("areas", "Too many districts.");
  const seen = new Set<number>();
  const areas: AreaInput[] = [];
  for (const [i, a] of (raw.areas as unknown[]).entries()) {
    if (!a || typeof a !== "object") return fail(`areas.${i}`, "Invalid district.");
    const r = a as Record<string, unknown>;
    const id = idField(r.districtId);
    if (id === null) return fail(`areas.${i}.districtId`, "Choose a district from the list.");
    if (seen.has(id)) continue;
    seen.add(id);
    let fee: number | null = null;
    if (r.travelFee !== undefined && r.travelFee !== null && r.travelFee !== "") {
      const n = intField(r.travelFee);
      if (n === null || n === "invalid" || n < 0 || n > PROFILE_LIMITS.travelFee) {
        return fail(`areas.${i}.travelFee`, "Travel fee must be a whole number of rupees.");
      }
      fee = n === 0 ? null : n;
    }
    let note: string | null = null;
    if (r.travelNote !== undefined && r.travelNote !== null) {
      if (typeof r.travelNote !== "string") return fail(`areas.${i}.travelNote`, "Travel note must be text.");
      const s = stripControl(r.travelNote).trim().replace(/\s+/g, " ");
      if (s.length > PROFILE_LIMITS.travelNote) {
        return fail(`areas.${i}.travelNote`, `Keep the travel note under ${PROFILE_LIMITS.travelNote} characters.`);
      }
      note = s || null;
    }
    areas.push({ districtId: id, travelFee: fee, travelNote: note });
  }
  const out: AreasResult = { ok: true, areas };
  if (raw.travelOutsideKerala !== undefined) {
    if (typeof raw.travelOutsideKerala !== "boolean") return fail("travelOutsideKerala", "Choose yes or no.");
    out.travelOutsideKerala = raw.travelOutsideKerala;
  }
  return out;
}

/** "Free", "₹5,000 travel", "Travel on request" (PRODUCT_PLAN 3.6). */
export function travelLabel(fee: number | null, note: string | null): string {
  if (fee != null && fee > 0) return `₹${fee.toLocaleString("en-IN")} travel`;
  if (note && note.trim()) return "Travel on request";
  return "No travel fee";
}
