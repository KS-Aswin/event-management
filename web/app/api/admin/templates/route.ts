import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { createTemplate, invalidateTaxonomy, listTemplates, parseRouteId } from "@/lib/admin/taxonomy";

/** GET /api/admin/templates[?categoryId=]: templates incl. retired, with offering counts. */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const categoryId = parseRouteId(new URL(req.url).searchParams.get("categoryId") ?? "") ?? undefined;
  try {
    return adminJson({ templates: await listTemplates(categoryId) });
  } catch (err) {
    return adminError(err);
  }
}

/** POST /api/admin/templates {categoryId, name, code?, kind?, allowedPriceUnits?, defaultPriceUnit?, allowOnRequest?, isCore?, attributeSchema?} */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const template = await createTemplate(body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ template }, 201);
  } catch (err) {
    return adminError(err);
  }
}
