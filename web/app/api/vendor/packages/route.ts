import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import { createPackage, findCategoryById, findOfferingsByVendor, findPackageItems, pool } from "@/lib/db";
import { packageRules, parseOfferingBody, parsePackageItems } from "@/lib/offering-validation";
import { MAX_OFFERINGS, apiError, readBody, toClientOffering, writeError } from "../offerings/_lib";

/** GET: the caller's packages with their items. */
export async function GET() {
  const v = await requireVendor();
  if (v instanceof NextResponse) return v;
  const packages = await findOfferingsByVendor(v.vendor.id, { includeInactive: true, kind: "package" });
  const items = await findPackageItems(packages.map((p) => p.id));
  return NextResponse.json({ packages: packages.map(toClientOffering), items });
}

/**
 * POST: create a package from the caller's own units:
 * {title, description?, priceMode, priceFrom, priceTo?, priceUnit?, guestMin?, guestMax?,
 *  inclusions?, eventTypeIds?, categoryId?, items:[{serviceId, qty, note}]}.
 * Items from another vendor (or other packages) -> 400 INVALID_ITEMS.
 */
export async function POST(request: Request) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const body = await readBody(request);
  if (!body) return apiError(400, "Invalid request body.", "VALIDATION");

  const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM services WHERE vendor_id = $1", [v.vendor.id]);
  if ((count.rows[0]?.n ?? 0) >= MAX_OFFERINGS) {
    return apiError(402, `You can list up to ${MAX_OFFERINGS} offerings.`, "PLAN_LIMIT");
  }

  const items = parsePackageItems(body.items);
  if (!items.ok) return NextResponse.json(items, { status: 400 });
  const input: Record<string, unknown> = { ...body, kind: "package" };
  for (const k of ["items", "templateId", "customName", "parentServiceId", "saleMode"]) delete input[k];
  const parsed = parseOfferingBody(input, { requireAll: true, rules: packageRules() });
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const f = parsed.fields;
  if (f.categoryId !== undefined) {
    const c = await findCategoryById(f.categoryId);
    if (!c || !c.active) return apiError(400, "Please choose a category.", "VALIDATION", { field: "categoryId" });
  }
  const r = await createPackage(v.vendor.id, { ...f, title: f.title! }, items.items);
  if (!r.ok) return writeError(r);
  return NextResponse.json({ offering: toClientOffering(r.offering), items: r.items }, { status: 201 });
}
