import { requireAdmin } from "@/app/api/_lib/auth";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, parseReason, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { assignVendorOwner, searchClaimCandidates } from "@/lib/admin/vendors";
import { routeId } from "../_id";

type Ctx = { params: Promise<{ id: string }> };

// GET ?q=: vendor accounts that could claim this listing (active, role
// vendor, no listing yet), searched by name, email or phone.
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    routeId((await ctx.params).id);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const users = await searchClaimCandidates(q);
    return adminJson({ users });
  } catch (err) {
    return adminError(err);
  }
}

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
    let reason: string | null = null;
    if (typeof body.reason === "string" && body.reason.trim() !== "") {
      reason = parseReason(body.reason);
      if (!reason) throw new HttpError(400, "The note must be 3 to 1000 characters.", "VALIDATION");
    }
    const out = await assignVendorOwner(auth.userId, id, target, clientIp(req), reason);
    return adminJson({ ok: true, vendor: { id: out.vendor.id, owner_id: out.vendor.owner_id }, owner: out.owner });
  } catch (err) {
    return adminError(err);
  }
}
