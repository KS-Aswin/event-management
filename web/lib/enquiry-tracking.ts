// Guest enquiry tracking (P2-3): the read-only view behind /enquiry/[token]
// and GET /api/enquiries/track/[token], plus linking a guest enquiry to an
// account on signup / login when the guest brings its private token.
//
// The token is the only key: nothing here is reachable by id. Vendor-private
// fields (vendor_notes, follow_up_at) are never selected.

import { pool } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuestToken(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw);
}

export interface TrackedOfferLine {
  label: string;
  qty: number;
  unit: string;
  unitPricePaise: number;
  amountPaise: number;
}

export interface TrackedOffer {
  id: number;
  version: number;
  status: string;
  subtotalPaise: number;
  travelPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  advancePct: number | null;
  validUntil: string | null;
  terms: string;
  createdAt: string;
  lines: TrackedOfferLine[];
}

export interface TrackedEnquiry {
  id: number;
  status: string;
  createdAt: string;
  name: string;
  eventDate: string | null;
  eventEndDate: string | null;
  eventType: string | null;
  district: string | null;
  venueType: string | null;
  venueText: string | null;
  guestCount: number | null;
  slot: string | null;
  foodPref: string | null;
  budget: string | null;
  preferredContact: string;
  message: string | null;
  linkedToAccount: boolean;
  vendor: {
    id: number;
    name: string;
    category: string;
    location: string;
    /** False when the listing is suspended / unpublished: show "vendor unavailable". */
    available: boolean;
  };
  units: { title: string; qty: number | null; priceUnit: string | null; unitLabel: string | null }[];
  offers: TrackedOffer[];
  messages: { id: number; from: "you" | "vendor" | "vela"; body: string; createdAt: string }[];
}

const iso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

/** The enquiry for a guest token, or null (malformed or unknown token). */
export async function findEnquiryByToken(token: string): Promise<TrackedEnquiry | null> {
  if (!isGuestToken(token)) return null;
  const { rows } = await pool.query(
    `SELECT q.id, q.status, q.created_at, q.name, to_char(q.event_date, 'YYYY-MM-DD') AS event_date,
            to_char(q.event_end_date, 'YYYY-MM-DD') AS event_end_date, et.name AS event_type, d.name AS district,
            q.venue_type, q.venue_text, q.guest_count, q.slot, q.food_pref, q.budget, q.preferred_contact,
            q.message, q.customer_id IS NOT NULL AS linked,
            v.id AS vendor_id, v.name AS vendor_name, v.category AS vendor_category, v.location AS vendor_location,
            (v.status = 'approved' AND v.published) AS vendor_available
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       LEFT JOIN event_types et ON et.id = q.event_type_id
       LEFT JOIN districts d ON d.id = q.district_id
      WHERE q.guest_token = $1::uuid`,
    [token.toLowerCase()]
  );
  const q = rows[0];
  if (!q) return null;

  const [units, offers, lines, messages] = await Promise.all([
    pool.query(
      `SELECT COALESCE(s.title, qs.snapshot->>'title', 'Service') AS title, qs.qty::float AS qty,
              qs.snapshot->>'price_unit' AS price_unit, qs.snapshot->>'unit_label' AS unit_label
         FROM quote_request_services qs LEFT JOIN services s ON s.id = qs.service_id
        WHERE qs.quote_request_id = $1 ORDER BY qs.service_id`,
      [q.id]
    ),
    pool.query(
      `SELECT id, version, status, subtotal_paise, travel_paise, discount_paise, gst_paise, total_paise,
              advance_pct, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, terms, created_at
         FROM quote_offers WHERE quote_request_id = $1 ORDER BY version DESC`,
      [q.id]
    ),
    pool.query(
      `SELECT l.offer_id, l.label, l.qty::float AS qty, l.unit, l.unit_price_paise, l.amount_paise
         FROM quote_offer_lines l JOIN quote_offers o ON o.id = l.offer_id
        WHERE o.quote_request_id = $1 ORDER BY l.offer_id, l.sort_order, l.id`,
      [q.id]
    ),
    pool.query(
      `SELECT id, sender_role, body, created_at FROM quote_messages
        WHERE quote_request_id = $1 ORDER BY created_at, id LIMIT 200`,
      [q.id]
    ),
  ]);

  return {
    id: q.id,
    status: q.status,
    createdAt: iso(q.created_at)!,
    name: q.name,
    eventDate: q.event_date,
    eventEndDate: q.event_end_date,
    eventType: q.event_type,
    district: q.district,
    venueType: q.venue_type,
    venueText: q.venue_text,
    guestCount: q.guest_count,
    slot: q.slot,
    foodPref: q.food_pref,
    budget: q.budget,
    preferredContact: q.preferred_contact,
    message: q.message,
    linkedToAccount: q.linked,
    vendor: {
      id: q.vendor_id,
      name: q.vendor_name,
      category: q.vendor_category,
      location: q.vendor_location,
      available: q.vendor_available === true,
    },
    units: units.rows.map((u) => ({ title: u.title, qty: u.qty, priceUnit: u.price_unit, unitLabel: u.unit_label })),
    offers: offers.rows.map((o) => ({
      id: o.id,
      version: o.version,
      status: o.status,
      subtotalPaise: Number(o.subtotal_paise),
      travelPaise: Number(o.travel_paise),
      discountPaise: Number(o.discount_paise),
      gstPaise: Number(o.gst_paise),
      totalPaise: Number(o.total_paise),
      advancePct: o.advance_pct,
      validUntil: o.valid_until,
      terms: o.terms,
      createdAt: iso(o.created_at)!,
      lines: lines.rows
        .filter((l) => l.offer_id === o.id)
        .map((l) => ({
          label: l.label,
          qty: l.qty,
          unit: l.unit,
          unitPricePaise: Number(l.unit_price_paise),
          amountPaise: Number(l.amount_paise),
        })),
    })),
    messages: messages.rows.map((m) => ({
      id: m.id,
      from: m.sender_role === "customer" ? "you" : m.sender_role === "vendor" ? "vendor" : "vela",
      body: m.body,
      createdAt: iso(m.created_at)!,
    })),
  };
}

/**
 * Links ONE guest enquiry to a customer account by its private tracking
 * token (P2-3, QA-003). The token is the guest's proof of ownership: it is
 * only given to whoever sent the enquiry (the enquiry response and the
 * /enquiry/<token> link). A matching contact email is NOT enough, because
 * nobody has verified that the account holder owns that email.
 * Only customer accounts, only enquiries not yet in an account. Returns the
 * linked enquiry id, or null. Never throws: signing in must not fail
 * because of this.
 */
export async function linkGuestEnquiryByToken(
  user: { id: number; role: string },
  token: unknown
): Promise<number | null> {
  if (user.role !== "customer" || !isGuestToken(token)) return null;
  try {
    const r = await pool.query<{ id: number }>(
      `UPDATE quote_requests SET customer_id = $1
        WHERE guest_token = $2::uuid AND customer_id IS NULL
        RETURNING id`,
      [user.id, token.toLowerCase()]
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    console.error("linkGuestEnquiryByToken failed", err);
    return null;
  }
}

/** The guest token in an `/enquiry/<token>` path (e.g. a ?next= value), or null. */
export function guestTokenFromPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const m = /^\/enquiry\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  return m && isGuestToken(m[1]) ? m[1] : null;
}
