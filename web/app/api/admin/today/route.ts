import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson } from "@/lib/admin/http";

// Stub for the foundation (P1-1 guard tests); the Today agent replaces it
// with queue counts and oldest items (PRODUCT_PLAN 6 "Admin").
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  return adminJson({ ok: true, counts: {} });
}
