import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { findVendorLead, getOwnVendor, updateVendorLead, VENDOR_LEAD_STATUSES } from "@/lib/db";

// One lead of the signed-in vendor (PRODUCT_PLAN P0-14).
// GET: detail. PATCH: {status?, vendorNotes?, followUpAt?}. Status changes
// write quote_status_events; "booked" writes vendor_availability.
// A lead that wasn't sent to this vendor's listing gets 403 (the same answer
// whether or not the id exists, so ids can't be probed).

const NOTES_MAX = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
const forbidden = () => json(403, { error: "This enquiry wasn't sent to your listing.", code: "FORBIDDEN" });

async function context(params: Promise<{ id: string }>) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const leadId = parseId(id);
  if (leadId === null) return json(400, { error: "Invalid enquiry id.", code: "VALIDATION", field: "id" });
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return forbidden();
  return { userId: auth.userId, vendorId: vendor.id, leadId };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;
  const lead = await findVendorLead(ctx.vendorId, ctx.leadId);
  if (!lead) return forbidden();
  return json(200, { lead });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context(params);
  if (ctx instanceof Response) return ctx;

  let body: Record<string, unknown>;
  try {
    const b = await request.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    body = b as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid request body.", code: "VALIDATION", field: "body" });
  }

  const p: Parameters<typeof updateVendorLead>[3] = {};
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(VENDOR_LEAD_STATUSES as readonly string[]).includes(body.status)) {
      return json(400, {
        error: `Status must be one of: ${VENDOR_LEAD_STATUSES.join(", ")}.`,
        code: "VALIDATION",
        field: "status",
      });
    }
    p.status = body.status as (typeof VENDOR_LEAD_STATUSES)[number];
  }
  if (body.vendorNotes !== undefined) {
    if (body.vendorNotes !== null && typeof body.vendorNotes !== "string") {
      return json(400, { error: "Notes must be text.", code: "VALIDATION", field: "vendorNotes" });
    }
    const s = (body.vendorNotes ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (s.length > NOTES_MAX) {
      return json(400, { error: `Notes can be at most ${NOTES_MAX} characters.`, code: "VALIDATION", field: "vendorNotes" });
    }
    p.vendorNotes = s || null;
  }
  if (body.followUpAt !== undefined) {
    const v = body.followUpAt;
    if (v === null || v === "") p.followUpAt = null;
    else if (typeof v !== "string" || !isRealDate(v)) {
      return json(400, { error: "Pick a valid follow-up date.", code: "VALIDATION", field: "followUpAt" });
    } else p.followUpAt = v;
  }
  if (Object.keys(p).length === 0) {
    return json(400, { error: "Nothing to update.", code: "VALIDATION", field: "body" });
  }

  const lead = await updateVendorLead(ctx.vendorId, ctx.leadId, ctx.userId, p);
  if (!lead) return forbidden();
  return json(200, { lead });
}
