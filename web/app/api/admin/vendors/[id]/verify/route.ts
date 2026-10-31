import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { setVendorVerified } from "@/lib/admin/vendors";
import { routeId } from "../_id";

type Ctx = { params: Promise<{ id: string }> };

// POST {verified: boolean}: grant or revoke the public "Verified business" badge.

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const body = await readJsonObject(req);
    if (!body || typeof body.verified !== "boolean") throw new HttpError(400, "Send {verified: true|false}.", "VALIDATION");
    const v = await setVendorVerified(auth.userId, id, body.verified, clientIp(req));
    return adminJson({ ok: true, vendor: { id: v.id, verified_at: v.verified_at ?? null } });
  } catch (err) {
    return adminError(err);
  }
}
