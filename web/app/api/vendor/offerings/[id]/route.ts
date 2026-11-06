import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import {
  findOwnOffering,
  findPackageItems,
  removeOffering,
  updateOffering,
  updatePackage,
  type OfferingRecord,
} from "@/lib/db";
import { checkOfferingMinimum } from "@/lib/offering-minimum";
import { apiError, notFound, parseId, parsePatch, readBody, toClientOffering, writeError } from "../_lib";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx, vendorId: number): Promise<OfferingRecord | null> {
  const id = parseId((await ctx.params).id);
  return id ? findOwnOffering(vendorId, id) : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const v = await requireVendor();
  if (v instanceof NextResponse) return v;
  const o = await load(ctx, v.vendor.id);
  if (!o) return notFound();
  const items = o.kind === "package" ? await findPackageItems([o.id]) : [];
  return NextResponse.json({ offering: toClientOffering(o), items });
}

/** Edit, activate or deactivate. Deactivating a unit marks packages containing it incomplete. */
export async function PATCH(request: Request, ctx: Ctx) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const o = await load(ctx, v.vendor.id);
  if (!o) return notFound();
  const body = await readBody(request);
  if (!body) return apiError(400, "Invalid request body.", "VALIDATION");
  const parsed = await parsePatch(o, body);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const f = parsed.fields;
  const blocked = await checkOfferingMinimum(v.vendor, {
    kind: "patch",
    id: o.id,
    active: f.active,
    saleMode: f.saleMode,
    priceMode: f.priceMode,
    priceFrom: f.priceFrom,
  });
  if (blocked) return apiError(409, blocked, "LISTING_MINIMUM", { missing: "offering" });

  if (o.kind === "package") {
    const r = await updatePackage(v.vendor.id, o.id, parsed.fields);
    if (!r.ok) return writeError(r);
    return NextResponse.json({ offering: toClientOffering(r.offering), items: r.items });
  }
  const r = await updateOffering(v.vendor.id, o.id, parsed.fields);
  if (!r.ok) return writeError(r);
  return NextResponse.json({ offering: toClientOffering(r.offering) });
}

/** Deletes the offering, or deactivates it when enquiries refer to it. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const o = await load(ctx, v.vendor.id);
  if (!o) return notFound();
  const blocked = await checkOfferingMinimum(v.vendor, { kind: "remove", id: o.id });
  if (blocked) return apiError(409, blocked, "LISTING_MINIMUM", { missing: "offering" });
  const r = await removeOffering(v.vendor.id, o.id);
  if (!r.ok) return notFound();
  return NextResponse.json({ ok: true, mode: r.mode });
}
