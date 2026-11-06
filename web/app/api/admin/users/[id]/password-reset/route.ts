import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { adminJson, adminError, readJsonObject, parseReason } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { createResetLink } from "@/lib/password-reset";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/users/[id]/password-reset { reason? } -> { url, path, expiresAt }
// QA-007: a one-time, expiring password reset link the admin passes on to a
// user who proved who they are (no email provider yet). Audit-logged
// (user.password_reset_link); the token is shown only in this response.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return adminJson({ error: "Invalid user id." }, 400);
  const body = (await readJsonObject(req)) ?? {};
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason, { min: 1 });
    if (!reason) return adminJson({ error: "Note must be 1000 characters or fewer.", field: "reason" }, 400);
  }
  try {
    const link = await createResetLink({ actorId: auth.userId, targetId: id, reason, ip: clientIp(req) });
    const origin = new URL(req.url).origin;
    return adminJson({ url: `${origin}${link.path}`, path: link.path, expiresAt: link.expiresAt }, 201);
  } catch (err) {
    return adminError(err);
  }
}
