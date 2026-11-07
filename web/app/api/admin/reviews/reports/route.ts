import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson } from "@/lib/admin/http";
import { listReviewQueue, parseReviewTab } from "@/lib/admin/moderation";

// GET /api/admin/reviews/reports?tab=open|hidden (P1-5): reported reviews
// with their open reports, or the hidden reviews (to unhide).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    return adminJson(await listReviewQueue(parseReviewTab(new URL(req.url).searchParams.get("tab"))));
  } catch (err) {
    return adminError(err);
  }
}
