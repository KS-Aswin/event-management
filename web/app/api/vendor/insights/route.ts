import { requireRole } from "@/app/api/_lib/auth";
import { bad, json } from "@/app/api/_lib/thread-http";
import { getOwnVendor } from "@/lib/db";
import { getVendorInsights, parseRange } from "@/lib/insights";

// GET /api/vendor/insights?range=7|30|90 (default 30): the signed-in
// vendor's own views, WhatsApp clicks, enquiries and booked rate
// (PRODUCT_PLAN P2-14, section 6). Never takes a vendorId.
export async function GET(request: Request) {
  const auth = await requireRole("vendor");
  if (auth instanceof Response) return auth;
  const vendor = await getOwnVendor(auth.userId);
  if (!vendor) return json(404, { error: "Create your business listing first.", code: "NO_LISTING" });
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  if (range === null) return bad("range", "Range must be 7, 30 or 90 days.");
  return json(200, { insights: await getVendorInsights(vendor.id, range) });
}
