import { NextResponse } from "next/server";
import { clientIp, rateLimitHit } from "@/lib/rate-limit";
import { isEnquiryBlocked } from "@/lib/admin/ops";
import { findUserById } from "@/lib/db";
import {
  ENQUIRY_LIMITS,
  createMultiEnquiry,
  parseEnquiryFields,
  parseUnitRequest,
  type EnquiryError,
  type UnitRequest,
} from "@/lib/enquiries-create";
import { getLiveSession } from "../../_lib/auth";

// POST /api/enquiries/multi: one enquiry to up to 5 vendors (P2-9).
//
// Body: the same fields as POST /api/vendors/[id]/quotes (name, phone,
// eventDate, eventTypeId, guestCount, districtId, venueType, budgetMin/Max,
// slot, foodPref, preferredContact, contactEmail, message...) plus
//   vendorIds: number[]            1..5 distinct vendor ids (6+ -> 400)
//   unitsByVendor?: { "<vendorId>": [{serviceId, qty?}] }   optional units per vendor
//
// 201 { batchId, sent, failed, results: [
//        {vendorId, ok: true, enquiryId, trackingPath, guestToken, warnings[]} |
//        {vendorId, ok: false, code: VENDOR_UNAVAILABLE|OWN_LISTING|INVALID_SERVICE|PACKAGE_ONLY, error} |
//        {vendorId, ok: false, code: ALREADY_ENQUIRED, error, enquiryId} ] }
//   (partial success: some results ok:false, still 201; ALREADY_ENQUIRED is
//   a signed-in customer's open enquiry to that vendor for the same date, QA-040)
// 409 NO_VENDORS_AVAILABLE | ALREADY_ENQUIRED {results}: nothing could be sent.
// 429 DAILY_LIMIT {remaining}: more than 15 enquiries from this phone in 24 h
//     (counts every enquiry, single or multi); RATE_LIMIT: too many sends.
// 400 VALIDATION {field?}, 403 blocked contact.

const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(e: EnquiryError) {
  const { ok: _ok, status, ...body } = e;
  void _ok;
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function bad(error: string, field?: string) {
  return NextResponse.json(field ? { error, code: "VALIDATION", field } : { error, code: "VALIDATION" }, {
    status: 400,
    headers: NO_STORE,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Invalid request body.");
  const raw = body as Record<string, unknown>;

  const ids = raw.vendorIds;
  if (!Array.isArray(ids) || ids.length === 0) return bad("Choose at least one vendor.", "vendorIds");
  if (!ids.every((n) => Number.isInteger(n) && n > 0 && n <= 2147483647)) return bad("Invalid vendor selection.", "vendorIds");
  const vendorIds = [...new Set(ids as number[])];
  if (vendorIds.length > ENQUIRY_LIMITS.maxVendorsPerBatch) {
    return bad(`You can send one enquiry to at most ${ENQUIRY_LIMITS.maxVendorsPerBatch} vendors at a time.`, "vendorIds");
  }

  const unitsByVendor = new Map<number, UnitRequest>();
  if (raw.unitsByVendor !== undefined && raw.unitsByVendor !== null) {
    if (typeof raw.unitsByVendor !== "object" || Array.isArray(raw.unitsByVendor)) return bad("Invalid service selection.");
    for (const [k, v] of Object.entries(raw.unitsByVendor as Record<string, unknown>)) {
      const vid = Number(k);
      if (!vendorIds.includes(vid)) return bad("Services were given for a vendor that isn't selected.");
      const req = parseUnitRequest(undefined, v);
      if (!req) return bad("Invalid service selection.");
      unitsByVendor.set(vid, req);
    }
  }

  const session = await getLiveSession();
  const account = session ? await findUserById(session.userId) : null;
  const parsed = await parseEnquiryFields(raw, { accountEmail: account?.email ?? null });
  if (!parsed.ok) return errorResponse(parsed);
  const fields = parsed.fields;

  // Burst guard per user / IP, shared by every server instance (QA-037); the
  // per-phone daily cap is checked in the transaction.
  const who = session ? `u:${session.userId}` : `ip:${clientIp(request.headers)}`;
  const limit = await rateLimitHit(`quote-multi:${who}`, 6, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again.", code: "RATE_LIMIT" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } }
    );
  }

  if (await isEnquiryBlocked({ phone: fields.phone, email: fields.contactEmail, userId: session?.userId ?? null })) {
    return NextResponse.json(
      { error: "We couldn't send this enquiry. Please contact support if you think this is a mistake.", code: "FORBIDDEN" },
      { status: 403, headers: NO_STORE }
    );
  }

  const out = await createMultiEnquiry({ vendorIds, fields, customerId: session?.userId ?? null, unitsByVendor });
  if (!out.ok) return errorResponse(out);
  const sent = out.results.filter((r) => r.ok).length;
  return NextResponse.json(
    { batchId: out.batchId, sent, failed: out.results.length - sent, results: out.results },
    { status: 201, headers: NO_STORE }
  );
}
