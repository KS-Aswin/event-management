import { requireAdmin } from "@/app/api/_lib/auth";
import { parseProfileBody } from "@/app/api/vendor/profile/validate";
import { clientIp } from "@/lib/admin/audit";
import { adminError, adminJson, readJsonObject } from "@/lib/admin/http";
import { HttpError } from "@/lib/admin/tx";
import { allowedActions, editVendor, getAdminVendorDetail } from "@/lib/admin/vendors";
import { isCheckViolation } from "@/lib/db";
import { routeId } from "./_id";

type Ctx = { params: Promise<{ id: string }> };

// GET: full detail. PATCH: edit fields on the vendor's behalf (P1-11, audited
// with before/after). Same validation as the vendor's own profile form, plus
// internal adminNotes.

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const detail = await getAdminVendorDetail(id);
    if (!detail) throw new HttpError(404, "Vendor not found.", "NOT_FOUND");
    return adminJson({ ...detail, actions: allowedActions(detail.vendor.status, !!detail.vendor.rereview_required) });
  } catch (err) {
    return adminError(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const id = routeId((await ctx.params).id);
    const body = await readJsonObject(req);
    if (!body) throw new HttpError(400, "Invalid request body.", "VALIDATION");
    const parsed = parseProfileBody(body);
    if (!parsed.ok) return adminJson({ error: parsed.error, code: parsed.code, field: parsed.field }, 400);
    const patch: Record<string, unknown> = { ...parsed.patch };
    delete patch.additionalCategoryIds;
    if ("adminNotes" in body) {
      const n = body.adminNotes;
      if (n !== null && typeof n !== "string") {
        return adminJson({ error: "Notes must be text.", code: "VALIDATION", field: "adminNotes" }, 400);
      }
      const s = typeof n === "string" ? n.trim() : "";
      if (s.length > 2000) {
        return adminJson({ error: "Notes can be at most 2000 characters.", code: "VALIDATION", field: "adminNotes" }, 400);
      }
      patch.adminNotes = s || null;
    }
    if (Object.keys(patch).length === 0) return adminJson({ error: "Nothing to change.", code: "VALIDATION" }, 400);
    const out = await editVendor(auth.userId, id, patch, clientIp(req));
    return adminJson({
      changed: out.changed,
      fields: out.fields,
      vendor: { id: out.vendor.id, name: out.vendor.name, status: out.vendor.status },
    });
  } catch (err) {
    if (isCheckViolation(err)) return adminJson({ error: "One of the values is out of range.", code: "VALIDATION" }, 400);
    return adminError(err);
  }
}
