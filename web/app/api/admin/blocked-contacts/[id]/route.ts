import { requireAdmin } from "@/app/api/_lib/auth";
import { parseId } from "@/app/api/_lib/validation";
import { adminJson, adminError, readJsonObject, parseReason } from "@/lib/admin/http";
import { clientIp } from "@/lib/admin/audit";
import { unblockContact } from "@/lib/admin/ops";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/admin/blocked-contacts/[id] { reason? }: unblock (audited).
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const id = parseId((await params).id);
  if (id === null) return adminJson({ error: "Invalid id." }, 400);
  const body = await readJsonObject(req);
  let reason: string | null = null;
  if (body?.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = parseReason(body.reason, { min: 1 });
    if (!reason) return adminJson({ error: "Reason must be 1000 characters or fewer.", field: "reason" }, 400);
  }
  try {
    const row = await unblockContact({ actorId: auth.userId, id, reason, ip: clientIp(req) });
    return adminJson({ ok: true, contact: row });
  } catch (err) {
    return adminError(err);
  }
}
