import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { invalidateTaxonomy, parseRouteId, updateTemplate } from "@/lib/admin/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/templates/:id {name?, allowedPriceUnits?, defaultPriceUnit?, allowOnRequest?,
 * isCore?, sortOrder?, attributeSchema?, active?}. Renaming/removing (or retyping) an
 * attribute key while offerings use the template -> 409 KEY_IN_USE. Retiring keeps
 * existing offerings working; vendors can no longer pick it for new ones.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Template not found." }, 404);
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const template = await updateTemplate(id, body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ template });
  } catch (err) {
    return adminError(err);
  }
}

/** DELETE /api/admin/templates/:id retires the template (active=false). */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Template not found." }, 404);
  try {
    const template = await updateTemplate(id, { active: false }, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ template });
  } catch (err) {
    return adminError(err);
  }
}
