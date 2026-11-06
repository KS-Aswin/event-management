// Vendor availability calendar (PRODUCT_PLAN P2-6, section 9 #22/#23).
//
// vendor_availability holds one row per (vendor, date, slot) only when the
// day differs from the default: a manual block, a capacity other than the
// vendor's max_events_per_day, or bookings (lib/availability-booking.ts).
// No row = open with the default capacity.
//
//   status 'blocked'  closed by the vendor (manual)
//   status 'booked'   capacity_used >= capacity_total
//   status 'limited'  still has room (capacity_used < capacity_total)
//
// Enforcement is soft: search hides a blocked/full vendor only when a date
// filter is applied, and an enquiry on a busy date warns but is allowed.

import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

export const SLOTS = ["full", "morning", "evening"] as const;
export type Slot = (typeof SLOTS)[number];
export type SlotState = "open" | "limited" | "full" | "blocked";
export type AvailabilityAction = "block" | "unblock" | "capacity";

export const MAX_RANGE_DAYS = 120;
export const MAX_CAPACITY = 50;
export const NOTE_MAX = 200;
/** Open enquiry statuses that a block would clash with. */
export const OPEN_LEAD_STATUSES = ["pending", "responded", "accepted"] as const;

export function isSlot(v: unknown): v is Slot {
  return typeof v === "string" && (SLOTS as readonly string[]).includes(v);
}

export interface SlotEntry {
  slot: Slot;
  state: SlotState;
  capacityTotal: number;
  capacityUsed: number;
  note: string | null;
}

export interface CalendarLead {
  id: number;
  name: string;
  date: string;
  slot: string | null;
  status: string;
  eventType: string | null;
}

export interface CalendarMonth {
  month: string;
  today: string;
  defaultCapacity: number;
  /** date (YYYY-MM-DD) -> rows that differ from the default */
  days: Record<string, SlotEntry[]>;
  bookings: CalendarLead[];
  openLeads: CalendarLead[];
}

/** The state shown for a stored row. Capacity 2 with 1 booked is "limited". */
export function slotState(status: string, capacityTotal: number, capacityUsed: number): SlotState {
  if (status === "blocked") return "blocked";
  if (capacityUsed >= capacityTotal) return "full";
  if (capacityUsed > 0) return "limited";
  return "open";
}

/** Today's date in India (YYYY-MM-DD); the calendar and reviews use Indian dates. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parseMonth(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return null;
  const y = Number(v.slice(0, 4));
  return y >= 2000 && y <= 2100 ? v : null;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${month}-01`, last };
}

export async function getCalendarMonth(vendorId: number, month: string): Promise<CalendarMonth> {
  const { first, last } = monthBounds(month);
  const [vendor, rows, leads] = await Promise.all([
    pool.query<{ cap: number }>("SELECT max_events_per_day AS cap FROM vendors WHERE id = $1", [vendorId]),
    pool.query<{ date: string; slot: Slot; status: string; capacity_total: number; capacity_used: number; note: string | null }>(
      `SELECT date::text AS date, slot, status, capacity_total, capacity_used, note
         FROM vendor_availability WHERE vendor_id = $1 AND date BETWEEN $2::date AND $3::date
        ORDER BY date, array_position(ARRAY['full','morning','evening'], slot)`,
      [vendorId, first, last]
    ),
    pool.query<{ id: number; name: string; date: string; slot: string | null; status: string; event_type: string | null }>(
      `SELECT q.id, q.name, q.event_date::text AS date, q.slot, q.status, et.name AS event_type
         FROM quote_requests q LEFT JOIN event_types et ON et.id = q.event_type_id
        WHERE q.vendor_id = $1 AND q.event_date BETWEEN $2::date AND $3::date
          AND q.status IN ('booked', 'pending', 'responded', 'accepted')
        ORDER BY q.event_date, q.id`,
      [vendorId, first, last]
    ),
  ]);
  const days: Record<string, SlotEntry[]> = {};
  for (const r of rows.rows) {
    (days[r.date] ??= []).push({
      slot: r.slot,
      state: slotState(r.status, r.capacity_total, r.capacity_used),
      capacityTotal: r.capacity_total,
      capacityUsed: r.capacity_used,
      note: r.note,
    });
  }
  const toLead = (r: (typeof leads.rows)[number]): CalendarLead => ({
    id: r.id,
    name: r.name,
    date: r.date,
    slot: r.slot,
    status: r.status,
    eventType: r.event_type,
  });
  return {
    month,
    today: todayIst(),
    defaultCapacity: vendor.rows[0]?.cap ?? 1,
    days,
    bookings: leads.rows.filter((r) => r.status === "booked").map(toLead),
    openLeads: leads.rows.filter((r) => r.status !== "booked").map(toLead),
  };
}

export interface AvailabilityChange {
  action: AvailabilityAction;
  from: string;
  to: string;
  slot: Slot;
  capacity?: number;
  note?: string | null;
  /** Block even though open enquiries fall on these dates. */
  force?: boolean;
}

export type ApplyResult =
  | { ok: true; days: number }
  | { ok: false; code: "PENDING_LEADS"; leads: CalendarLead[] }
  | { ok: false; code: "CAPACITY_BELOW_BOOKED"; dates: string[] };

/**
 * Open enquiries that a block on [from, to] would clash with: a full-day
 * block clashes with any slot; a half-day block with that slot or an
 * enquiry with no slot / full day.
 */
async function clashingLeads(client: Pick<PoolClient, "query">, vendorId: number, c: AvailabilityChange): Promise<CalendarLead[]> {
  const r = await client.query<{ id: number; name: string; date: string; slot: string | null; status: string; event_type: string | null }>(
    `SELECT q.id, q.name, q.event_date::text AS date, q.slot, q.status, et.name AS event_type
       FROM quote_requests q LEFT JOIN event_types et ON et.id = q.event_type_id
      WHERE q.vendor_id = $1 AND q.event_date BETWEEN $2::date AND $3::date
        AND q.status = ANY($4::text[])
        AND ($5 = 'full' OR q.slot IS NULL OR q.slot IN ('full', $5))
      ORDER BY q.event_date, q.id LIMIT 20`,
    [vendorId, c.from, c.to, [...OPEN_LEAD_STATUSES], c.slot]
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, date: x.date, slot: x.slot, status: x.status, eventType: x.event_type }));
}

/**
 * Blocks, unblocks or sets the capacity of one slot on every date in
 * [from, to] (inclusive), in one transaction. Rows that end up equal to the
 * default (open, nothing booked, default capacity) are removed.
 */
export async function applyAvailability(vendorId: number, c: AvailabilityChange): Promise<ApplyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise calendar writes per vendor (bookings lock the lead, not the day).
    await client.query("SELECT 1 FROM vendors WHERE id = $1 FOR UPDATE", [vendorId]);
    const days = daysBetween(c.from, c.to) + 1;
    const note = c.note ?? null;

    if (c.action === "block") {
      if (!c.force) {
        const leads = await clashingLeads(client, vendorId, c);
        if (leads.length) {
          await client.query("ROLLBACK");
          return { ok: false, code: "PENDING_LEADS", leads };
        }
      }
      await client.query(
        `INSERT INTO vendor_availability (vendor_id, date, slot, status, capacity_total, capacity_used, source, note)
         SELECT $1, d::date, $4, 'blocked', v.max_events_per_day, 0, 'manual', $5
           FROM generate_series($2::date, $3::date, interval '1 day') d, vendors v WHERE v.id = $1
         ON CONFLICT (vendor_id, date, slot) DO UPDATE SET
           status = 'blocked', source = 'manual',
           note = COALESCE(EXCLUDED.note, vendor_availability.note), updated_at = now()`,
        [vendorId, c.from, c.to, c.slot, note]
      );
    } else if (c.action === "unblock") {
      await client.query(
        `UPDATE vendor_availability SET
           status = CASE WHEN capacity_used >= capacity_total THEN 'booked' ELSE 'limited' END,
           note = NULL, updated_at = now()
         WHERE vendor_id = $1 AND date BETWEEN $2::date AND $3::date AND slot = $4 AND status = 'blocked'`,
        [vendorId, c.from, c.to, c.slot]
      );
    } else {
      const cap = c.capacity!;
      const over = await client.query<{ date: string }>(
        `SELECT date::text AS date FROM vendor_availability
          WHERE vendor_id = $1 AND date BETWEEN $2::date AND $3::date AND slot = $4 AND capacity_used > $5
          ORDER BY date LIMIT 10`,
        [vendorId, c.from, c.to, c.slot, cap]
      );
      if (over.rows.length) {
        await client.query("ROLLBACK");
        return { ok: false, code: "CAPACITY_BELOW_BOOKED", dates: over.rows.map((r) => r.date) };
      }
      await client.query(
        `INSERT INTO vendor_availability (vendor_id, date, slot, status, capacity_total, capacity_used, source, note)
         SELECT $1, d::date, $4, 'limited', $5, 0, 'manual', $6
           FROM generate_series($2::date, $3::date, interval '1 day') d
         ON CONFLICT (vendor_id, date, slot) DO UPDATE SET
           capacity_total = $5,
           status = CASE WHEN vendor_availability.status = 'blocked' THEN 'blocked'
                         WHEN vendor_availability.capacity_used >= $5 THEN 'booked' ELSE 'limited' END,
           source = 'manual',
           note = COALESCE(EXCLUDED.note, vendor_availability.note), updated_at = now()`,
        [vendorId, c.from, c.to, c.slot, cap, note]
      );
    }

    // Drop rows that now say nothing beyond the default.
    await client.query(
      `DELETE FROM vendor_availability va USING vendors v
        WHERE v.id = va.vendor_id AND va.vendor_id = $1 AND va.date BETWEEN $2::date AND $3::date AND va.slot = $4
          AND va.status <> 'blocked' AND va.capacity_used = 0 AND va.capacity_total = v.max_events_per_day`,
      [vendorId, c.from, c.to, c.slot]
    );
    await client.query("COMMIT");
    return { ok: true, days };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

