import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson } from "@/lib/admin/http";
import { listMediaQueue, parseMediaTab } from "@/lib/admin/moderation";

// GET /api/admin/media?tab=pre|recent|reported&page=1 (P1-6).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    return adminJson(await listMediaQueue(parseMediaTab(url.searchParams.get("tab")), page));
  } catch (err) {
    return adminError(err);
  }
}
