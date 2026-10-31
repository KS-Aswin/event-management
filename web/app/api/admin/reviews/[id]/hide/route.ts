import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { hideReview } from "@/lib/admin/moderation";

// POST /api/admin/reviews/[id]/hide {reason}: hides the review, actions its
// open reports and recomputes the vendor's rating. 409 if already hidden.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const reviewId = parseId((await params).id);
  if (reviewId === null) return adminJson({ error: "Invalid review id." }, 400);
  const body = await readJsonObject(req);
  const reason = parseReason(body?.reason);
  if (!reason) return adminJson({ field: "reason", error: "Please give a reason (3-1000 characters)." }, 400);
  try {
    return adminJson({ ok: true, ...(await hideReview({ actorId: auth.userId, reviewId, reason, ip: clientIp(req) })) });
  } catch (err) {
    return adminError(err);
  }
}
