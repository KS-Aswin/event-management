import { requireAdmin } from "@/app/api/_lib/auth";
import { adminError, adminJson } from "@/lib/admin/http";
import { countVendorTabs, listAdminVendors, parseVendorTab } from "@/lib/admin/vendors";

// GET /api/admin/vendors?status=pending|rereview|...|all&q=&district=&category=&page=
// Queue and search with duplicate hints (PRODUCT_PLAN 6 "Admin").

function posInt(v: string | null): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  try {
    const sp = new URL(req.url).searchParams;
    const tab = parseVendorTab(sp.get("status") ?? "pending");
    const page = posInt(sp.get("page")) ?? 1;
    const limit = Math.min(posInt(sp.get("limit")) ?? 50, 100);
    const [list, counts] = await Promise.all([
      listAdminVendors({
        tab,
        q: sp.get("q") ?? undefined,
        districtId: posInt(sp.get("district")),
        categoryId: posInt(sp.get("category")),
        limit,
        offset: (page - 1) * limit,
      }),
      countVendorTabs(),
    ]);
    return adminJson({ status: tab, page, limit, total: list.total, counts, vendors: list.rows });
  } catch (err) {
    return adminError(err);
  }
}
