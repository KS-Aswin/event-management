import { requireRole } from "@/app/api/_lib/auth";
import { json } from "@/app/api/_lib/thread-http";
import { listCustomerEnquiries } from "@/lib/enquiry-thread";

// GET /api/my/enquiries: every enquiry the signed-in user sent (customers,
// and vendors for enquiries they sent as a customer, PRODUCT_PLAN 9 #21),
// with vendor, units, latest offer and unread vendor messages. Only the
// caller's own rows (customer_id = session user).
export async function GET() {
  const auth = await requireRole(["customer", "vendor"]);
  if (auth instanceof Response) return auth;
  const enquiries = await listCustomerEnquiries(auth.userId);
  return json(200, { enquiries });
}
