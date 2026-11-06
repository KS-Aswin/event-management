// Creating enquiries (P2-2 single, P2-9 multi-vendor). One validator and one
// writer shared by POST /api/vendors/[id]/quotes and POST /api/enquiries/multi.
//
// Every enquiry row stores the v2 event context, the E.164 phone, the units
// asked for (with a snapshot of title/price/unit at request time), the
// customer's account (customer_id) or, for a guest, a random guest_token used
// by the tracking page /enquiry/[token]. The vendor's owner gets an in-app
// notification inside the same transaction.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, addLeadUnits, resolveEnquiryServices } from "@/lib/db";
import { withTransaction } from "@/lib/admin/tx";
import { toE164 } from "@/lib/phone";

// ---------------------------------------------------------------------------
// Limits and enums
// ---------------------------------------------------------------------------

export const ENQUIRY_LIMITS = {
  name: 80,
  message: 1000,
  budgetText: 40,
  venueText: 120,
  email: 254,
  maxUnits: 20,
  maxGuests: 100000,
  maxBudget: 1_000_000_000,
  /** P2-9: vendors per multi-vendor send. */
  maxVendorsPerBatch: 5,
  /** P2-9: enquiries per phone per rolling 24 hours (multi-vendor sends). */
  maxPerPhonePerDay: 15,
} as const;

export const VENUE_TYPES = ["home", "hall", "church", "temple", "mosque", "office", "outdoor", "other"] as const;
export const SLOTS = ["full", "morning", "evening"] as const;
export const FOOD_PREFS = ["veg", "non_veg", "both"] as const;
export const CONTACT_PREFS = ["whatsapp", "call", "email"] as const;

/** Units whose quantity the customer can state (per plate, per hour...). */
export const QTY_UNITS = new Set([
  "plate", "person", "hour", "day", "slot", "artist", "item", "set", "kg", "sqft", "km", "vehicle", "session", "piece",
]);
/** Units counted per guest: the guest count stands in for a missing quantity. */
const PER_GUEST_UNITS = new Set(["plate", "person"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnquiryFields {
  name: string;
  phone: string; // E.164
  eventDate: string | null;
  eventEndDate: string | null;
  eventTypeId: number | null;
  guestCount: number | null;
  districtId: number | null;
  venueType: (typeof VENUE_TYPES)[number] | null;
  venueText: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budget: string | null;
  slot: (typeof SLOTS)[number] | null;
  foodPref: (typeof FOOD_PREFS)[number] | null;
  preferredContact: (typeof CONTACT_PREFS)[number];
  contactEmail: string | null;
  message: string | null;
}

export type EnquiryError = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 429;
  error: string;
  code: string;
  field?: string;
  [extra: string]: unknown;
};

export type UnitRequest = Map<number, number | null>;

export interface EnquiryWarning {
  code: "BELOW_MIN_QTY" | "DATE_UNAVAILABLE";
  message: string;
  serviceId?: number;
  minQty?: number;
}

export interface EnquiryVendor {
  id: number;
  name: string;
  owner_id: number | null;
}

export interface CreatedEnquiry {
  id: number;
  vendorId: number;
  status: "pending";
  guestToken: string | null;
  /** In-app path where the sender follows this enquiry. */
  trackingPath: string;
}

function fail(status: EnquiryError["status"], error: string, code = "VALIDATION", field?: string): EnquiryError {
  return field ? { ok: false, status, error, code, field } : { ok: false, status, error, code };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function optString(raw: unknown, max: number, field: string, label: string): string | null | EnquiryError {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return fail(400, `${label} must be text.`, "VALIDATION", field);
  const v = raw.trim();
  if (v.length > max) return fail(400, `${label} must be ${max} characters or fewer.`, "VALIDATION", field);
  return v || null;
}

function optInt(raw: unknown, min: number, max: number): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,10}$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return undefined; // invalid
  return n;
}

function optEnum<T extends readonly string[]>(raw: unknown, values: T): T[number] | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  return typeof raw === "string" && (values as readonly string[]).includes(raw) ? (raw as T[number]) : undefined;
}

/** Today's date in India (YYYY-MM-DD): "past" means before this. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function parseDate(raw: unknown, field: string, label: string): string | null | EnquiryError {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return fail(400, `Please choose a valid ${label}.`, "VALIDATION", field);
  }
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    return fail(400, `Please choose a valid ${label}.`, "VALIDATION", field);
  }
  // One day of slack for customers just behind India's date (e.g. the Gulf before midnight IST).
  const today = new Date(`${todayIST()}T00:00:00Z`).getTime();
  if (d.getTime() < today - 86_400_000) {
    return fail(400, `The ${label} can't be in the past.`, "PAST_DATE", field);
  }
  const max = new Date(today);
  max.setUTCFullYear(max.getUTCFullYear() + 3);
  if (d.getTime() > max.getTime()) {
    return fail(400, "Choose a date within the next three years.", "VALIDATION", field);
  }
  return raw;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Legacy free-text budget column, filled from the band so older screens still show it. */
function budgetLabel(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return min === max ? inr(min) : `${inr(min)} – ${inr(max)}`;
  if (max != null) return `Up to ${inr(max)}`;
  if (min != null) return `${inr(min)}+`;
  return null;
}

const isErr = (v: unknown): v is EnquiryError =>
  typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false;

/**
 * Validates the shared enquiry fields (everything except the vendor and its
 * units). `accountEmail` (signed-in sender) is used as the contact email
 * when none is given.
 */
export async function parseEnquiryFields(
  body: Record<string, unknown>,
  opts: { accountEmail?: string | null } = {}
): Promise<{ ok: true; fields: EnquiryFields } | EnquiryError> {
  const L = ENQUIRY_LIMITS;
  const nameRaw = body.name;
  if (typeof nameRaw !== "string" || nameRaw.trim().length < 2) return fail(400, "Please enter your name.", "VALIDATION", "name");
  const name = nameRaw.trim().replace(/\s+/g, " ");
  if (name.length > L.name) return fail(400, `Name must be ${L.name} characters or fewer.`, "VALIDATION", "name");

  const phone = toE164(body.phone);
  if (!phone) {
    return fail(
      400,
      "Please enter a valid mobile number: 10 digits for India, or with the country code (e.g. +971 50 123 4567).",
      "VALIDATION",
      "phone"
    );
  }

  const eventDate = parseDate(body.eventDate, "eventDate", "event date");
  if (isErr(eventDate)) return eventDate;
  const eventEndDate = parseDate(body.eventEndDate, "eventEndDate", "end date");
  if (isErr(eventEndDate)) return eventEndDate;
  if (eventEndDate && (!eventDate || eventEndDate < eventDate)) {
    return fail(400, "The end date must be on or after the event date.", "VALIDATION", "eventEndDate");
  }

  const eventTypeId = optInt(body.eventTypeId, 1, 2147483647);
  if (eventTypeId === undefined) return fail(400, "Please choose a valid event type.", "VALIDATION", "eventTypeId");
  const districtId = optInt(body.districtId, 1, 2147483647);
  if (districtId === undefined) return fail(400, "Please choose a valid district.", "VALIDATION", "districtId");
  const guestCount = optInt(body.guestCount, 1, L.maxGuests);
  if (guestCount === undefined) {
    return fail(400, `Guests must be a whole number from 1 to ${L.maxGuests.toLocaleString("en-IN")}.`, "VALIDATION", "guestCount");
  }
  const budgetMin = optInt(body.budgetMin, 0, L.maxBudget);
  const budgetMax = optInt(body.budgetMax, 0, L.maxBudget);
  if (budgetMin === undefined || budgetMax === undefined) {
    return fail(400, "Please choose a valid budget.", "VALIDATION", "budget");
  }
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
    return fail(400, "The budget's lower end must not be above its upper end.", "VALIDATION", "budget");
  }

  const venueType = optEnum(body.venueType, VENUE_TYPES);
  if (venueType === undefined) return fail(400, "Please choose a valid venue type.", "VALIDATION", "venueType");
  const slot = optEnum(body.slot, SLOTS);
  if (slot === undefined) return fail(400, "Please choose morning, evening or full day.", "VALIDATION", "slot");
  const foodPref = optEnum(body.foodPref, FOOD_PREFS);
  if (foodPref === undefined) return fail(400, "Please choose a valid food preference.", "VALIDATION", "foodPref");
  const preferredContact = optEnum(body.preferredContact, CONTACT_PREFS);
  if (preferredContact === undefined) {
    return fail(400, "Please choose WhatsApp, call or email.", "VALIDATION", "preferredContact");
  }

  const venueText = optString(body.venueText, L.venueText, "venueText", "Venue");
  if (isErr(venueText)) return venueText;
  const message = optString(body.message, L.message, "message", "Message");
  if (isErr(message)) return message;
  const budgetText = optString(body.budget, L.budgetText, "budget", "Budget");
  if (isErr(budgetText)) return budgetText;

  let contactEmail: string | null = null;
  const emailRaw = optString(body.contactEmail, L.email, "contactEmail", "Email");
  if (isErr(emailRaw)) return emailRaw;
  if (emailRaw) {
    if (!EMAIL_RE.test(emailRaw)) return fail(400, "Please enter a valid email address.", "VALIDATION", "contactEmail");
    contactEmail = emailRaw.toLowerCase();
  } else if (opts.accountEmail) {
    contactEmail = opts.accountEmail.trim().toLowerCase();
  }
  if (preferredContact === "email" && !contactEmail) {
    return fail(400, "Add your email address so the vendor can reply by email.", "VALIDATION", "contactEmail");
  }

  // Reference data must exist (and event types be active).
  if (eventTypeId != null || districtId != null) {
    const { rows } = await pool.query<{ et: boolean; d: boolean }>(
      `SELECT ($1::int IS NULL OR EXISTS (SELECT 1 FROM event_types WHERE id = $1 AND active)) AS et,
              ($2::int IS NULL OR EXISTS (SELECT 1 FROM districts WHERE id = $2)) AS d`,
      [eventTypeId, districtId]
    );
    if (!rows[0].et) return fail(400, "Please choose a valid event type.", "VALIDATION", "eventTypeId");
    if (!rows[0].d) return fail(400, "Please choose a valid district.", "VALIDATION", "districtId");
  }

  return {
    ok: true,
    fields: {
      name,
      phone,
      eventDate,
      eventEndDate,
      eventTypeId,
      guestCount,
      districtId,
      venueType,
      venueText,
      budgetMin,
      budgetMax,
      budget: budgetText ?? budgetLabel(budgetMin, budgetMax),
      slot,
      foodPref,
      preferredContact: preferredContact ?? "whatsapp",
      contactEmail,
      message,
    },
  };
}

/**
 * Reads the requested units: `serviceIds: number[]` and/or
 * `units: [{serviceId, qty?}]` (qty > 0, up to 2 decimals). Null = invalid.
 */
export function parseUnitRequest(serviceIds: unknown, units: unknown): UnitRequest | null {
  const out: UnitRequest = new Map();
  const push = (n: unknown, qty: unknown = null): boolean => {
    if (!Number.isInteger(n) || (n as number) <= 0 || (n as number) > 2147483647) return false;
    let q: number | null = null;
    if (qty !== null && qty !== undefined && qty !== "") {
      const v = Number(qty);
      if (!Number.isFinite(v) || v <= 0 || v > 100000) return false;
      q = Math.round(v * 100) / 100;
    }
    out.set(n as number, q ?? out.get(n as number) ?? null);
    return true;
  };
  if (serviceIds !== undefined && serviceIds !== null) {
    if (!Array.isArray(serviceIds) || serviceIds.length > ENQUIRY_LIMITS.maxUnits || !serviceIds.every((n) => push(n))) {
      return null;
    }
  }
  if (units !== undefined && units !== null) {
    if (
      !Array.isArray(units) ||
      units.length > ENQUIRY_LIMITS.maxUnits ||
      !units.every((u) => u && typeof u === "object" && push((u as Record<string, unknown>).serviceId, (u as Record<string, unknown>).qty))
    ) {
      return null;
    }
  }
  return out.size > ENQUIRY_LIMITS.maxUnits ? null : out;
}

// ---------------------------------------------------------------------------
// Vendor and unit checks
// ---------------------------------------------------------------------------

/** A vendor that takes enquiries: approved and published. Null otherwise. */
export async function findEnquiryVendors(ids: number[]): Promise<Map<number, EnquiryVendor>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query<EnquiryVendor>(
    `SELECT id, name, owner_id FROM vendors
      WHERE id = ANY($1::int[]) AND status = 'approved' AND published IS NOT FALSE`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export type ResolvedUnits =
  | { ok: true; units: { serviceId: number; qty: number | null }[]; warnings: EnquiryWarning[] }
  | EnquiryError;

/**
 * Checks the units against the vendor's offerings (active, public, not a
 * package-only unit on its own) and returns min-quantity warnings (allowed,
 * just flagged). For per-plate / per-person units the guest count stands in
 * for a missing quantity.
 */
export async function resolveUnits(vendorId: number, req: UnitRequest, guestCount: number | null): Promise<ResolvedUnits> {
  if (req.size === 0) return { ok: true, units: [], warnings: [] };
  const resolved = await resolveEnquiryServices(vendorId, [...req.keys()]);
  if (!resolved.ok) {
    return resolved.code === "PACKAGE_ONLY"
      ? fail(400, "That service is only available as part of a package. Choose a package that includes it.", "PACKAGE_ONLY")
      : fail(400, "One or more selected services don't belong to this vendor.", "INVALID_SERVICE");
  }
  const units = resolved.serviceIds.map((serviceId) => ({ serviceId, qty: req.get(serviceId) ?? null }));
  const warnings: EnquiryWarning[] = [];
  const { rows } = await pool.query<{ id: number; title: string; min_qty: string | null; price_unit: string; unit_label: string | null }>(
    "SELECT id, title, min_qty, price_unit, unit_label FROM services WHERE vendor_id = $1 AND id = ANY($2::int[])",
    [vendorId, resolved.serviceIds]
  );
  for (const s of rows) {
    const min = s.min_qty == null ? null : Number(s.min_qty);
    if (!min || !Number.isFinite(min)) continue;
    const asked = req.get(s.id) ?? (PER_GUEST_UNITS.has(s.price_unit) ? guestCount : null);
    if (asked != null && asked < min) {
      const unit = s.unit_label || s.price_unit;
      warnings.push({
        code: "BELOW_MIN_QTY",
        serviceId: s.id,
        minQty: min,
        message: `${s.title}: the minimum is usually ${min.toLocaleString("en-IN")} ${unit}${min === 1 ? "" : "s"}. Your request was still sent; the vendor will confirm.`,
      });
    }
  }
  return { ok: true, units, warnings };
}

/** Soft availability check (owner decision 22): a blocked/booked date warns, never refuses. */
async function dateWarning(vendorId: number, eventDate: string | null, slot: string | null): Promise<EnquiryWarning | null> {
  if (!eventDate) return null;
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM vendor_availability
      WHERE vendor_id = $1 AND date = $2::date
        AND ($3::text IS NULL OR $3 = 'full' OR slot IN ('full', $3))
        AND (status IN ('blocked','booked') OR capacity_used >= capacity_total)`,
    [vendorId, eventDate, slot]
  );
  return rows[0].n > 0
    ? { code: "DATE_UNAVAILABLE", message: "The vendor has marked this date as busy. Your request was still sent; they may suggest options." }
    : null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Inserts one enquiry and its units on `client` (inside a transaction); the DB trigger notifies the vendor. */
async function insertEnquiry(
  client: PoolClient,
  p: {
    vendor: EnquiryVendor;
    fields: EnquiryFields;
    customerId: number | null;
    units: { serviceId: number; qty: number | null }[];
    batchId: string | null;
    source: "web" | "multi";
  }
): Promise<CreatedEnquiry> {
  const f = p.fields;
  const guestToken = p.customerId ? null : randomUUID();
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO quote_requests
       (vendor_id, customer_id, name, phone, event_date, event_end_date, budget, budget_min, budget_max, message,
        event_type_id, district_id, venue_type, venue_text, guest_count, slot, food_pref,
        preferred_contact, contact_email, source, guest_token, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id`,
    [
      p.vendor.id, p.customerId, f.name, f.phone, f.eventDate, f.eventEndDate, f.budget, f.budgetMin, f.budgetMax, f.message,
      f.eventTypeId, f.districtId, f.venueType, f.venueText, f.guestCount, f.slot, f.foodPref,
      f.preferredContact, f.contactEmail, p.source, guestToken, p.batchId,
    ]
  );
  const id = rows[0].id;
  if (p.units.length) await addLeadUnits(id, p.vendor.id, p.units, client);
  // The vendor's "lead.new" notification is written by the AFTER INSERT
  // trigger from migration 009 (same transaction), for every creation path.
  return {
    id,
    vendorId: p.vendor.id,
    status: "pending",
    guestToken,
    trackingPath: guestToken ? `/enquiry/${guestToken}` : `/my/enquiries/${id}`,
  };
}

// ---------------------------------------------------------------------------
// Duplicates (QA-040)
// ---------------------------------------------------------------------------

/** Enquiry statuses that are still open (the vendor may still act on them). */
export const OPEN_ENQUIRY_STATUSES = ["pending", "responded", "accepted", "booked"] as const;

export interface OpenEnquiry {
  id: number;
  vendorId: number;
  eventDate: string | null;
  status: string;
}

export const DUPLICATE_MESSAGE =
  "You've already sent this vendor an enquiry for this date. Open it to add details or message them instead.";

/**
 * A signed-in customer's open enquiries to these vendors for the same event
 * date (a missing date matches a missing date), newest first per vendor.
 * Guests are not matched: their enquiries are not tied to an account, and
 * answering "this phone already enquired" would leak another person's lead.
 */
export async function findOpenEnquiries(
  db: Pick<PoolClient, "query">,
  customerId: number,
  vendorIds: number[],
  eventDate: string | null
): Promise<Map<number, OpenEnquiry>> {
  const { rows } = await db.query<{ id: number; vendor_id: number; event_date: string | null; status: string }>(
    `SELECT DISTINCT ON (vendor_id) id, vendor_id, event_date::text AS event_date, status
       FROM quote_requests
      WHERE customer_id = $1 AND vendor_id = ANY($2::int[])
        AND event_date IS NOT DISTINCT FROM $3::date
        AND status = ANY($4::text[])
      ORDER BY vendor_id, created_at DESC, id DESC`,
    [customerId, vendorIds, eventDate, OPEN_ENQUIRY_STATUSES]
  );
  return new Map(rows.map((r) => [r.vendor_id, { id: r.id, vendorId: r.vendor_id, eventDate: r.event_date, status: r.status }]));
}

/**
 * The customer's latest open enquiry to one vendor (any date), for the
 * profile's "Enquiry sent · view" link and the quote sheet's notice.
 */
export async function findLatestOpenEnquiry(customerId: number, vendorId: number): Promise<OpenEnquiry | null> {
  const { rows } = await pool.query<{ id: number; event_date: string | null; status: string }>(
    `SELECT id, event_date::text AS event_date, status FROM quote_requests
      WHERE customer_id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [customerId, vendorId, OPEN_ENQUIRY_STATUSES]
  );
  const r = rows[0];
  return r ? { id: r.id, vendorId, eventDate: r.event_date, status: r.status } : null;
}

/** Serialises one customer's sends so two parallel taps can't both pass the duplicate check. */
async function lockCustomer(client: PoolClient, customerId: number) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('enquiry-customer:' || $1::text))", [customerId]);
}

/**
 * Single enquiry to one vendor (the vendor is already checked as public).
 * A signed-in customer's second open enquiry to the same vendor for the same
 * date is not created: { ok: false, duplicate } names the existing one.
 */
export async function createEnquiry(p: {
  vendor: EnquiryVendor;
  fields: EnquiryFields;
  customerId: number | null;
  units: { serviceId: number; qty: number | null }[];
}): Promise<
  | { ok: true; enquiry: CreatedEnquiry; warnings: EnquiryWarning[] }
  | { ok: false; duplicate: OpenEnquiry }
> {
  const out = await withTransaction(async (client): Promise<{ duplicate: OpenEnquiry } | { enquiry: CreatedEnquiry }> => {
    if (p.customerId != null) {
      await lockCustomer(client, p.customerId);
      const dup = (await findOpenEnquiries(client, p.customerId, [p.vendor.id], p.fields.eventDate)).get(p.vendor.id);
      if (dup) return { duplicate: dup };
    }
    return { enquiry: await insertEnquiry(client, { ...p, batchId: null, source: "web" }) };
  });
  if ("duplicate" in out) return { ok: false, duplicate: out.duplicate };
  const w = await dateWarning(p.vendor.id, p.fields.eventDate, p.fields.slot);
  return { ok: true, enquiry: out.enquiry, warnings: w ? [w] : [] };
}

export type MultiResult =
  | { vendorId: number; ok: true; enquiryId: number; trackingPath: string; guestToken: string | null; warnings: EnquiryWarning[] }
  | { vendorId: number; ok: false; code: string; error: string; enquiryId?: number };

/**
 * Fan-out to several vendors with one batch_id (P2-9). Vendors that don't
 * take enquiries (not approved, unpublished, gone, the sender's own listing)
 * or whose units are invalid are reported per vendor and skipped. The daily
 * cap counts every enquiry from this phone in the last 24 hours; it is
 * checked under a per-phone advisory lock so parallel sends can't overshoot.
 */
export async function createMultiEnquiry(p: {
  vendorIds: number[];
  fields: EnquiryFields;
  customerId: number | null;
  unitsByVendor: Map<number, UnitRequest>;
}): Promise<
  | { ok: true; batchId: string; results: MultiResult[] }
  | EnquiryError
> {
  const vendors = await findEnquiryVendors(p.vendorIds);
  const results: MultiResult[] = [];
  const toCreate: { vendor: EnquiryVendor; units: { serviceId: number; qty: number | null }[]; warnings: EnquiryWarning[] }[] = [];

  for (const vendorId of p.vendorIds) {
    const vendor = vendors.get(vendorId);
    if (!vendor) {
      results.push({ vendorId, ok: false, code: "VENDOR_UNAVAILABLE", error: "This vendor isn't taking enquiries right now." });
      continue;
    }
    if (p.customerId != null && vendor.owner_id === p.customerId) {
      results.push({ vendorId, ok: false, code: "OWN_LISTING", error: "You can't send an enquiry to your own listing." });
      continue;
    }
    const req = p.unitsByVendor.get(vendorId) ?? new Map();
    const resolved = await resolveUnits(vendorId, req, p.fields.guestCount);
    if (!resolved.ok) {
      results.push({ vendorId, ok: false, code: resolved.code, error: resolved.error });
      continue;
    }
    toCreate.push({ vendor, units: resolved.units, warnings: resolved.warnings });
  }

  if (!toCreate.length) {
    return {
      ok: false,
      status: 409,
      code: "NO_VENDORS_AVAILABLE",
      error: "None of the selected vendors can take an enquiry right now.",
      results,
    };
  }

  const batchId = randomUUID();
  const created = await withTransaction(async (client) => {
    // QA-040: skip vendors this customer already has an open enquiry with
    // for the same date (reported per vendor with the existing enquiry id).
    const duplicates: MultiResult[] = [];
    if (p.customerId != null) {
      await lockCustomer(client, p.customerId);
      const open = await findOpenEnquiries(client, p.customerId, toCreate.map((c) => c.vendor.id), p.fields.eventDate);
      for (let i = toCreate.length - 1; i >= 0; i--) {
        const dup = open.get(toCreate[i].vendor.id);
        if (!dup) continue;
        duplicates.push({ vendorId: dup.vendorId, ok: false, code: "ALREADY_ENQUIRED", error: DUPLICATE_MESSAGE, enquiryId: dup.id });
        toCreate.splice(i, 1);
      }
    }
    if (!toCreate.length) return { capped: false as const, out: [] as CreatedEnquiry[], duplicates };
    await client.query("SELECT pg_advisory_xact_lock(hashtext('enquiry-phone:' || $1))", [p.fields.phone]);
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM quote_requests WHERE phone = $1 AND created_at > now() - interval '24 hours'",
      [p.fields.phone]
    );
    const remaining = Math.max(0, ENQUIRY_LIMITS.maxPerPhonePerDay - rows[0].n);
    if (toCreate.length > remaining) return { capped: true as const, remaining };
    const out: CreatedEnquiry[] = [];
    for (const c of toCreate) {
      out.push(
        await insertEnquiry(client, {
          vendor: c.vendor,
          fields: p.fields,
          customerId: p.customerId,
          units: c.units,
          batchId,
          source: "multi",
        })
      );
    }
    return { capped: false as const, out, duplicates };
  });

  if (created.capped) {
    return {
      ok: false,
      status: 429,
      code: "DAILY_LIMIT",
      error:
        created.remaining > 0
          ? `You can send ${created.remaining} more ${created.remaining === 1 ? "enquiry" : "enquiries"} today from this number. Select fewer vendors or try again tomorrow.`
          : `You've reached today's limit of ${ENQUIRY_LIMITS.maxPerPhonePerDay} enquiries from this number. Please try again tomorrow.`,
      remaining: created.remaining,
    };
  }

  results.push(...created.duplicates);
  if (!toCreate.length) {
    const allDuplicates = results.every((r) => !r.ok && r.code === "ALREADY_ENQUIRED");
    return {
      ok: false,
      status: 409,
      code: allDuplicates ? "ALREADY_ENQUIRED" : "NO_VENDORS_AVAILABLE",
      error: allDuplicates
        ? "You've already sent these vendors an enquiry for this date. Follow up from My enquiries."
        : "None of the selected vendors can take an enquiry right now.",
      results: sortResults(results, p.vendorIds),
    };
  }

  for (const [i, c] of toCreate.entries()) {
    const e = created.out[i];
    const w = await dateWarning(c.vendor.id, p.fields.eventDate, p.fields.slot);
    results.push({
      vendorId: c.vendor.id,
      ok: true,
      enquiryId: e.id,
      trackingPath: e.trackingPath,
      guestToken: e.guestToken,
      warnings: w ? [...c.warnings, w] : c.warnings,
    });
  }
  return { ok: true, batchId, results: sortResults(results, p.vendorIds) };
}

/** Report in the order the vendors were sent. */
function sortResults(results: MultiResult[], vendorIds: number[]): MultiResult[] {
  const order = new Map(vendorIds.map((id, i) => [id, i]));
  return results.sort((a, b) => (order.get(a.vendorId) ?? 0) - (order.get(b.vendorId) ?? 0));
}
