import { NextResponse } from "next/server";
import { requireRole } from "@/app/api/_lib/auth";
import { findVendorHomeStats, getOwnVendor } from "@/lib/db";
import { profileStrength } from "@/app/vendor/profile-strength";

// Vendor home aggregates (PRODUCT_PLAN P0-12): status, profile strength,
// new leads, upcoming bookings, 7-day stats. Only the vendor's own business
// data: no customer favourites or "my requests" are queried or returned.

export async function GET() {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) {
    return NextResponse.json({ error: "Create your business listing first.", code: "NO_LISTING" }, { status: 404 });
  }
  const stats = await findVendorHomeStats(vendor.id);
  if (!stats) return NextResponse.json({ error: "Not found.", code: "NOT_FOUND" }, { status: 404 });
  const strength = profileStrength(stats, vendor.about ?? "");
  return NextResponse.json(
    { home: { ...stats, strength: { percent: strength.percent, items: strength.items } } },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
