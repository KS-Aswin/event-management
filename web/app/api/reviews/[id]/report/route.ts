import { NextResponse } from "next/server";
import { reportReview, REVIEW_REPORT_REASON_MAX } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLiveSession } from "../../../_lib/auth";
import { parseId } from "../../../_lib/validation";

// Stores a report about a review for admin follow-up (EM-106).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in to report a review." }, { status: 401 });
  }

  const { id } = await params;
  const reviewId = parseId(id);
  if (reviewId === null) {
    return NextResponse.json({ error: "Invalid review id." }, { status: 400 });
  }

  if (!checkRateLimit(`report:u:${session.userId}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > REVIEW_REPORT_REASON_MAX) {
    return NextResponse.json(
      { field: "reason", error: `Please say briefly what is wrong (3-${REVIEW_REPORT_REASON_MAX} characters).` },
      { status: 400 }
    );
  }

  const result = await reportReview({ reviewId, reporterId: session.userId, reason: reason.trim() });
  if (result === "not_found") {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }
  if (result === "already_reported") {
    return NextResponse.json({ error: "You've already reported this review." }, { status: 409 });
  }
  return NextResponse.json({ reported: true }, { status: 201 });
}
