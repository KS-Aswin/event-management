import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { createEventType, invalidateTaxonomy, listEventTypes } from "@/lib/admin/taxonomy";

/** GET /api/admin/event-types: every event type (incl. retired) with its "what you need" bundle. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    return adminJson({ eventTypes: await listEventTypes() });
  } catch (err) {
    return adminError(err);
  }
}

/** POST /api/admin/event-types {name, slug?, community?, categories?: [{categoryId, isCore}]} */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const eventType = await createEventType(body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ eventType }, 201);
  } catch (err) {
    return adminError(err);
  }
}
