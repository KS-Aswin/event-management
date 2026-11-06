import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError } from "@/lib/admin/http";
import { getAnalytics, parseRange } from "@/lib/admin/analytics";

// GET /api/admin/analytics?days=7|30|90: the same aggregates the
// /admin/analytics page shows (P1-12). Read-only, admin only.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const days = parseRange(new URL(req.url).searchParams.get("days"));
    return adminJson({ ok: true, ...(await getAnalytics(days)) });
  } catch (err) {
    return adminError(err);
  }
}
