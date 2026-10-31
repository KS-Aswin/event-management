import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { invalidateTaxonomy, resolveCustom } from "@/lib/admin/taxonomy";

/**
 * Shared handler for POST /api/admin/custom-offerings and .../resolve:
 * {ids?, normalisedName?, action: "promote" | "merge" | "keep_private" | "reject",
 *  templateId? (merge), newTemplate?: {categoryId, name, allowedPriceUnits?, defaultPriceUnit?} (promote),
 *  reason? (required for reject)}.
 */
export async function handleResolve(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  const given = body.reason !== undefined && body.reason !== null && body.reason !== "";
  const reason = given ? parseReason(body.reason) : null;
  if (given && !reason) {
    return adminJson({ error: "The reason must be 3 to 1000 characters.", code: "REASON_REQUIRED" }, 400);
  }
  try {
    const result = await resolveCustom(body, { actorId: auth.userId, ip: clientIp(req), reason });
    if (result.template) invalidateTaxonomy();
    return adminJson({ ok: true, ...result });
  } catch (err) {
    return adminError(err);
  }
}
