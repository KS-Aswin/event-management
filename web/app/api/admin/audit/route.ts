import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError } from "@/lib/admin/http";
import { cleanAuditFilters, listAudit } from "@/lib/admin/ops";

// GET /api/admin/audit?action=&entity=&entityId=&actor=&page= : paged,
// newest first. The log is append-only (DB trigger), so there is no write route.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    return adminJson(await listAudit(cleanAuditFilters(sp)));
  } catch (err) {
    return adminError(err);
  }
}
