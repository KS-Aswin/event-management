import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { invalidateTaxonomy, parseRouteId, updateEventType } from "@/lib/admin/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/event-types/:id {name?, community?, sortOrder?, active?, categories?: [{categoryId, isCore}]} (categories replaces the bundle). */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Event type not found." }, 404);
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const eventType = await updateEventType(id, body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ eventType });
  } catch (err) {
    return adminError(err);
  }
}

/** DELETE /api/admin/event-types/:id retires the event type (enquiries keep their reference). */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseRouteId((await ctx.params).id);
  if (!id) return adminJson({ error: "Event type not found." }, 404);
  try {
    const eventType = await updateEventType(id, { active: false }, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ eventType });
  } catch (err) {
    return adminError(err);
  }
}
