// Shared request validation for the API routes. (The leading underscore keeps
// this folder out of Next.js routing.)

/** Path ids are int4 in Postgres: accept only 1..2147483647 written as plain digits. */
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2147483647 ? n : null;
}

export const LIMITS = {
  name: 80,
  businessName: 120,
  location: 80,
  budget: 40,
  message: 1000,
  reviewBody: 2000,
  about: 2000,
  experience: 20,
  tagCount: 10,
  tagLength: 30,
  email: 254,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= LIMITS.email && EMAIL_RE.test(email);
}

/** Person name: trimmed length 2..80. */
export function isValidPersonName(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= LIMITS.name;
}

/**
 * Indian mobile number. Strips spaces, dashes, dots and brackets plus a
 * leading +91 / 91 / 0, then requires 10 digits starting 6-9.
 * Returns the normalised "+91XXXXXXXXXX" form, or null when invalid.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("+")) return null;
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** Price in rupees: a number or digit-only string, safe integer, 1..100,000,000. */
export function parsePrice(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d{1,9}$/.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100_000_000) return null;
  return n;
}

/**
 * Event date as YYYY-MM-DD: a real calendar date, not in the past and at most
 * three years ahead. Returns the string or null when invalid.
 */
export function parseEventDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  // Allow "today" in any timezone around India by giving one day of slack.
  if (d.getTime() < todayUtc - 86_400_000) return null;
  const max = new Date(todayUtc);
  max.setUTCFullYear(max.getUTCFullYear() + 3);
  if (d.getTime() > max.getTime()) return null;
  return v;
}

export type ListingFields = {
  name?: string;
  category?: string;
  location?: string;
  price?: number;
  experience?: string;
  tags?: string[];
  about?: string;
  districtId?: number;
};

/**
 * Validates a vendor listing body. With `partial` (PATCH) a missing field is
 * skipped, but a field that is present and invalid is still an error, using
 * the same rules and messages as create.
 */
export function validateListingFields(
  body: unknown,
  opts: { partial: boolean; categories: readonly string[] }
): { ok: true; fields: ListingFields } | { ok: false; field: string; error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const fields: ListingFields = {};
  const present = (k: string) => raw[k] !== undefined && raw[k] !== null;
  const need = (k: string) => present(k) || !opts.partial;

  if (need("name")) {
    const v = raw.name;
    if (typeof v !== "string" || v.trim().length < 2 || v.trim().length > LIMITS.businessName) {
      return { ok: false, field: "name", error: `Please enter a business name (2-${LIMITS.businessName} characters).` };
    }
    fields.name = v.trim();
  }
  if (need("category")) {
    const v = raw.category;
    if (typeof v !== "string" || !opts.categories.includes(v)) {
      return { ok: false, field: "category", error: "Please choose a valid category." };
    }
    fields.category = v;
  }
  if (need("location")) {
    const v = raw.location;
    if (typeof v !== "string" || v.trim().length < 2 || v.trim().length > LIMITS.location) {
      return { ok: false, field: "location", error: `Please enter a location (2-${LIMITS.location} characters).` };
    }
    fields.location = v.trim().replace(/\s+/g, " ");
  }
  if (need("price")) {
    const n = parsePrice(raw.price);
    if (n === null) {
      return { ok: false, field: "price", error: "Please enter a valid starting price (a whole number of rupees)." };
    }
    fields.price = n;
  }
  if (need("experience")) {
    const v = raw.experience;
    if (typeof v !== "string" || v.trim().length < 1 || v.trim().length > LIMITS.experience) {
      return { ok: false, field: "experience", error: "Please enter your years of experience." };
    }
    fields.experience = v.trim();
  }
  if (present("tags")) {
    const v = raw.tags;
    if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) {
      return { ok: false, field: "tags", error: "Tags must be a list of words." };
    }
    const tags = Array.from(new Set((v as string[]).map((t) => t.trim()).filter(Boolean)));
    if (tags.length > LIMITS.tagCount || tags.some((t) => t.length > LIMITS.tagLength)) {
      return {
        ok: false,
        field: "tags",
        error: `Use at most ${LIMITS.tagCount} tags of up to ${LIMITS.tagLength} characters each.`,
      };
    }
    fields.tags = tags;
  } else if (!opts.partial) {
    fields.tags = [];
  }
  if (need("about")) {
    const v = raw.about;
    if (typeof v !== "string" || v.trim().length < 10 || v.trim().length > LIMITS.about) {
      return {
        ok: false,
        field: "about",
        error: `Please write a short description (10-${LIMITS.about} characters).`,
      };
    }
    fields.about = v.trim();
  }
  if (present("districtId")) {
    const v = raw.districtId;
    const n = typeof v === "number" ? v : typeof v === "string" ? parseId(v) : null;
    if (n === null || !Number.isInteger(n) || n < 1) {
      return { ok: false, field: "districtId", error: "Please choose a valid district." };
    }
    fields.districtId = n;
  }
  return { ok: true, fields };
}
