// Validation for /api/vendor/listing (wizard steps and the business profile).
// Pure functions, no DB: the route checks district / category existence.
import type { ListingPatch, VendorRecord } from "@/lib/db";

export type ParseFailure = { ok: false; field: string; error: string; code: "VALIDATION" };
const fail = (field: string, error: string): ParseFailure => ({ ok: false, field, error, code: "VALIDATION" });

export interface ServiceAreaInput {
  districtId: number;
  travelFee: number | null;
  travelNote: string | null;
}

export type ParsedListing = ListingPatch & { serviceAreas?: ServiceAreaInput[] };

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises an Indian-first phone number to E.164: "98470 12345" and
 * "098470 12345" -> +919847012345, "0091 ..." -> "+91...". Returns null for
 * anything that isn't a plausible number.
 */
export function normalisePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    if (/^0?[6-9]\d{9}$/.test(s)) s = "+91" + s.slice(-10);
    else if (/^91[6-9]\d{9}$/.test(s)) s = "+" + s;
    else return null;
  }
  return E164.test(s) ? s : null;
}

type R<T> = { skip: true } | { value: T | null } | { error: ParseFailure };

function text(raw: Record<string, unknown>, key: string, min: number, max: number, label: string): R<string> {
  const v = raw[key];
  if (v === undefined) return { skip: true };
  if (v === null) return { value: null };
  if (typeof v !== "string") return { error: fail(key, `${label} must be text.`) };
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (s.length === 0 && min === 0) return { value: null };
  if (s.length < min || s.length > max) {
    return { error: fail(key, min > 0 ? `${label} must be ${min} to ${max} characters.` : `${label} must be ${max} characters or fewer.`) };
  }
  return { value: s };
}

function int(raw: Record<string, unknown>, key: string, min: number, max: number, label: string): R<number> {
  const v = raw[key];
  if (v === undefined) return { skip: true };
  if (v === null || v === "") return { value: null };
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return { error: fail(key, `${label} must be a whole number from ${min} to ${max}.`) };
  return { value: n };
}

function url(raw: Record<string, unknown>, key: string, label: string, host?: RegExp): R<string> {
  const r = text(raw, key, 0, 300, label);
  if ("skip" in r || "error" in r || r.value === null) return r;
  let s = r.value;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error();
    if (host && !host.test(u.hostname)) return { error: fail(key, `Please enter a valid ${label} link.`) };
    return { value: u.toString() };
  } catch {
    return { error: fail(key, `Please enter a valid ${label} link.`) };
  }
}

function idList(v: unknown, key: string, max: number): number[] | ParseFailure {
  if (!Array.isArray(v)) return fail(key, "Must be a list.");
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) return fail(key, "Please choose valid options.");
    if (!out.includes(n)) out.push(n);
  }
  if (out.length > max) return fail(key, `Choose at most ${max}.`);
  return out;
}

export const MAX_ADDITIONAL_CATEGORIES = 5;
export const ABOUT_MIN = 30;
export const ABOUT_MAX = 2000;

/**
 * Parses a PATCH (or the extra fields of the POST) body into a ListingPatch.
 * Unknown keys are ignored; `undefined` keeps the stored value, null clears.
 */
export function parseListingBody(body: Record<string, unknown>): { ok: true; patch: ParsedListing } | ParseFailure {
  const p: ParsedListing = {};

  const name = text(body, "name", 2, 120, "Business name");
  if ("error" in name) return name.error!;
  if ("value" in name) {
    if (name.value === null) return fail("name", "Please enter your business name.");
    p.name = name.value;
  }

  if (body.vendorType !== undefined) {
    if (body.vendorType !== "company" && body.vendorType !== "individual") {
      return fail("vendorType", "Choose Company or Individual.");
    }
    p.vendorType = body.vendorType;
  }

  const pc = int(body, "primaryCategoryId", 1, 2147483647, "Category");
  if ("error" in pc) return pc.error!;
  if ("value" in pc) {
    if (pc.value === null) return fail("primaryCategoryId", "Please choose your main category.");
    p.primaryCategoryId = pc.value;
  }
  if (body.additionalCategoryIds !== undefined) {
    const ids = idList(body.additionalCategoryIds, "additionalCategoryIds", MAX_ADDITIONAL_CATEGORIES);
    if (!Array.isArray(ids)) return ids;
    p.additionalCategoryIds = ids;
  }

  const about = text(body, "about", 0, ABOUT_MAX, "About");
  if ("error" in about) return about.error!;
  if ("value" in about) p.about = about.value ?? "";

  const ye = int(body, "yearsExperience", 0, 80, "Years of experience");
  if ("error" in ye) return ye.error!;
  if ("value" in ye) p.yearsExperience = ye.value;

  const thisYear = new Date().getFullYear();
  const ys = int(body, "yearEstablished", 1900, thisYear, "Year started");
  if ("error" in ys) return ys.error!;
  if ("value" in ys) p.yearEstablished = ys.value;

  const ts = int(body, "teamSize", 1, 10000, "Team size");
  if ("error" in ts) return ts.error!;
  if ("value" in ts) p.teamSize = ts.value;

  if (body.languages !== undefined) {
    const list = body.languages === null ? [] : body.languages;
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return fail("languages", "Languages must be a list.");
    const cleaned = [...new Set((list as string[]).map((s) => s.trim()).filter(Boolean))];
    if (cleaned.length > 12 || cleaned.some((s) => s.length > 30)) return fail("languages", "Choose up to 12 languages.");
    p.languages = cleaned;
  }

  for (const key of ["phone", "whatsapp"] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === null || v === "") {
      if (key === "phone") return fail("phone", "Please enter a phone number customers can call.");
      p.whatsapp = null;
      continue;
    }
    if (typeof v !== "string") return fail(key, "Please enter a valid phone number.");
    const n = normalisePhone(v);
    if (!n) return fail(key, "Please enter a valid mobile number, e.g. 98470 12345 or +91 98470 12345.");
    p[key] = n;
  }

  const d = int(body, "districtId", 1, 2147483647, "District");
  if ("error" in d) return d.error!;
  if ("value" in d) {
    if (d.value === null) return fail("districtId", "Please choose your home district.");
    p.districtId = d.value;
  }
  const loc = text(body, "location", 0, 120, "Town");
  if ("error" in loc) return loc.error!;
  if ("value" in loc && loc.value) p.location = loc.value;

  for (const [key, label, max] of [
    ["addressLine", "Address", 200],
    ["landmark", "Landmark", 120],
    ["legalName", "Legal name", 160],
    ["fssaiNo", "FSSAI number", 20],
  ] as const) {
    const r = text(body, key, 0, max, label);
    if ("error" in r) return r.error!;
    if ("value" in r) p[key] = r.value;
  }
  if (p.fssaiNo && !/^\d{14}$/.test(p.fssaiNo)) return fail("fssaiNo", "FSSAI licence numbers have 14 digits.");

  const pin = text(body, "pincode", 0, 6, "PIN code");
  if ("error" in pin) return fail("pincode", "PIN codes have 6 digits.");
  if ("value" in pin) {
    if (pin.value && !/^[1-9]\d{5}$/.test(pin.value)) return fail("pincode", "PIN codes have 6 digits.");
    p.pincode = pin.value;
  }
  const gst = text(body, "gstin", 0, 15, "GSTIN");
  if ("error" in gst) return fail("gstin", "A GSTIN has 15 characters, e.g. 32ABCDE1234F1Z5.");
  if ("value" in gst) {
    const g = gst.value?.toUpperCase() ?? null;
    if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
      return fail("gstin", "A GSTIN has 15 characters, e.g. 32ABCDE1234F1Z5.");
    }
    p.gstin = g;
  }

  const ig = url(body, "instagramUrl", "Instagram", /(^|\.)instagram\.com$/i);
  if ("error" in ig) return ig.error!;
  if ("value" in ig) p.instagramUrl = ig.value;
  const yt = url(body, "youtubeUrl", "YouTube", /(^|\.)(youtube\.com|youtu\.be)$/i);
  if ("error" in yt) return yt.error!;
  if ("value" in yt) p.youtubeUrl = yt.value;
  const web = url(body, "websiteUrl", "website");
  if ("error" in web) return web.error!;
  if ("value" in web) p.websiteUrl = web.value;

  if (body.travelOutsideKerala !== undefined) {
    if (typeof body.travelOutsideKerala !== "boolean") return fail("travelOutsideKerala", "Must be true or false.");
    p.travelOutsideKerala = body.travelOutsideKerala;
  }
  const mepd = int(body, "maxEventsPerDay", 1, 50, "Events per day");
  if ("error" in mepd) return mepd.error!;
  if ("value" in mepd) p.maxEventsPerDay = mepd.value ?? 1;
  const mg = int(body, "maxGuests", 1, 100000, "Largest event (guests)");
  if ("error" in mg) return mg.error!;
  if ("value" in mg) p.maxGuests = mg.value;

  if (body.serviceAreas !== undefined) {
    if (!Array.isArray(body.serviceAreas) || body.serviceAreas.length > 30) {
      return fail("serviceAreas", "Choose up to 30 districts.");
    }
    const areas: ServiceAreaInput[] = [];
    for (const a of body.serviceAreas) {
      if (!a || typeof a !== "object") return fail("serviceAreas", "Invalid district.");
      const o = a as Record<string, unknown>;
      const id = int(o, "districtId", 1, 2147483647, "District");
      if (!("value" in id) || id.value === null) return fail("serviceAreas", "Invalid district.");
      const fee = int(o, "travelFee", 0, 1_000_000, "Travel fee");
      if ("error" in fee) return fail("serviceAreas", "Travel fee must be a whole number of rupees.");
      const note = text(o, "travelNote", 0, 200, "Travel note");
      if ("error" in note) return fail("serviceAreas", "Travel notes must be 200 characters or fewer.");
      if (areas.some((x) => x.districtId === id.value)) continue;
      areas.push({
        districtId: id.value,
        travelFee: "value" in fee ? fee.value : null,
        travelNote: "value" in note ? note.value : null,
      });
    }
    p.serviceAreas = areas;
  }

  const step = int(body, "onboardingStep", 1, 6, "Step");
  if ("error" in step) return step.error!;
  if ("value" in step && step.value !== null) p.onboardingStep = step.value;

  return { ok: true, patch: p };
}

/** The listing fields the wizard / profile pages use (no admin notes). */
export function toClientListing(v: VendorRecord) {
  return {
    id: v.id,
    name: v.name,
    vendorType: v.vendor_type,
    status: v.status,
    statusReason: v.status_reason ?? null,
    primaryCategoryId: v.primary_category_id ?? null,
    districtId: v.district_id,
    location: v.location,
    phone: v.phone,
    whatsapp: v.whatsapp,
    about: v.about,
    yearsExperience: v.years_experience ?? null,
    yearEstablished: v.year_established ?? null,
    teamSize: v.team_size ?? null,
    languages: v.languages ?? [],
    legalName: v.legal_name ?? null,
    addressLine: v.address_line ?? null,
    landmark: v.landmark ?? null,
    pincode: v.pincode ?? null,
    gstin: v.gstin ?? null,
    fssaiNo: v.fssai_no ?? null,
    instagramUrl: v.instagram_url ?? null,
    youtubeUrl: v.youtube_url ?? null,
    websiteUrl: v.website_url ?? null,
    travelOutsideKerala: v.travel_outside_kerala ?? false,
    maxEventsPerDay: v.max_events_per_day ?? 1,
    maxGuests: v.max_guests ?? null,
    price: v.price,
    priceLabel: v.price_label,
    logoUrl: v.logo_url,
    coverImageUrl: v.cover_image_url,
    logoMediaId: v.logo_media_id ?? null,
    coverMediaId: v.cover_media_id ?? null,
    onboardingStep: v.onboarding_step ?? 1,
    onboardingCompletedAt: v.onboarding_completed_at ?? null,
    submittedAt: v.submitted_at ?? null,
    rereviewRequired: v.rereview_required ?? false,
  };
}

export type ClientListing = ReturnType<typeof toClientListing>;

export const MISSING_MESSAGES: Record<string, string> = {
  basics: "Add your business name, main category, home district, phone and a short description (30+ characters).",
  offering: "Add at least one offering that customers can book on its own, with a price (or a package).",
  logo_or_cover: "Upload a logo or a cover photo.",
  images: "Upload at least 3 photos of your work.",
};
