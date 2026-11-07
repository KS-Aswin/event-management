// Customer shortlist (PRODUCT_PLAN P2-9): the favorites table plus a private
// note per vendor (migration 011). Every function is scoped to one customer
// id; callers pass the session user, never an id from the request.

import { pool } from "@/lib/db";
import { vendorFromPrice } from "@/lib/vendor-display";

export const SHORTLIST_LIMITS = {
  /** Most vendors one customer can keep. */
  maxItems: 200,
  /** Longest note (also a DB CHECK). */
  note: 500,
  /** Most ids one guest-merge call may carry. */
  mergeBatch: 50,
} as const;

/** A vendor customers may see: approved and published. */
const PUBLIC_VENDOR = "v.status = 'approved' AND v.published";

export interface ShortlistItem {
  vendorId: number;
  name: string;
  category: string;
  categoryId: number | null;
  location: string;
  rating: number;
  reviewsCount: number;
  verified: boolean;
  /** Still approved and published; unavailable rows can only be removed. */
  available: boolean;
  /**
   * The vendor's one "from" price (vendors.price / price_label, QA-023/QA-036):
   * the same figure search, /e and the profile show. Null = price on request.
   */
  fromPrice: number | null;
  priceLabel: string | null;
  note: string | null;
  savedAt: string;
  // For the card image (app/search/card-media.ts).
  coverMediaId: number | null;
  coverImageUrl: string | null;
}

interface Row {
  vendor_id: number;
  name: string;
  category: string;
  category_id: number | null;
  location: string;
  rating: string;
  reviews_count: number;
  verified: boolean;
  available: boolean;
  price: string | number | null;
  price_label: string | null;
  note: string | null;
  saved_at: Date;
  cover_media_id: number | null;
  cover_image_url: string | null;
}

export async function listShortlist(customerId: number): Promise<ShortlistItem[]> {
  const r = await pool.query<Row>(
    `SELECT v.id AS vendor_id, v.name, v.category, COALESCE(v.primary_category_id, c.id) AS category_id, v.location,
            v.rating, v.reviews_count, (v.verified_at IS NOT NULL) AS verified,
            (${PUBLIC_VENDOR}) AS available,
            v.price, v.price_label,
            f.note, f.created_at AS saved_at, v.cover_media_id, v.cover_image_url
       FROM favorites f
       JOIN vendors v ON v.id = f.vendor_id
       LEFT JOIN categories c ON c.name = v.category
      WHERE f.customer_id = $1
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${SHORTLIST_LIMITS.maxItems}`,
    [customerId]
  );
  return r.rows.map((x) => {
    const priceLabel = vendorFromPrice(x);
    return {
      vendorId: x.vendor_id,
      name: x.name,
      category: x.category,
      categoryId: x.category_id,
      location: x.location,
      rating: Number(x.rating) || 0,
      reviewsCount: x.reviews_count ?? 0,
      verified: x.verified,
      available: x.available,
      fromPrice: priceLabel ? Number(x.price) : null,
      priceLabel,
      note: x.note,
      savedAt: x.saved_at.toISOString(),
      coverMediaId: x.cover_media_id,
      coverImageUrl: x.cover_image_url,
    };
  });
}

export async function shortlistCount(customerId: number): Promise<number> {
  const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM favorites WHERE customer_id = $1", [customerId]);
  return r.rows[0]?.n ?? 0;
}

export type ShortlistResult =
  | { ok: true; added: boolean }
  | { ok: false; status: 404 | 409; code: "NOT_FOUND" | "SHORTLIST_FULL"; error: string };

/**
 * Adds a public vendor (idempotent). A note, when given, replaces the stored
 * one. 404 for an unknown, unpublished or unapproved vendor; 409 when the
 * shortlist is full.
 */
export async function addToShortlist(customerId: number, vendorId: number, note?: string | null): Promise<ShortlistResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise adds per customer so the cap can't be overshot by parallel calls.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shortlist'), $1)", [customerId]);
    const v = await client.query(`SELECT 1 FROM vendors v WHERE v.id = $1 AND ${PUBLIC_VENDOR}`, [vendorId]);
    if (!v.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, code: "NOT_FOUND", error: "Vendor not found." };
    }
    const exists = await client.query("SELECT 1 FROM favorites WHERE customer_id = $1 AND vendor_id = $2", [customerId, vendorId]);
    if (!exists.rowCount) {
      const n = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM favorites WHERE customer_id = $1", [customerId]);
      if ((n.rows[0]?.n ?? 0) >= SHORTLIST_LIMITS.maxItems) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          code: "SHORTLIST_FULL",
          error: `Your shortlist is full (${SHORTLIST_LIMITS.maxItems} vendors). Remove some to add more.`,
        };
      }
      await client.query(
        "INSERT INTO favorites (customer_id, vendor_id) VALUES ($1, $2) ON CONFLICT (customer_id, vendor_id) DO NOTHING",
        [customerId, vendorId]
      );
    }
    if (note !== undefined) {
      await client.query(
        "UPDATE favorites SET note = $3, note_updated_at = now() WHERE customer_id = $1 AND vendor_id = $2",
        [customerId, vendorId, note]
      );
    }
    await client.query("COMMIT");
    return { ok: true, added: !exists.rowCount };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Guest shortlist merge after login: adds every public vendor id not already
 * saved, up to the cap. Unknown or hidden ids are skipped silently (a guest's
 * list can hold vendors that went offline since). Returns how many were added.
 */
export async function mergeShortlist(customerId: number, vendorIds: number[]): Promise<{ added: number; skipped: number }> {
  if (vendorIds.length === 0) return { added: 0, skipped: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shortlist'), $1)", [customerId]);
    const n = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM favorites WHERE customer_id = $1", [customerId]);
    const room = Math.max(0, SHORTLIST_LIMITS.maxItems - (n.rows[0]?.n ?? 0));
    const r = await client.query(
      `INSERT INTO favorites (customer_id, vendor_id)
       SELECT $1, v.id FROM vendors v
        WHERE v.id = ANY($2::int[]) AND ${PUBLIC_VENDOR}
          AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.customer_id = $1 AND f.vendor_id = v.id)
        ORDER BY array_position($2::int[], v.id)
        LIMIT $3
       ON CONFLICT (customer_id, vendor_id) DO NOTHING`,
      [customerId, vendorIds, room]
    );
    await client.query("COMMIT");
    const added = r.rowCount ?? 0;
    return { added, skipped: vendorIds.length - added };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Sets or clears the note on a saved vendor. False when it isn't on the shortlist. */
export async function setShortlistNote(customerId: number, vendorId: number, note: string | null): Promise<boolean> {
  const r = await pool.query(
    "UPDATE favorites SET note = $3, note_updated_at = now() WHERE customer_id = $1 AND vendor_id = $2",
    [customerId, vendorId, note]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Removes a vendor (idempotent). True when a row was deleted. */
export async function removeFromShortlist(customerId: number, vendorId: number): Promise<boolean> {
  const r = await pool.query("DELETE FROM favorites WHERE customer_id = $1 AND vendor_id = $2", [customerId, vendorId]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Note from a request body: undefined = not sent, null = clear, string =
 * trimmed text; `false` = invalid (not a string or too long).
 */
export function parseNote(raw: unknown): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return false;
  // Strip control characters except newlines and tabs.
  const t = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (t.length > SHORTLIST_LIMITS.note) return false;
  return t === "" ? null : t;
}

/** A positive int4 id, or null. */
export function parseVendorId(raw: unknown): number | null {
  const n = typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(n) && (n as number) > 0 && (n as number) <= 2147483647 ? (n as number) : null;
}

// ---------------------------------------------------------------------------
// Enquiry defaults for the multi-vendor send (QA-029)
// ---------------------------------------------------------------------------

export interface EnquiryDefaults {
  name: string;
  phone: string;
  preferredContact: "whatsapp" | "call" | "email";
  /** Details of the customer's next upcoming event (same rule as /my "Next event"), or nulls. */
  eventDate: string | null;
  eventTypeId: number | null;
  districtId: number | null;
  guestCount: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  /** Occasion name the event details came from (for the "Filled in from…" hint), or null. */
  source: string | null;
}

const LIVE_ENQUIRY = "q.status IN ('pending','responded','accepted','booked')";
const CONTACTS = new Set(["whatsapp", "call", "email"]);

/**
 * What the "Send enquiry to N" sheet starts with, so a customer who has
 * already told vendors about their event doesn't type it all again:
 * contact details from the account (else their latest enquiry), and event
 * details from their next upcoming live enquiry. A past event is never
 * reused (it is a different occasion).
 */
export async function findEnquiryDefaults(
  customerId: number,
  account: { name: string; phone?: string | null }
): Promise<EnquiryDefaults> {
  const [latest, next] = await Promise.all([
    pool.query<{ name: string | null; phone: string | null; preferred_contact: string | null }>(
      `SELECT q.name, q.phone, q.preferred_contact
         FROM quote_requests q
        WHERE q.customer_id = $1
        ORDER BY q.created_at DESC, q.id DESC
        LIMIT 1`,
      [customerId]
    ),
    pool.query<{
      event_date: string;
      event_type_id: number | null;
      district_id: number | null;
      guest_count: number | null;
      budget_min: number | null;
      budget_max: number | null;
      type_name: string | null;
    }>(
      `SELECT q.event_date::text AS event_date, q.event_type_id, q.district_id, q.guest_count,
              q.budget_min, q.budget_max, et.name AS type_name
         FROM quote_requests q
         LEFT JOIN event_types et ON et.id = q.event_type_id AND et.active
        WHERE q.customer_id = $1 AND ${LIVE_ENQUIRY}
          AND q.event_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY q.event_date, (q.event_type_id IS NULL), q.created_at DESC
        LIMIT 1`,
      [customerId]
    ),
  ]);
  const l = latest.rows[0];
  const n = next.rows[0];
  const contact = l?.preferred_contact && CONTACTS.has(l.preferred_contact) ? l.preferred_contact : "whatsapp";
  return {
    name: account.name || l?.name?.trim() || "",
    phone: account.phone?.trim() || l?.phone?.trim() || "",
    preferredContact: contact as EnquiryDefaults["preferredContact"],
    eventDate: n?.event_date ?? null,
    // Only an occasion the customer can still pick (a retired type is dropped).
    eventTypeId: n && n.type_name ? n.event_type_id : null,
    districtId: n?.district_id ?? null,
    guestCount: n?.guest_count ?? null,
    budgetMin: n?.budget_min ?? null,
    budgetMax: n?.budget_max ?? null,
    source: n?.type_name ?? null,
  };
}
