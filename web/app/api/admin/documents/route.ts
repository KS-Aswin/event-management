import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson } from "@/lib/admin/http";
import { listDocumentQueue } from "@/lib/admin/documents";
import { parseDocTab } from "@/app/vendor/documents/doc-meta";

// GET /api/admin/documents?tab=pending|verified|rejected|expired&vendor=<id>&page=<n>
// (?status= is accepted as an alias of ?tab=)
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const sp = new URL(req.url).searchParams;
  const rawVendor = sp.get("vendor");
  let vendorId: number | null = null;
  if (rawVendor) {
    if (!/^\d{1,9}$/.test(rawVendor)) return adminJson({ field: "vendor", error: "Invalid vendor id." }, 400);
    vendorId = Number(rawVendor);
  }
  try {
    const queue = await listDocumentQueue({
      tab: parseDocTab(sp.get("tab") ?? sp.get("status")),
      vendorId,
      page: Number(sp.get("page")) || 1,
    });
    return adminJson(queue);
  } catch (err) {
    return adminError(err);
  }
}
