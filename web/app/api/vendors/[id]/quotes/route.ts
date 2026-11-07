import { NextResponse } from "next/server";
import { clientIp, rateLimitHit } from "@/lib/rate-limit";
import { isEnquiryBlocked } from "@/lib/admin/ops";
import { findUserById } from "@/lib/db";
import {
  DUPLICATE_MESSAGE,
  createEnquiry,
  findEnquiryVendors,
  parseEnquiryFields,
  parseUnitRequest,
  resolveUnits,
  type EnquiryError,
} from "@/lib/enquiries-create";
import { getLiveSession } from "../../../_lib/auth";
import { parseId } from "../../../_lib/validation";

// POST /api/vendors/[id]/quotes: enquiry form v2 (P2-2).
//
// Body (JSON; only name and phone are required):
//   name, phone (Indian 10-digit or +<country code>; stored as E.164),
//   eventDate / eventEndDate (YYYY-MM-DD, not in the past), eventTypeId,
//   guestCount, districtId, venueType, venueText, budgetMin / budgetMax
//   (rupees; legacy free-text `budget` still accepted), slot
//   (full|morning|evening), foodPref (veg|non_veg|both), preferredContact
//   (whatsapp|call|email), contactEmail, message,
//   serviceIds: number[] and/or units: [{serviceId, qty?}].
// 201 { quote: {id}, enquiry: {id, status, guestToken, trackingPath}, warnings: [...] }
// A guest (signed out) gets a guestToken: /enquiry/<token> tracks the enquiry.
// Errors: {error, code, field?} with 400 (validation, PAST_DATE,
// INVALID_SERVICE, PACKAGE_ONLY), 403 (blocked contact, own listing),
// 404 (vendor not taking enquiries), 409 ALREADY_ENQUIRED {enquiryId,
// trackingPath} (QA-040: the signed-in customer already has an open enquiry
// with this vendor for the same date; nothing is created), 429 (rate limit,
// counted in Postgres so it holds across serverless instances, QA-037).

const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(e: EnquiryError) {
  const { ok: _ok, status, ...body } = e;
  void _ok;
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id.", code: "VALIDATION" }, { status: 400 });
  }

  const session = await getLiveSession();

  // Only approved, published vendors take enquiries.
  const vendor = (await findEnquiryVendors([vendorId])).get(vendorId);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found.", code: "NOT_FOUND" }, { status: 404 });
  }
  if (session && vendor.owner_id === session.userId) {
    return NextResponse.json(
      { error: "You can't send an enquiry to your own listing.", code: "OWN_LISTING" },
      { status: 403 }
    );
  }

  // 10 enquiries per 10 minutes per signed-in user or IP, shared by every
  // server instance (QA-037).
  const who = session ? `u:${session.userId}` : `ip:${clientIp(request.headers)}`;
  const limit = await rateLimitHit(`quote:${who}`, 10, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again.", code: "RATE_LIMIT" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body.", code: "VALIDATION" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body.", code: "VALIDATION" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const account = session ? await findUserById(session.userId) : null;
  const parsed = await parseEnquiryFields(raw, { accountEmail: account?.email ?? null });
  if (!parsed.ok) return errorResponse(parsed);
  const fields = parsed.fields;

  // Blocked contacts (P1-13): a generic 403 that doesn't say why.
  if (await isEnquiryBlocked({ phone: fields.phone, email: fields.contactEmail, userId: session?.userId ?? null })) {
    return NextResponse.json(
      { error: "We couldn't send this enquiry. Please contact support if you think this is a mistake.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const unitReq = parseUnitRequest(raw.serviceIds, raw.units);
  if (!unitReq) {
    return NextResponse.json({ error: "Invalid service selection.", code: "VALIDATION" }, { status: 400 });
  }
  const units = await resolveUnits(vendorId, unitReq, fields.guestCount);
  if (!units.ok) return errorResponse(units);

  const created = await createEnquiry({
    vendor,
    fields,
    customerId: session?.userId ?? null,
    units: units.units,
  });
  if (!created.ok) {
    return NextResponse.json(
      {
        error: DUPLICATE_MESSAGE,
        code: "ALREADY_ENQUIRED",
        enquiryId: created.duplicate.id,
        trackingPath: `/my/enquiries/${created.duplicate.id}`,
      },
      { status: 409, headers: NO_STORE }
    );
  }
  const { enquiry, warnings } = created;

  return NextResponse.json(
    { quote: { id: enquiry.id }, enquiry, warnings: [...units.warnings, ...warnings] },
    { status: 201, headers: NO_STORE }
  );
}
