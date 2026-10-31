import { NextResponse } from "next/server";
import { getLiveSession } from "../../_lib/auth";
import { parseId } from "../../_lib/validation";
import { getOwnVendor, updateVendorLead, QUOTE_STATUSES, type QuoteStatus } from "@/lib/db";

// Legacy status endpoint, kept as a thin wrapper while old clients and tests
// still call it. New code uses PATCH /api/vendor/leads/[id]. Both go through
// updateVendorLead, so a change writes quote_status_events and "booked"
// writes vendor_availability.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const quoteId = parseId(id);
  if (quoteId === null) {
    return NextResponse.json({ error: "Invalid quote id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { status } = (body ?? {}) as Record<string, unknown>;
  if (typeof status !== "string" || !QUOTE_STATUSES.includes(status as QuoteStatus)) {
    return NextResponse.json(
      { error: `Status must be one of: ${QUOTE_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  // Not a vendor, no listing, or the quote went to someone else's listing:
  // the same 404, so it doesn't reveal which case it was.
  const vendor = session.role === "vendor" ? await getOwnVendor(session.userId) : null;
  const updated = vendor
    ? await updateVendorLead(vendor.id, quoteId, session.userId, { status: status as QuoteStatus })
    : null;
  if (!updated) {
    return NextResponse.json(
      { error: "Quote request not found, or it wasn't sent to your listing." },
      { status: 404 }
    );
  }

  return NextResponse.json({ quote: updated });
}
