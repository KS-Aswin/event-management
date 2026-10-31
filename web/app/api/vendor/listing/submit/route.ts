import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { getOwnVendor, submitVendorListing } from "@/lib/db";
import { MISSING_MESSAGES, toClientListing } from "../_parse";

/**
 * POST /api/vendor/listing/submit: sends the caller's listing for review
 * (draft / changes_requested / rejected -> pending). Needs basics, a priced
 * separately-bookable offering or package, a logo or cover and 3+ photos;
 * otherwise 400 INCOMPLETE with what is missing. A pending listing is not public.
 */
export async function POST() {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return NextResponse.json({ error: "Create your listing first.", code: "NO_LISTING" }, { status: 404 });

  const r = await submitVendorListing(vendor.id, auth.userId);
  if (r.ok) return NextResponse.json({ listing: toClientListing(r.vendor) });
  if (r.reason === "incomplete") {
    return NextResponse.json(
      {
        error: "Your listing isn't ready to submit yet.",
        code: "INCOMPLETE",
        missing: r.missing,
        missingMessages: r.missing.map((m) => MISSING_MESSAGES[m] ?? m),
      },
      { status: 400 }
    );
  }
  if (r.reason === "wrong_status") {
    const msg =
      r.status === "pending"
        ? "Your listing is already under review."
        : r.status === "approved"
          ? "Your listing is already live."
          : "This listing can't be submitted right now. Please contact support.";
    return NextResponse.json({ error: msg, code: "WRONG_STATUS", status: r.status }, { status: 409 });
  }
  return NextResponse.json({ error: "Not found.", code: "NOT_FOUND" }, { status: 404 });
}
