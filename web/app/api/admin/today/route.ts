import { requireAdmin } from "@/app/api/_lib/auth";
import { adminJson, adminError } from "@/lib/admin/http";
import { getTodaySummary } from "@/lib/admin/ops";

// GET /api/admin/today: queue counts plus the oldest (or latest) item per
// tile, in one round of aggregate queries (P1-4).
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const summary = await getTodaySummary();
    const counts = Object.fromEntries(summary.tiles.map((t) => [t.key, t.count]));
    return adminJson({ ok: true, counts, tiles: summary.tiles, generatedAt: summary.generatedAt });
  } catch (err) {
    return adminError(err);
  }
}
