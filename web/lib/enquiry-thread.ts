// Enquiry thread: messages, itemised offers, customer actions and the lazy
// expiry sweep (PRODUCT_PLAN P2-4, P2-5, P2-13).
//
// Who may touch what is decided here, never by the client:
//   - a vendor only reaches enquiries sent to their own listing (vendor_id),
//   - a customer only their own (customer_id = session user), and a guest
//     only through the exact guest_token of that enquiry.
// Status changes go through lib/enquiry-status.ts (invalid -> 409) and write
// quote_status_events; notifications are written in the same transaction.

import type { PoolClient } from "pg";
import { pool, updateVendorLead } from "@/lib/db";
import { withTransaction } from "@/lib/admin/tx";
import {
  assertTransition,
  billingEnabled,
  canMessage,
  canSendOffer,
  maskMessageContacts,
  TransitionError,
  type EnquiryStatus,
} from "@/lib/enquiry-status";
import { customerLink, loadParties, notifyOnce, notifyStatusChange, preview, vendorLink } from "@/lib/enquiry-notify";
import { notify } from "@/lib/admin/notify";
import { formatOfferDate, formatPaise, type OfferInput } from "@/lib/offer-math";

type Client = Pick<PoolClient, "query">;

/** A request-level failure with an HTTP status (400/404/409) to answer with. */
export class ThreadError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ThreadError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** Customer side of an enquiry: a signed-in user, or a guest with its token. */
export type CustomerScope = { userId: number } | { guestToken: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeSql(scope: CustomerScope, param: number): { sql: string; value: unknown } {
  if ("userId" in scope) return { sql: `q.customer_id = $${param}`, value: scope.userId };
  // A malformed token can't match any row (the column is a UUID).
  return { sql: `q.guest_token = $${param}::uuid`, value: UUID_RE.test(scope.guestToken) ? scope.guestToken : "00000000-0000-0000-0000-000000000000" };
}

const TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

// ---------------------------------------------------------------------------
// Expiry (lazy): open enquiries whose event date has passed, and offers past
// their validity date. Run before reading a list or a thread.
// ---------------------------------------------------------------------------

export async function sweepExpired(
  scope: { vendorId: number } | { customerId: number } | { quoteId: number },
  client: Client = pool
): Promise<void> {
  const [col, value] =
    "vendorId" in scope ? ["vendor_id", scope.vendorId] : "customerId" in scope ? ["customer_id", scope.customerId] : ["id", scope.quoteId];
  await client.query(
    `WITH cand AS (
       SELECT id, status FROM quote_requests
        WHERE ${col} = $1 AND status IN ('pending', 'responded') AND event_date < ${TODAY}
        FOR UPDATE
     ), gone AS (
       UPDATE quote_requests q SET status = 'expired', status_updated_at = now()
         FROM cand WHERE q.id = cand.id
        RETURNING q.id, cand.status AS prev
     )
     INSERT INTO quote_status_events (quote_id, from_status, to_status, changed_by)
     SELECT gone.id, gone.prev, 'expired', NULL FROM gone`,
    [value]
  );
  await client.query(
    `UPDATE quote_offers o SET status = 'expired'
       FROM quote_requests q
      WHERE o.quote_request_id = q.id AND q.${col} = $1 AND o.status = 'sent' AND o.valid_until < ${TODAY}`,
    [value]
  );
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface OfferLine {
  id: number;
  serviceId: number | null;
  label: string;
  qty: number;
  unit: string;
  unitPricePaise: number;
  amountPaise: number;
}

export interface Offer {
  id: number;
  version: number;
  status: "sent" | "accepted" | "declined" | "superseded" | "expired";
  subtotalPaise: number;
  travelPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  advancePct: number | null;
  validUntil: string | null;
  terms: string;
  createdAt: string;
  respondedAt: string | null;
  lines: OfferLine[];
}

export interface ThreadMessage {
  id: number;
  senderRole: "customer" | "vendor" | "admin" | "system";
  body: string;
  /** Contact details were hidden (billing on). */
  masked: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface StatusEvent {
  from: string;
  to: string;
  actor: "vendor" | "customer" | "system";
  at: string;
}

export interface Thread {
  messages: ThreadMessage[];
  offers: Offer[];
  events: StatusEvent[];
}

const iso = (d: Date | string | null) => (d === null ? null : d instanceof Date ? d.toISOString() : String(d));

async function loadThread(quoteId: number, client: Client = pool): Promise<Thread> {
  const mask = billingEnabled();
  const [msgs, offers, events] = await Promise.all([
    client.query<{ id: number; sender_role: ThreadMessage["senderRole"]; body: string; read_at: Date | null; created_at: Date }>(
      `SELECT id, sender_role, body, read_at, created_at FROM quote_messages
        WHERE quote_request_id = $1 ORDER BY created_at, id LIMIT 500`,
      [quoteId]
    ),
    client.query<{
      id: number;
      version: number;
      status: Offer["status"];
      subtotal_paise: string;
      travel_paise: string;
      discount_paise: string;
      gst_paise: string;
      total_paise: string;
      advance_pct: number | null;
      valid_until: string | null;
      terms: string;
      created_at: Date;
      responded_at: Date | null;
      lines: { id: number; service_id: number | null; label: string; qty: string; unit: string; unit_price_paise: string; amount_paise: string }[];
    }>(
      `SELECT o.id, o.version, o.status, o.subtotal_paise, o.travel_paise, o.discount_paise, o.gst_paise, o.total_paise,
              o.advance_pct, o.valid_until::text AS valid_until, o.terms, o.created_at, o.responded_at,
              COALESCE((SELECT json_agg(json_build_object('id', l.id, 'service_id', l.service_id, 'label', l.label, 'qty', l.qty,
                                                          'unit', l.unit, 'unit_price_paise', l.unit_price_paise, 'amount_paise', l.amount_paise)
                                        ORDER BY l.sort_order, l.id)
                          FROM quote_offer_lines l WHERE l.offer_id = o.id), '[]'::json) AS lines
         FROM quote_offers o WHERE o.quote_request_id = $1 ORDER BY o.version DESC`,
      [quoteId]
    ),
    client.query<{ from_status: string; to_status: string; actor: StatusEvent["actor"]; created_at: Date }>(
      `SELECT e.from_status, e.to_status, e.created_at,
              CASE WHEN e.changed_by IS NOT NULL AND e.changed_by = q.customer_id THEN 'customer'
                   WHEN e.changed_by IS NOT NULL THEN 'vendor'
                   WHEN e.to_status IN ('withdrawn', 'accepted') THEN 'customer'
                   ELSE 'system' END AS actor
         FROM quote_status_events e JOIN quote_requests q ON q.id = e.quote_id
        WHERE e.quote_id = $1 ORDER BY e.created_at, e.id`,
      [quoteId]
    ),
  ]);
  return {
    messages: msgs.rows.map((m) => {
      const r = maskMessageContacts(m.body, mask);
      return { id: m.id, senderRole: m.sender_role, body: r.text, masked: r.masked, readAt: iso(m.read_at), createdAt: iso(m.created_at)! };
    }),
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
      terms: maskMessageContacts(o.terms, mask).text,
      createdAt: iso(o.created_at)!,
      respondedAt: iso(o.responded_at),
      lines: o.lines.map((l) => ({
        id: l.id,
        serviceId: l.service_id,
        label: l.label,
        qty: Number(l.qty),
        unit: l.unit,
        unitPricePaise: Number(l.unit_price_paise),
        amountPaise: Number(l.amount_paise),
      })),
    })),
    events: events.rows.map((e) => ({ from: e.from_status, to: e.to_status, actor: e.actor, at: iso(e.created_at)! })),
  };
}

/** Marks the other side's messages and this user's notifications for the enquiry read. */
export async function markThreadRead(quoteId: number, reader: "customer" | "vendor", userId: number | null): Promise<void> {
  await pool.query(
    `UPDATE quote_messages SET read_at = now()
      WHERE quote_request_id = $1 AND read_at IS NULL AND sender_role <> $2`,
    [quoteId, reader]
  );
  if (userId !== null) {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND payload->>'quoteId' = $2`,
      [userId, String(quoteId)]
    );
  }
}

// ---- customer side --------------------------------------------------------

export interface CustomerEnquirySummary {
  id: number;
  status: EnquiryStatus;
  eventDate: string | null;
  eventTypeName: string | null;
  districtName: string | null;
  guestCount: number | null;
  createdAt: string;
  lastActivityAt: string;
  vendor: { id: number; name: string; category: string; logoUrl: string | null; available: boolean };
  units: string[];
  latestOffer: { id: number; version: number; status: Offer["status"]; totalPaise: number; validUntil: string | null } | null;
  unread: number;
}

export async function listCustomerEnquiries(userId: number): Promise<CustomerEnquirySummary[]> {
  await sweepExpired({ customerId: userId });
  const r = await pool.query<{
    id: number;
    status: EnquiryStatus;
    event_date: string | null;
    event_type_name: string | null;
    district_name: string | null;
    guest_count: number | null;
    created_at: Date;
    last_activity_at: Date;
    vendor_id: number;
    vendor_name: string;
    vendor_category: string;
    logo_url: string | null;
    vendor_status: string;
    units: string[];
    latest_offer: { id: number; version: number; status: Offer["status"]; total_paise: number; valid_until: string | null } | null;
    unread: number;
  }>(
    `SELECT q.id, q.status, q.event_date::text AS event_date, et.name AS event_type_name, d.name AS district_name, q.guest_count,
            q.created_at,
            GREATEST(q.created_at, COALESCE(q.status_updated_at, q.created_at),
                     COALESCE((SELECT max(m.created_at) FROM quote_messages m WHERE m.quote_request_id = q.id), q.created_at),
                     COALESCE((SELECT max(o.created_at) FROM quote_offers o WHERE o.quote_request_id = q.id), q.created_at)) AS last_activity_at,
            v.id AS vendor_id, v.name AS vendor_name, v.category AS vendor_category, v.logo_url, v.status AS vendor_status,
            COALESCE((SELECT array_agg(COALESCE(qs.snapshot->>'title', s.title) ORDER BY COALESCE(qs.snapshot->>'title', s.title))
                        FROM quote_request_services qs JOIN services s ON s.id = qs.service_id
                       WHERE qs.quote_request_id = q.id), '{}') AS units,
            (SELECT json_build_object('id', o.id, 'version', o.version, 'status', o.status, 'total_paise', o.total_paise,
                                      'valid_until', o.valid_until)
               FROM quote_offers o WHERE o.quote_request_id = q.id ORDER BY o.version DESC LIMIT 1) AS latest_offer,
            (SELECT count(*)::int FROM quote_messages m
              WHERE m.quote_request_id = q.id AND m.read_at IS NULL AND m.sender_role <> 'customer') AS unread
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       LEFT JOIN event_types et ON et.id = q.event_type_id
       LEFT JOIN districts d ON d.id = q.district_id
      WHERE q.customer_id = $1
      ORDER BY q.event_date NULLS LAST, q.created_at DESC
      LIMIT 300`,
    [userId]
  );
  return r.rows.map((x) => ({
    id: x.id,
    status: x.status,
    eventDate: x.event_date,
    eventTypeName: x.event_type_name,
    districtName: x.district_name,
    guestCount: x.guest_count,
    createdAt: iso(x.created_at)!,
    lastActivityAt: iso(x.last_activity_at)!,
    vendor: { id: x.vendor_id, name: x.vendor_name, category: x.vendor_category, logoUrl: x.logo_url, available: x.vendor_status === "approved" },
    units: x.units,
    latestOffer: x.latest_offer
      ? {
          id: x.latest_offer.id,
          version: x.latest_offer.version,
          status: x.latest_offer.status,
          totalPaise: Number(x.latest_offer.total_paise),
          validUntil: x.latest_offer.valid_until,
        }
      : null,
    unread: x.unread,
  }));
}

export interface CustomerEnquiryDetail {
  id: number;
  status: EnquiryStatus;
  name: string;
  eventDate: string | null;
  eventEndDate: string | null;
  slot: string | null;
  eventTypeName: string | null;
  districtName: string | null;
  venueText: string | null;
  guestCount: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budget: string | null;
  message: string | null;
  createdAt: string;
  vendor: {
    id: number;
    name: string;
    category: string;
    logoUrl: string | null;
    available: boolean;
    /** Only while billing is off (PRODUCT_PLAN 9 #17). */
    phone: string | null;
    whatsapp: string | null;
  };
  units: { serviceId: number; title: string; qty: number | null }[];
  thread: Thread;
}

export async function getCustomerEnquiry(scope: CustomerScope, quoteId: number): Promise<CustomerEnquiryDetail | null> {
  const w = scopeSql(scope, 2);
  const exists = await pool.query<{ id: number }>(`SELECT q.id FROM quote_requests q WHERE q.id = $1 AND ${w.sql}`, [quoteId, w.value]);
  if (!exists.rows[0]) return null;
  await sweepExpired({ quoteId });
  const r = await pool.query<{
    id: number;
    status: EnquiryStatus;
    name: string;
    event_date: string | null;
    event_end_date: string | null;
    slot: string | null;
    event_type_name: string | null;
    district_name: string | null;
    venue_text: string | null;
    guest_count: number | null;
    budget_min: number | null;
    budget_max: number | null;
    budget: string | null;
    message: string | null;
    created_at: Date;
    vendor_id: number;
    vendor_name: string;
    vendor_category: string;
    logo_url: string | null;
    vendor_status: string;
    vendor_phone: string | null;
    vendor_whatsapp: string | null;
    units: { service_id: number; title: string; qty: string | null }[];
  }>(
    `SELECT q.id, q.status, q.name, q.event_date::text AS event_date, q.event_end_date::text AS event_end_date, q.slot,
            et.name AS event_type_name, d.name AS district_name, q.venue_text, q.guest_count, q.budget_min, q.budget_max,
            q.budget, q.message, q.created_at,
            v.id AS vendor_id, v.name AS vendor_name, v.category AS vendor_category, v.logo_url, v.status AS vendor_status,
            v.phone AS vendor_phone, v.whatsapp AS vendor_whatsapp,
            COALESCE((SELECT json_agg(json_build_object('service_id', qs.service_id, 'title', COALESCE(qs.snapshot->>'title', s.title),
                                                        'qty', qs.qty) ORDER BY COALESCE(qs.snapshot->>'title', s.title))
                        FROM quote_request_services qs JOIN services s ON s.id = qs.service_id
                       WHERE qs.quote_request_id = q.id), '[]'::json) AS units
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       LEFT JOIN event_types et ON et.id = q.event_type_id
       LEFT JOIN districts d ON d.id = q.district_id
      WHERE q.id = $1`,
    [quoteId]
  );
  const x = r.rows[0];
  if (!x) return null;
  const showContact = !billingEnabled() && x.vendor_status === "approved";
  return {
    id: x.id,
    status: x.status,
    name: x.name,
    eventDate: x.event_date,
    eventEndDate: x.event_end_date,
    slot: x.slot,
    eventTypeName: x.event_type_name,
    districtName: x.district_name,
    venueText: x.venue_text,
    guestCount: x.guest_count,
    budgetMin: x.budget_min,
    budgetMax: x.budget_max,
    budget: x.budget,
    message: x.message,
    createdAt: iso(x.created_at)!,
    vendor: {
      id: x.vendor_id,
      name: x.vendor_name,
      category: x.vendor_category,
      logoUrl: x.logo_url,
      available: x.vendor_status === "approved",
      phone: showContact ? x.vendor_phone : null,
      whatsapp: showContact ? x.vendor_whatsapp : null,
    },
    units: x.units.map((u) => ({ serviceId: u.service_id, title: u.title, qty: u.qty === null ? null : Number(u.qty) })),
    thread: await loadThread(quoteId),
  };
}

// ---- vendor side ----------------------------------------------------------

/** The thread of one of the vendor's leads (null if it isn't theirs). */
export async function getVendorThread(vendorId: number, leadId: number): Promise<Thread | null> {
  const own = await pool.query("SELECT 1 FROM quote_requests WHERE id = $1 AND vendor_id = $2", [leadId, vendorId]);
  if (!own.rowCount) return null;
  await sweepExpired({ quoteId: leadId });
  return loadThread(leadId);
}

export interface VendorLeadExtras {
  unread: number;
  offer: { version: number; status: Offer["status"]; totalPaise: number } | null;
}

/** Unread customer messages and the latest offer per lead (inbox dots and the Quoted tab). */
export async function vendorLeadExtras(vendorId: number): Promise<Map<number, VendorLeadExtras>> {
  const r = await pool.query<{ id: number; unread: number; offer: { version: number; status: Offer["status"]; total_paise: number } | null }>(
    `SELECT q.id,
            (SELECT count(*)::int FROM quote_messages m
              WHERE m.quote_request_id = q.id AND m.read_at IS NULL AND m.sender_role = 'customer') AS unread,
            (SELECT json_build_object('version', o.version, 'status', o.status, 'total_paise', o.total_paise)
               FROM quote_offers o WHERE o.quote_request_id = q.id ORDER BY o.version DESC LIMIT 1) AS offer
       FROM quote_requests q WHERE q.vendor_id = $1`,
    [vendorId]
  );
  return new Map(
    r.rows.map((x) => [
      x.id,
      {
        unread: x.unread,
        offer: x.offer ? { version: x.offer.version, status: x.offer.status, totalPaise: Number(x.offer.total_paise) } : null,
      },
    ])
  );
}

/** Data the offer builder prefills from: GSTIN present, travel fee for the enquiry's district. */
export async function offerBuilderContext(vendorId: number, leadId: number): Promise<{ hasGstin: boolean; travelFee: number | null } | null> {
  const r = await pool.query<{ gstin: string | null; travel_fee: number | null }>(
    `SELECT v.gstin, a.travel_fee
       FROM quote_requests q
       JOIN vendors v ON v.id = q.vendor_id
       LEFT JOIN vendor_service_areas a ON a.vendor_id = v.id AND a.district_id = q.district_id
      WHERE q.id = $1 AND q.vendor_id = $2`,
    [leadId, vendorId]
  );
  const x = r.rows[0];
  return x ? { hasGstin: !!x.gstin, travelFee: x.travel_fee } : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function setStatus(client: Client, quoteId: number, from: string, to: EnquiryStatus, changedBy: number | null, extraSet = "") {
  await client.query(`UPDATE quote_requests SET status = $2, status_updated_at = now()${extraSet} WHERE id = $1`, [quoteId, to]);
  await client.query("INSERT INTO quote_status_events (quote_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4)", [
    quoteId,
    from,
    to,
    changedBy,
  ]);
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Message body: trimmed, 1..4000 characters (the DB CHECK). null when invalid. */
export function cleanMessageBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(CONTROL, "").replace(/\n{4,}/g, "\n\n\n").trim();
  return s.length >= 1 && s.length <= 4000 ? s : null;
}

export interface PostedMessage {
  message: ThreadMessage;
  status: EnquiryStatus;
}

/**
 * Posts a message. Vendor: on a lead of their listing; the first reply moves
 * a new lead to "responded". Customer: on their own enquiry. Returns null
 * when the enquiry isn't the caller's (-> 404/403), throws TransitionError
 * (409) when the enquiry is closed.
 */
export async function postMessage(
  who: { role: "vendor"; vendorId: number; userId: number } | { role: "customer"; scope: CustomerScope; userId: number | null },
  quoteId: number,
  body: string
): Promise<PostedMessage | null> {
  return withTransaction(async (client) => {
    let cond: string;
    let value: unknown;
    if (who.role === "vendor") {
      cond = "q.vendor_id = $2";
      value = who.vendorId;
    } else {
      const w = scopeSql(who.scope, 2);
      cond = w.sql;
      value = w.value;
    }
    const cur = await client.query<{ status: EnquiryStatus }>(`SELECT q.status FROM quote_requests q WHERE q.id = $1 AND ${cond} FOR UPDATE`, [
      quoteId,
      value,
    ]);
    const row = cur.rows[0];
    if (!row) return null;
    await sweepExpired({ quoteId }, client);
    const status = ((await client.query<{ status: EnquiryStatus }>("SELECT status FROM quote_requests WHERE id = $1", [quoteId])).rows[0]
      .status) as EnquiryStatus;
    if (!canMessage(status)) {
      throw new TransitionError(
        status,
        status,
        status === "withdrawn" ? "This enquiry was withdrawn, so the conversation is closed." : "This enquiry has expired, so the conversation is closed.",
        "THREAD_CLOSED"
      );
    }
    const ins = await client.query<{ id: number; created_at: Date }>(
      `INSERT INTO quote_messages (quote_request_id, sender_role, sender_user_id, body) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [quoteId, who.role, who.userId, body]
    );
    let newStatus = status;
    if (who.role === "vendor" && status === "pending") {
      await setStatus(client, quoteId, status, "responded", who.userId);
      newStatus = "responded";
    }
    const p = (await loadParties(client, quoteId))!;
    if (who.role === "vendor") {
      await notifyOnce(client, p.customerId, "enquiry.message", quoteId, `${p.vendorName} sent you a message`, preview(body), customerLink(quoteId));
    } else {
      await notifyOnce(client, p.vendorOwnerId, "lead.message", quoteId, `${p.customerName} sent a message`, preview(body), vendorLink(quoteId));
    }
    const m = maskMessageContacts(body);
    return {
      message: { id: ins.rows[0].id, senderRole: who.role, body: m.text, masked: m.masked, readAt: null, createdAt: iso(ins.rows[0].created_at)! },
      status: newStatus,
    };
  });
}

/**
 * Sends offer vN on one of the vendor's leads: supersedes the previous live
 * offer, moves the enquiry to "responded" and notifies the customer.
 * null when the lead isn't the vendor's. Throws ThreadError (400) for GST
 * without a GSTIN or a foreign offering, TransitionError (409) when the
 * enquiry can't take an offer (booked, withdrawn, expired).
 */
export async function sendOffer(
  vendorId: number,
  userId: number,
  leadId: number,
  input: OfferInput
): Promise<{ offerId: number; version: number; status: EnquiryStatus } | null> {
  return withTransaction(async (client) => {
    const cur = await client.query<{ status: EnquiryStatus; gstin: string | null }>(
      `SELECT q.status, v.gstin FROM quote_requests q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.id = $1 AND q.vendor_id = $2 FOR UPDATE OF q`,
      [leadId, vendorId]
    );
    const row = cur.rows[0];
    if (!row) return null;
    await sweepExpired({ quoteId: leadId }, client);
    const status = (await client.query<{ status: EnquiryStatus }>("SELECT status FROM quote_requests WHERE id = $1", [leadId])).rows[0].status;
    if (!canSendOffer(status)) {
      throw new TransitionError(
        status,
        "responded",
        status === "booked"
          ? "This enquiry is already booked. Message the customer instead of sending a new offer."
          : status === "withdrawn"
            ? "The customer withdrew this enquiry."
            : "This enquiry has expired (the event date has passed).",
        "OFFER_NOT_ALLOWED"
      );
    }
    if (input.gstPaise > 0 && !row.gstin) {
      throw new ThreadError(400, "GST_NOT_ALLOWED", "Add your GSTIN in your business profile before charging GST.", "gst");
    }
    const ids = [...new Set(input.lines.map((l) => l.serviceId).filter((x): x is number => x !== null))];
    if (ids.length) {
      const own = await client.query("SELECT id FROM services WHERE vendor_id = $1 AND id = ANY($2::int[])", [vendorId, ids]);
      if (own.rowCount !== ids.length) throw new ThreadError(400, "VALIDATION", "One of the lines points to an offering that isn't yours.", "lines");
    }

    await client.query(
      `UPDATE quote_offers SET status = 'superseded' WHERE quote_request_id = $1 AND status IN ('sent', 'accepted')`,
      [leadId]
    );
    const version = (
      await client.query<{ v: number }>("SELECT COALESCE(max(version), 0)::int + 1 AS v FROM quote_offers WHERE quote_request_id = $1", [leadId])
    ).rows[0].v;
    const offer = await client.query<{ id: number }>(
      `INSERT INTO quote_offers (quote_request_id, version, created_by, subtotal_paise, travel_paise, discount_paise, gst_paise,
                                 total_paise, advance_pct, valid_until, terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11) RETURNING id`,
      [
        leadId,
        version,
        userId,
        input.subtotalPaise,
        input.travelPaise,
        input.discountPaise,
        input.gstPaise,
        input.totalPaise,
        input.advancePct,
        input.validUntil,
        input.terms,
      ]
    );
    const offerId = offer.rows[0].id;
    await client.query(
      `INSERT INTO quote_offer_lines (offer_id, service_id, label, qty, unit, unit_price_paise, amount_paise, sort_order)
       SELECT $1, u.service_id, u.label, u.qty, u.unit, u.unit_price_paise, u.amount_paise, u.ord - 1
         FROM unnest($2::int[], $3::text[], $4::numeric[], $5::text[], $6::bigint[], $7::bigint[]) WITH ORDINALITY
              AS u(service_id, label, qty, unit, unit_price_paise, amount_paise, ord)`,
      [
        offerId,
        input.lines.map((l) => l.serviceId),
        input.lines.map((l) => l.label),
        input.lines.map((l) => l.qty),
        input.lines.map((l) => l.unit),
        input.lines.map((l) => l.unitPricePaise),
        input.lines.map((l) => l.amountPaise),
      ]
    );
    let newStatus = status;
    if (status !== "responded") {
      assertTransition(status, "responded", "vendor");
      await setStatus(client, leadId, status, "responded", userId);
      newStatus = "responded";
    }
    const p = (await loadParties(client, leadId))!;
    await notifyOnce(
      client,
      p.customerId,
      "enquiry.offer",
      leadId,
      version > 1 ? `${p.vendorName} sent a revised offer` : `${p.vendorName} sent you an offer`,
      `Offer v${version}: ${formatPaise(input.totalPaise)} total${input.validUntil ? `, valid until ${formatOfferDate(input.validUntil)}` : ""}`,
      customerLink(leadId)
    );
    return { offerId, version, status: newStatus };
  });
}

export type CustomerAction =
  | { action: "withdraw" }
  | { action: "accept"; offerId: number }
  | { action: "decline"; offerId: number; message?: string | null }
  | { action: "booked" };

/**
 * Customer actions on their enquiry. null when it isn't theirs. Throws
 * TransitionError (409) for a move the machine doesn't allow (including an
 * offer that is no longer open or has expired) and ThreadError (404) for an
 * offer of another enquiry.
 */
export async function customerAct(scope: CustomerScope, userId: number | null, quoteId: number, act: CustomerAction): Promise<EnquiryStatus | null> {
  const w = scopeSql(scope, 2);
  const found = await pool.query<{ vendor_id: number }>(`SELECT q.vendor_id FROM quote_requests q WHERE q.id = $1 AND ${w.sql}`, [
    quoteId,
    w.value,
  ]);
  const vendorId = found.rows[0]?.vendor_id;
  if (!vendorId) return null;
  await sweepExpired({ quoteId });

  if (act.action === "booked") {
    // Same path as the vendor's "mark booked": availability + events + notification.
    if (userId === null) throw new ThreadError(401, "SIGN_IN", "Sign in to mark this enquiry as booked.");
    const lead = await updateVendorLead(vendorId, quoteId, userId, { status: "booked", actor: "customer" });
    return lead ? (lead.status as EnquiryStatus) : null;
  }

  // An offer that ran out is recorded as expired even though the accept fails.
  let expiredOffer = false;
  const result = await withTransaction(async (client) => {
    const cur = await client.query<{ status: EnquiryStatus }>("SELECT status FROM quote_requests WHERE id = $1 FOR UPDATE", [quoteId]);
    const status = cur.rows[0].status;

    if (act.action === "withdraw") {
      assertTransition(status, "withdrawn", "customer");
      await setStatus(client, quoteId, status, "withdrawn", userId, ", customer_withdrawn_at = now()");
      await notifyStatusChange(client, quoteId, "withdrawn", "customer");
      return "withdrawn" as EnquiryStatus;
    }

    const o = await client.query<{ id: number; version: number; status: Offer["status"]; expired: boolean; total_paise: string }>(
      `SELECT id, version, status, total_paise, (valid_until IS NOT NULL AND valid_until < ${TODAY}) AS expired
         FROM quote_offers WHERE id = $1 AND quote_request_id = $2 FOR UPDATE`,
      [act.offerId, quoteId]
    );
    const offer = o.rows[0];
    if (!offer) throw new ThreadError(404, "NOT_FOUND", "That offer isn't part of this enquiry.", "offerId");
    if (offer.status === "sent" && offer.expired) {
      await client.query("UPDATE quote_offers SET status = 'expired' WHERE id = $1", [offer.id]);
      expiredOffer = true;
      return status;
    }
    if (offer.status !== "sent") {
      const why: Record<string, string> = {
        accepted: "You've already accepted this offer.",
        declined: "You've already declined this offer.",
        superseded: "The vendor has sent a newer offer. Please look at the latest one.",
        expired: "This offer has expired. Ask the vendor for a fresh one.",
      };
      throw new TransitionError(status, act.action === "accept" ? "accepted" : status, why[offer.status] ?? "This offer is no longer open.", "OFFER_NOT_OPEN");
    }
    const p = (await loadParties(client, quoteId))!;
    if (act.action === "accept") {
      assertTransition(status, "accepted", "customer");
      await client.query("UPDATE quote_offers SET status = 'accepted', responded_at = now() WHERE id = $1", [offer.id]);
      await setStatus(client, quoteId, status, "accepted", userId);
      await notify(
        client,
        p.vendorOwnerId,
        "lead.offer_accepted",
        `${p.customerName} accepted your offer`,
        `Offer v${offer.version}, ${formatPaise(offer.total_paise)}. Confirm the booking when the advance is settled.`,
        vendorLink(quoteId),
        { quoteId }
      );
      return "accepted" as EnquiryStatus;
    }
    // decline: the enquiry stays open so the vendor can send a revised offer.
    if (status === "withdrawn" || status === "expired") throw new TransitionError(status, status);
    await client.query("UPDATE quote_offers SET status = 'declined', responded_at = now() WHERE id = $1", [offer.id]);
    if (act.message) {
      await client.query(
        "INSERT INTO quote_messages (quote_request_id, sender_role, sender_user_id, body) VALUES ($1, 'customer', $2, $3)",
        [quoteId, userId, act.message]
      );
    }
    await notify(
      client,
      p.vendorOwnerId,
      "lead.offer_declined",
      `${p.customerName} declined offer v${offer.version}`,
      act.message ? preview(act.message) : "You can send a revised offer from the lead.",
      vendorLink(quoteId),
      { quoteId }
    );
    return status;
  });
  if (expiredOffer) {
    throw new TransitionError(result, "accepted", "This offer has expired. Ask the vendor for a fresh one.", "OFFER_EXPIRED");
  }
  return result;
}

/** Maps thread errors to { status, body } for route handlers, or null for unknown errors. */
export function threadErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof ThreadError) return { status: err.status, body: { error: err.message, code: err.code, ...(err.field ? { field: err.field } : {}) } };
  if (err instanceof TransitionError) return { status: 409, body: { error: err.message, code: err.code, from: err.from, to: err.to } };
  return null;
}
