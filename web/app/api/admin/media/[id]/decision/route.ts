import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { decideMedia, MEDIA_ACTIONS, MEDIA_REASON_REQUIRED, type MediaAction } from "@/lib/admin/moderation";

// POST /api/admin/media/[id]/decision {action: approve|reject|hide|remove, reason}
// reason is required for reject, hide and remove. 409 when already handled.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const mediaId = parseId((await params).id);
  if (mediaId === null) return adminJson({ error: "Invalid media id." }, 400);
  const body = await readJsonObject(req);
  if (!body) return adminJson({ error: "Invalid request body." }, 400);
  const action = body.action as MediaAction;
  if (!MEDIA_ACTIONS.includes(action)) {
    return adminJson({ field: "action", error: "Choose approve, reject, hide or remove." }, 400);
  }
  let reason: string | null = null;
  if (MEDIA_REASON_REQUIRED.includes(action)) {
    reason = parseReason(body.reason);
    if (!reason) return adminJson({ field: "reason", error: "Please give a reason (3-1000 characters)." }, 400);
  } else if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason);
    if (!reason) return adminJson({ field: "reason", error: "The note must be 3-1000 characters." }, 400);
  }
  try {
    const out = await decideMedia({ actorId: auth.userId, mediaId, action, reason, ip: clientIp(req) });
    return adminJson({ ok: true, ...out });
  } catch (err) {
    return adminError(err);
  }
}
