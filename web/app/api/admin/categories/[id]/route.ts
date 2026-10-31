import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { invalidateTaxonomy, parseRouteId, updateCategory } from "@/lib/admin/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/categories/:id {displayName?, icon?, description?, allowedPriceUnits?,
 * defaultPriceUnit?, allowOnRequest?, sortOrder?, active?}. Retiring (active:false)
 * a category that still has active offerings -> 409 CATEGORY_IN_USE with the count.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Category not found." }, 404);
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const category = await updateCategory(id, body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ category });
  } catch (err) {
    return adminError(err);
  }
}

/** DELETE /api/admin/categories/:id retires the category (same rules as PATCH {active:false}). */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Category not found." }, 404);
  try {
    const category = await updateCategory(id, { active: false }, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ category });
  } catch (err) {
    return adminError(err);
  }
}
