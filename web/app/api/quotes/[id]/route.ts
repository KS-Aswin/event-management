import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { updateQuoteStatus, QUOTE_STATUSES } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { markDateUnavailable } from "@/lib/vendor-content";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (Number.isNaN(quoteId)) {
    return NextResponse.json({ error: "Invalid quote id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { status } = (body ?? {}) as Record<string, unknown>;
  if (typeof status !== "string" || !QUOTE_STATUSES.includes(status as (typeof QUOTE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Status must be one of: ${QUOTE_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const updated = await updateQuoteStatus(quoteId, session.userId, status as (typeof QUOTE_STATUSES)[number]);

  // Same reasoning as the vendor PATCH route: this is null whether the
  // quote doesn't exist or belongs to a listing this user doesn't own —
  // both get the same 404 rather than leaking which case it was.
  if (!updated) {
    return NextResponse.json(
      { error: "Quote request not found, or it wasn't sent to your listing." },
      { status: 404 }
    );
  }

  // A booked job blocks that date on the vendor's calendar.
  if (updated.status === "booked" && updated.event_date) {
    await markDateUnavailable(updated.vendor_id, updated.event_date);
  }

  if (updated.customer_id) {
    await notify(updated.customer_id, {
      type: "quote_status",
      title: `${updated.vendor_name} marked your request as ${updated.status}`,
      link: `/dashboard/quotes/${updated.id}`,
    });
  }

  return NextResponse.json({ quote: updated });
}
