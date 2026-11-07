import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson } from "@/lib/admin/http";
import { CUSTOM_STATUSES, listCustomGroups, type CustomStatus } from "@/lib/admin/taxonomy";
import { handleResolve } from "./_resolve";

/**
 * GET /api/admin/custom-offerings[?status=pending]: custom "Other" requests
 * grouped by normalised name, most vendors first, with sample vendors.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const s = new URL(req.url).searchParams.get("status") ?? "pending";
  if (!(CUSTOM_STATUSES as readonly string[]).includes(s)) return adminJson({ error: "Unknown status." }, 400);
  try {
    return adminJson({ groups: await listCustomGroups(s as CustomStatus) });
  } catch (err) {
    return adminError(err);
  }
}

/** POST /api/admin/custom-offerings: same as /resolve. */
export async function POST(req: Request) {
  return handleResolve(req);
}
