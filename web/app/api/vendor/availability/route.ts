import { requireRole } from "@/app/api/_lib/auth";
import { bad, json, readObject, tooMany } from "@/app/api/_lib/thread-http";
import { getOwnVendor } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  MAX_CAPACITY,
  MAX_RANGE_DAYS,
  NOTE_MAX,
  applyAvailability,
  daysBetween,
  getCalendarMonth,
  isRealDate,
  isSlot,
  parseMonth,
  todayIst,
  type AvailabilityAction,
} from "@/lib/availability";

// The signed-in vendor's availability calendar (PRODUCT_PLAN P2-6, section 6).
// GET ?month=YYYY-MM: stored rows (blocked / capacity / booked) plus the
// booked and open leads with an event date in that month.
// PUT {action:'block'|'unblock'|'capacity', from, to?, slot?, capacity?, note?, force?}
// changes one slot on every date in [from, to]. Blocking a date that has an
// open enquiry answers 409 PENDING_LEADS (with the leads) unless force=true.
// The vendor is always the caller's own listing; no vendorId is accepted.

async function ownVendor() {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return json(404, { error: "Create your business listing first.", code: "NO_LISTING" });
  return { userId: auth.userId, vendorId: vendor.id };
}

export async function GET(request: Request) {
  const ctx = await ownVendor();
  if (ctx instanceof Response) return ctx;
  const raw = new URL(request.url).searchParams.get("month");
  const month = raw === null || raw === "" ? todayIst().slice(0, 7) : parseMonth(raw);
  if (!month) return bad("month", "Month must look like 2027-01.");
  return json(200, { ...(await getCalendarMonth(ctx.vendorId, month)) });
}

const ACTIONS: AvailabilityAction[] = ["block", "unblock", "capacity"];

export async function PUT(request: Request) {
  const ctx = await ownVendor();
  if (ctx instanceof Response) return ctx;
  if (!checkRateLimit(`availability:u:${ctx.userId}`, 60, 10 * 60_000)) return tooMany();

  const body = await readObject(request);
  if (!body) return bad("body", "Invalid request body.");

  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.includes(action as AvailabilityAction)) {
    return bad("action", "Action must be block, unblock or capacity.");
  }
  if (!isRealDate(body.from)) return bad("from", "Pick a valid start date.");
  const from = body.from;
  const to = body.to === undefined || body.to === null || body.to === "" ? from : body.to;
  if (!isRealDate(to)) return bad("to", "Pick a valid end date.");
  if (from < todayIst()) return json(400, { error: "Past dates can't be changed.", code: "PAST_DATE", field: "from" });
  if (to < from) return bad("to", "The end date must be on or after the start date.");
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    return bad("to", `A range can cover at most ${MAX_RANGE_DAYS} days.`);
  }
  const slot = body.slot === undefined || body.slot === null || body.slot === "" ? "full" : body.slot;
  if (!isSlot(slot)) return bad("slot", "Slot must be full, morning or evening.");

  let capacity: number | undefined;
  if (action === "capacity") {
    const n = typeof body.capacity === "number" ? body.capacity : Number(body.capacity);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
      return bad("capacity", `Capacity must be a whole number from 1 to ${MAX_CAPACITY}.`);
    }
    capacity = n;
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return bad("note", "Note must be text.");
    note = body.note.trim() || null;
    if (note && note.length > NOTE_MAX) return bad("note", `Keep the note under ${NOTE_MAX} characters.`);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") return bad("force", "force must be true or false.");

  const result = await applyAvailability(ctx.vendorId, {
    action: action as AvailabilityAction,
    from,
    to,
    slot,
    capacity,
    note,
    force: body.force === true,
  });
  if (!result.ok) {
    if (result.code === "PENDING_LEADS") {
      return json(409, {
        error:
          result.leads.length === 1
            ? "You have an open enquiry on this date. Block it anyway?"
            : `You have ${result.leads.length} open enquiries on these dates. Block them anyway?`,
        code: "PENDING_LEADS",
        leads: result.leads,
      });
    }
    return json(400, {
      error: "Some of these dates already have more bookings than that capacity.",
      code: "CAPACITY_BELOW_BOOKED",
      field: "capacity",
      dates: result.dates,
    });
  }
  return json(200, { ok: true, days: result.days });
}
