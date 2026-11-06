import { NextResponse } from "next/server";
import { findVendorById } from "@/lib/db";
import { createReviewV2 } from "@/lib/vendor-reviews";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLiveSession } from "../../../_lib/auth";
import { LIMITS, parseId } from "../../../_lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in to leave a review." }, { status: 401 });
  }

  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  // Reviews come from customers; vendor accounts can't review (competitors).
  if (session.role !== "customer") {
    return NextResponse.json(
      { error: "Only customer accounts can leave reviews." },
      { status: 403 }
    );
  }

  if (!checkRateLimit(`review:u:${session.userId}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { rating, body: reviewBody, enquiryId } = (body ?? {}) as Record<string, unknown>;

  const ratingNum = typeof rating === "number" ? rating : Number(String(rating));
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return NextResponse.json({ error: "Rating must be a whole number from 1 to 5." }, { status: 400 });
  }
  if (typeof reviewBody !== "string" || reviewBody.trim().length < 5) {
    return NextResponse.json(
      { error: "Please write at least a few words (5+ characters)." },
      { status: 400 }
    );
  }
  if (reviewBody.trim().length > LIMITS.reviewBody) {
    return NextResponse.json(
      { error: `Reviews can be up to ${LIMITS.reviewBody} characters.` },
      { status: 400 }
    );
  }

  // Optional: the enquiry this review is about (else the best match is used).
  let enquiryIdNum: number | null = null;
  if (enquiryId !== undefined && enquiryId !== null && enquiryId !== "") {
    const n = typeof enquiryId === "number" ? enquiryId : Number(String(enquiryId));
    if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
      return NextResponse.json({ error: "Invalid enquiry id.", code: "VALIDATION", field: "enquiryId" }, { status: 400 });
    }
    enquiryIdNum = n;
  }

  // Only publicly listed vendors can be reviewed.
  const vendor = await findVendorById(vendorId, { publicOnly: true });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  // Reviews v2 (P2-11): needs an enquiry to this vendor; verified only when
  // that enquiry is accepted/booked and the event date has passed.
  const result = await createReviewV2({
    vendorId,
    customerId: session.userId,
    reviewerName: session.name,
    rating: ratingNum,
    body: reviewBody.trim(),
    enquiryId: enquiryIdNum,
  });

  if (!result.ok) {
    if (result.reason === "vendor_not_found") {
      return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    }
    if (result.reason === "own_listing") {
      return NextResponse.json(
        { error: "You can't review your own listing." },
        { status: 403 }
      );
    }
    if (result.reason === "no_enquiry") {
      return NextResponse.json(
        { error: "You can review vendors you have sent an enquiry to through Vela.", code: "NO_ENQUIRY" },
        { status: 403 }
      );
    }
    if (result.reason === "enquiry_not_found") {
      return NextResponse.json(
        { error: "That enquiry wasn't sent to this vendor from your account.", code: "VALIDATION", field: "enquiryId" },
        { status: 400 }
      );
    }
    // already_reviewed
    return NextResponse.json(
      { error: "You've already reviewed this vendor." },
      { status: 409 }
    );
  }

  return NextResponse.json({ review: result.review }, { status: 201 });
}
