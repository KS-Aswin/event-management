import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError } from "@/lib/admin/http";
import { cleanUserFilters, searchUsers } from "@/lib/admin/ops";

// GET /api/admin/users?q=&role=&status=&joined=7d|30d&page= (P1-9)
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    return adminJson(await searchUsers(cleanUserFilters(sp)));
  } catch (err) {
    return adminError(err);
  }
}
