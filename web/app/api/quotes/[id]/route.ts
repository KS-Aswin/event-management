import { NextResponse } from "next/server";
import { getLiveSession } from "../../_lib/auth";
import { parseId } from "../../_lib/validation";
import { updateQuoteStatus, QUOTE_STATUSES } from "@/lib/db";

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

  return NextResponse.json({ quote: updated });
}
