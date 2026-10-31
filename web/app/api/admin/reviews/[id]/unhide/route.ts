import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { unhideReview } from "@/lib/admin/moderation";

// POST /api/admin/reviews/[id]/unhide {reason?}: shows the review again and
// recomputes the rating. 409 if it is not hidden.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const reviewId = parseId((await params).id);
  if (reviewId === null) return adminJson({ error: "Invalid review id." }, 400);
  const body = (await readJsonObject(req)) ?? {};
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason);
    if (!reason) return adminJson({ field: "reason", error: "The note must be 3-1000 characters." }, 400);
  }
  try {
    return adminJson({ ok: true, ...(await unhideReview({ actorId: auth.userId, reviewId, reason, ip: clientIp(req) })) });
  } catch (err) {
    return adminError(err);
  }
}
