import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { invalidateTaxonomy, reorderTaxonomy } from "@/lib/admin/taxonomy";

/**
 * POST /api/admin/taxonomy/reorder {kind: "categories" | "templates" | "event-types",
 * ids: number[] (the whole list in its new order), categoryId? (templates only)}.
 * Renumbers sort_order 1..n in one transaction (QA-049). A list that no longer
 * matches the current set of ids -> 409 STALE.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const out = await reorderTaxonomy(body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ ok: true, ...out });
  } catch (err) {
    return adminError(err);
  }
}
