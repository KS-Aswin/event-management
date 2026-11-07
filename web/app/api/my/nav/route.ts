import { requireRole } from "@/app/api/_lib/auth";
import { json } from "@/app/api/_lib/thread-http";
import { navCounts } from "@/lib/customer-home";

// GET /api/my/nav: badge counts for the customer header and bottom bar
// (PRODUCT_PLAN 2.7): `enquiries` = unread vendor replies + offers waiting
// for an answer, `shortlist` = saved vendors. Customers only.
export async function GET() {
  const auth = await requireRole("customer");
  if (auth instanceof Response) return auth;
  return json(200, { ...(await navCounts(auth.userId)) });
}
