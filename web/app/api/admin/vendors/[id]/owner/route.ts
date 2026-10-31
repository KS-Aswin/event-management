import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { assignVendorOwner } from "@/lib/admin/vendors";
import { routeId } from "../_id";

type Ctx = { params: Promise<{ id: string }> };

// POST {userId} or {email}: assign an unowned (seeded) listing to a vendor
// account that has no listing yet (claim, P1-11). 409 if it already owns one.

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const body = await readJsonObject(req);
    if (!body) throw new HttpError(400, "Invalid request body.", "VALIDATION");
    const userId = Number(body.userId);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const target =
      Number.isInteger(userId) && userId > 0
        ? { userId }
        : email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          ? { email }
          : null;
    if (!target) throw new HttpError(400, "Enter the vendor account's email.", "VALIDATION");
    const out = await assignVendorOwner(auth.userId, id, target, clientIp(req));
    return adminJson({ ok: true, vendor: { id: out.vendor.id, owner_id: out.vendor.owner_id }, owner: out.owner });
  } catch (err) {
    return adminError(err);
  }
}
