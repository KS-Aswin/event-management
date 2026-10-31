import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { DECISION_ACTIONS, REASON_REQUIRED, decideVendor, type DecisionAction } from "@/lib/admin/vendors";
import { VENDOR_STATUSES, type VendorStatus } from "@/lib/db";
import { routeId } from "../_id";

type Ctx = { params: Promise<{ id: string }> };

// POST {action, reason?, expectedStatus?}: approve / request_changes / reject /
// suspend / unsuspend / clear_rereview. Optimistic: a listing whose status is
// no longer expectedStatus (or can't take this action) -> 409 "already handled".

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const body = await readJsonObject(req);
    if (!body) throw new HttpError(400, "Invalid request body.", "VALIDATION");
    const action = body.action as DecisionAction;
    if (!DECISION_ACTIONS.includes(action)) throw new HttpError(400, "Unknown action.", "VALIDATION");
    let reason: string | null = null;
    if (typeof body.reason === "string" && body.reason.trim() !== "") {
      reason = parseReason(body.reason);
      if (!reason) throw new HttpError(400, "The reason must be 3 to 1000 characters.", "VALIDATION");
    }
    if (REASON_REQUIRED[action] && !reason) {
      throw new HttpError(400, "Please give a reason (3 to 1000 characters).", "VALIDATION");
    }
    let expectedStatus: VendorStatus | null = null;
    if (body.expectedStatus !== undefined && body.expectedStatus !== null) {
      if (!VENDOR_STATUSES.includes(body.expectedStatus as VendorStatus)) {
        throw new HttpError(400, "Invalid expectedStatus.", "VALIDATION");
      }
      expectedStatus = body.expectedStatus as VendorStatus;
    }
    const out = await decideVendor({ actorId: auth.userId, vendorId: id, action, reason, expectedStatus, ip: clientIp(req) });
    return adminJson({
      ok: true,
      vendor: { id: out.vendor.id, status: out.vendor.status, status_reason: out.vendor.status_reason ?? null },
      from: out.from,
      to: out.to,
      approvedMedia: out.approvedMedia,
      ownerSuspended: out.ownerSuspended,
      ownerRestored: out.ownerRestored,
    });
  } catch (err) {
    return adminError(err);
  }
}
