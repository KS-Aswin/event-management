import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { adminJson, adminError, readJsonObject, parseReason } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { applyUserAction, getUserDetail, USER_ACTIONS, type UserAction } from "@/lib/admin/ops";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]: role, linked listing, activity, recent audit.
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return adminJson({ error: "Invalid user id." }, 400);
  try {
    const user = await getUserDetail(id);
    if (!user) return adminJson({ error: "User not found." }, 404);
    return adminJson({ user });
  } catch (err) {
    return adminError(err);
  }
}

// PATCH /api/admin/users/[id] { action: suspend | unsuspend | force_logout, reason }
// A reason (3..1000 chars) is required to suspend and optional otherwise.
// Acting on yourself and suspending the last active admin are 409.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return adminJson({ error: "Invalid user id." }, 400);
  const body = await readJsonObject(req);
  const action = body?.action;
  if (typeof action !== "string" || !USER_ACTIONS.includes(action as UserAction)) {
    return adminJson({ error: "Unknown action.", field: "action" }, 400);
  }
  let reason: string | null = null;
  if (action === "suspend") {
    reason = parseReason(body?.reason);
    if (!reason) return adminJson({ error: "Please give a reason (at least 3 characters).", field: "reason" }, 400);
  } else if (body?.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason, { min: 1 });
    if (!reason) return adminJson({ error: "Reason must be 1000 characters or fewer.", field: "reason" }, 400);
  }
  try {
    const result = await applyUserAction({
      actorId: auth.userId,
      targetId: id,
      action: action as UserAction,
      reason,
      ip: clientIp(req),
    });
    return adminJson({ ok: true, user: result });
  } catch (err) {
    return adminError(err);
  }
}
