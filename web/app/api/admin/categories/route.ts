import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { createCategory, invalidateTaxonomy, listCategories } from "@/lib/admin/taxonomy";

/** GET /api/admin/categories: every category (active first) with offering and template counts. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    return adminJson({ categories: await listCategories() });
  } catch (err) {
    return adminError(err);
  }
}

/** POST /api/admin/categories {displayName, slug?, icon?, allowedPriceUnits?, defaultPriceUnit?, allowOnRequest?, description?} */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Send a JSON object." }, 400);
  try {
    const category = await createCategory(body, { actorId: auth.userId, ip: clientIp(req) });
    invalidateTaxonomy();
    return adminJson({ category }, 201);
  } catch (err) {
    return adminError(err);
  }
}
