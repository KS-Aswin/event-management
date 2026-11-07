import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import { createOffering, findOfferingRules, findTemplateCategoryId, pool } from "@/lib/db";
import { parseOfferingBody, type PriceUnit } from "@/lib/offering-validation";
import { MAX_OFFERINGS, apiError, listPayload, readBody, toClientOffering, writeError } from "./_lib";

/** GET: all of the caller's offerings (units, add-ons, packages incl. inactive) with package items. */
export async function GET() {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await listPayload(ctx.vendor.id));
}

/**
 * POST: create a unit or add-on from a template (`templateId`) or "Other"
 * (`customName` + `categoryId`, which also files a custom_offering_requests
 * row; phone numbers / links typed into the name are masked and flagged).
 *
 * `draft: true` (wizard step 2) saves a ticked unit before it has a price:
 * it is stored inactive with no price and goes live once priced.
 * Packages are created through POST /api/vendor/packages.
 */
export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (ctx instanceof NextResponse) return ctx;
  const vendorId = ctx.vendor.id;
  const body = await readBody(request);
  if (!body) return apiError(400, "Invalid request body.", "VALIDATION");

  const kind = body.kind ?? "unit";
  if (kind === "package") return apiError(400, "Create packages with /api/vendor/packages.", "VALIDATION", { field: "kind" });
  if (kind !== "unit" && kind !== "addon") return apiError(400, "Kind must be unit or addon.", "VALIDATION", { field: "kind" });

  const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM services WHERE vendor_id = $1", [vendorId]);
  if ((count.rows[0]?.n ?? 0) >= MAX_OFFERINGS) {
    return apiError(402, `You can list up to ${MAX_OFFERINGS} offerings.`, "PLAN_LIMIT");
  }

  // Category: a template's own category wins (an event company's photography
  // unit is listed under Photography).
  let categoryId: number | null = null;
  const rawTemplate = body.templateId;
  const templateId =
    typeof rawTemplate === "number" ? rawTemplate : typeof rawTemplate === "string" && /^\d+$/.test(rawTemplate) ? Number(rawTemplate) : null;
  if (rawTemplate !== undefined && rawTemplate !== null && rawTemplate !== "" && templateId === null) {
    return apiError(400, "Please choose a valid offering.", "VALIDATION", { field: "templateId" });
  }
  if (templateId) {
    categoryId = await findTemplateCategoryId(templateId);
    if (!categoryId) return apiError(400, "Please choose a valid offering.", "VALIDATION", { field: "templateId" });
  } else {
    const c = body.categoryId;
    categoryId = typeof c === "number" ? c : typeof c === "string" && /^\d+$/.test(c) ? Number(c) : null;
    if (!categoryId) return apiError(400, "Please choose a category.", "VALIDATION", { field: "categoryId" });
    if (typeof body.customName !== "string" || !body.customName.trim()) {
      return apiError(400, "Please choose an offering or pick Other and type a name.", "VALIDATION", { field: "customName" });
    }
  }
  const found = await findOfferingRules({ categoryId, templateId });
  if (!found) return apiError(400, "Please choose a valid offering.", "VALIDATION", { field: "templateId" });
  const { rules, template } = found;
  if (template && template.kind !== kind) {
    return apiError(
      400,
      template.kind === "addon" ? "This is an add-on: choose the offering it belongs to." : "This offering can't be an add-on.",
      "VALIDATION",
      { field: "kind" }
    );
  }

  const draft = body.draft === true && kind === "unit";
  const input: Record<string, unknown> = { ...body, kind, categoryId, templateId: templateId ?? null };
  delete input.draft;
  if (template && input.title === undefined && !input.customName) input.title = template.name;
  if (draft) {
    for (const k of ["priceMode", "priceFrom", "priceTo", "active"]) delete input[k];
  }

  const parsed = parseOfferingBody(input, { requireAll: !draft, rules });
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const f = parsed.fields;
  if (draft) {
    f.priceMode = "from";
    f.priceFrom = 0;
    f.priceTo = null;
    f.priceUnit = f.priceUnit ?? (rules.defaultPriceUnit as PriceUnit);
    f.active = false;
  }
  if (!f.title) return apiError(400, "Please enter a name for this offering.", "VALIDATION", { field: "title" });

  const r = await createOffering(vendorId, {
    ...f,
    categoryId,
    title: f.title,
    priceFrom: f.priceFrom ?? 0,
    priceUnit: f.priceUnit ?? (rules.defaultPriceUnit as PriceUnit),
  });
  if (!r.ok) return writeError(r);
  return NextResponse.json(
    { offering: toClientOffering(r.offering), customRequestId: r.customRequestId ?? null, flaggedContact: !!f.flaggedContact },
    { status: 201 }
  );
}
