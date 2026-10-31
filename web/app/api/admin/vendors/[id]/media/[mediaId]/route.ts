import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { decideVendorMedia } from "@/lib/admin/vendors";
import { routeId } from "../../_id";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

// POST {action: "approve" | "reject", reason}: per-item decision from the
// vendor detail media strip (reject needs a reason; the vendor sees it).

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const p = await ctx.params;
    const id = routeId(p.id);
    const mediaId = routeId(p.mediaId);
    const body = await readJsonObject(req);
    if (!body || (body.action !== "approve" && body.action !== "reject")) {
      throw new HttpError(400, "Send {action: approve | reject}.", "VALIDATION");
    }
    const reason = body.action === "reject" ? parseReason(body.reason) : null;
    if (body.action === "reject" && !reason) {
      throw new HttpError(400, "Please give a reason (3 to 1000 characters).", "VALIDATION");
    }
    const out = await decideVendorMedia(auth.userId, id, mediaId, body.action, reason, clientIp(req));
    return adminJson({ ok: true, media: out });
  } catch (err) {
    return adminError(err);
  }
}
