import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { setVendorVerified } from "@/lib/admin/vendors";
import { routeId } from "../_id";

type Ctx = { params: Promise<{ id: string }> };

// POST {verified: boolean, reason?: string}: grant or revoke the public
// "Verified business" badge. The optional reason (QA-107) goes to the audit
// row and, on removal, to the vendor's notification.

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const body = await readJsonObject(req);
    if (!body || typeof body.verified !== "boolean") throw new HttpError(400, "Send {verified: true|false}.", "VALIDATION");
    let reason: string | null = null;
    if (typeof body.reason === "string" && body.reason.trim() !== "") {
      reason = parseReason(body.reason);
      if (!reason) throw new HttpError(400, "The reason must be 3 to 1000 characters.", "VALIDATION");
    }
    const v = await setVendorVerified(auth.userId, id, body.verified, clientIp(req), reason);
    return adminJson({ ok: true, vendor: { id: v.id, verified_at: v.verified_at ?? null } });
  } catch (err) {
    return adminError(err);
  }
}
