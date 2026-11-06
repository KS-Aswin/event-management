// Customer shortlist (PRODUCT_PLAN P2-9): the favorites table plus a private
// note per vendor (migration 011). Every function is scoped to one customer
// id; callers pass the session user, never an id from the request.

import { pool } from "@/lib/db";

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

/** A unit or package a customer can book on its own (same rule as lib/search.ts). */
const SELLABLE = `s.active AND s.kind IN ('unit','package') AND s.sale_mode = 'separate'
  AND s.hidden_reason IS NULL AND NOT s.incomplete`;

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
  fromPrice: number | null;
  fromUnit: string | null;
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
  from_price: number | null;
  from_unit: string | null;
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
            p.price_from AS from_price, COALESCE(p.unit_label, p.price_unit) AS from_unit,
            f.note, f.created_at AS saved_at, v.cover_media_id, v.cover_image_url
       FROM favorites f
       JOIN vendors v ON v.id = f.vendor_id
       LEFT JOIN categories c ON c.name = v.category
       LEFT JOIN LATERAL (
         SELECT s.price_from, s.price_unit, s.unit_label FROM services s
          WHERE s.vendor_id = v.id AND ${SELLABLE} AND s.price_mode <> 'on_request' AND s.price_from > 0
          ORDER BY s.price_from, s.id LIMIT 1
       ) p ON true
      WHERE f.customer_id = $1
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${SHORTLIST_LIMITS.maxItems}`,
    [customerId]
  );
  return r.rows.map((x) => ({
    vendorId: x.vendor_id,
    name: x.name,
    category: x.category,
    categoryId: x.category_id,
    location: x.location,
    rating: Number(x.rating) || 0,
    reviewsCount: x.reviews_count ?? 0,
    verified: x.verified,
    available: x.available,
    fromPrice: x.from_price,
    fromUnit: x.from_unit,
    note: x.note,
    savedAt: x.saved_at.toISOString(),
    coverMediaId: x.cover_media_id,
    coverImageUrl: x.cover_image_url,
  }));
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
