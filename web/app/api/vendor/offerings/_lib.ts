// Shared helpers for /api/vendor/offerings/* and /api/vendor/packages/*.
import { NextResponse } from "next/server";
import {
  findOfferingRules,
  findOfferingsByVendor,
  findPackageItems,
  type OfferingRecord,
  type OfferingWriteResult,
  type PackageWriteResult,
} from "@/lib/db";
import { formatOfferingPrice, packageRules, parseOfferingBody, type OfferingRules } from "@/lib/offering-validation";

/** Hard cap on offerings per vendor (until plans carry a max_services limit). */
export const MAX_OFFERINGS = 100;

export function apiError(status: number, error: string, code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

export const notFound = () => apiError(404, "Not found.", "NOT_FOUND");

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseId(v: string): number | null {
  if (!/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 2147483647 ? n : null;
}

/** A draft unit was ticked in the wizard but has no price yet (inactive, price 0). */
export function needsPrice(o: Pick<OfferingRecord, "price_mode" | "price_from">): boolean {
  return o.price_mode !== "on_request" && !(o.price_from > 0);
}

export function toClientOffering(o: OfferingRecord) {
  return {
    ...o,
    price_label: needsPrice(o) ? "No price yet" : formatOfferingPrice(o),
    needs_price: needsPrice(o),
  };
}

export type ClientOffering = ReturnType<typeof toClientOffering>;

export async function listPayload(vendorId: number) {
  const offerings = await findOfferingsByVendor(vendorId, { includeInactive: true });
  const packageIds = offerings.filter((o) => o.kind === "package").map((o) => o.id);
  const packageItems = await findPackageItems(packageIds);
  return { offerings: offerings.map(toClientOffering), packageItems, limit: MAX_OFFERINGS };
}

export function writeError(r: Exclude<OfferingWriteResult | PackageWriteResult, { ok: true }>) {
  switch (r.reason) {
    case "not_found":
      return notFound();
    case "invalid_parent":
      return apiError(400, "Please choose one of your own offerings for this add-on.", "VALIDATION", {
        field: "parentServiceId",
      });
    case "invalid_items":
      return apiError(400, "A package can only contain your own offerings (not other packages).", "INVALID_ITEMS", {
        field: "items",
      });
    default:
      return apiError(400, "One of the values isn't allowed. Please check the form.", "VALIDATION");
  }
}
export async function rulesFor(o: OfferingRecord): Promise<OfferingRules | undefined> {
  if (o.kind === "package") return packageRules();
  const found =
    (await findOfferingRules({ categoryId: o.category_id, templateId: o.template_id })) ??
    (await findOfferingRules({ categoryId: o.category_id, templateId: null }));
  return found?.rules;
}

/** Parses a PATCH body for an existing unit / add-on / package (kind, category and template can't change). */
export async function parsePatch(o: OfferingRecord, body: Record<string, unknown>) {
  const input: Record<string, unknown> = { ...body };
  for (const k of ["kind", "categoryId", "templateId", "items", "draft"]) delete input[k];
  if (o.template_id) delete input.customName;
  const parsed = parseOfferingBody(input, {
    requireAll: false,
    rules: await rulesFor(o),
    existing: {
      kind: o.kind,
      price_mode: o.price_mode,
      price_from: o.price_from,
      price_to: o.price_to,
      price_unit: o.price_unit,
      min_qty: o.min_qty,
      max_qty: o.max_qty,
      guest_min: o.guest_min,
      guest_max: o.guest_max,
      sale_mode: o.sale_mode,
    },
  });
  if (!parsed.ok) return parsed;
  const f = parsed.fields;
  // A custom offering renamed without an explicit title keeps title = name.
  if (f.customName && body.title === undefined) f.title = f.customName;
  // Going live needs a price (wizard drafts are saved without one).
  const active = f.active ?? o.active;
  const mode = f.priceMode ?? o.price_mode;
  const from = f.priceFrom ?? o.price_from;
  if (active && mode !== "on_request" && !(from > 0)) {
    return { ok: false as const, field: "priceFrom", error: "Add a price before turning this offering on.", code: "VALIDATION" as const };
  }
  return parsed;
}

