import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import { findOwnOffering, findPackageItems, removeOffering, updatePackage, type OfferingRecord } from "@/lib/db";
import { parsePackageItems } from "@/lib/offering-validation";
import { apiError, notFound, parseId, parsePatch, readBody, toClientOffering, writeError } from "../../offerings/_lib";

type Ctx = { params: Promise<{ id: string }> };

async function loadPackage(ctx: Ctx, vendorId: number): Promise<OfferingRecord | null> {
  const id = parseId((await ctx.params).id);
  if (!id) return null;
  const o = await findOwnOffering(vendorId, id);
  return o && o.kind === "package" ? o : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const v = await requireVendor();
  if (v instanceof NextResponse) return v;
  const o = await loadPackage(ctx, v.vendor.id);
  if (!o) return notFound();
  return NextResponse.json({ offering: toClientOffering(o), items: await findPackageItems([o.id]) });
}

/** Update a package's fields; `items` (when sent) replaces the whole item list. */
export async function PATCH(request: Request, ctx: Ctx) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const o = await loadPackage(ctx, v.vendor.id);
  if (!o) return notFound();
  const body = await readBody(request);
  if (!body) return apiError(400, "Invalid request body.", "VALIDATION");
  let items;
  if (body.items !== undefined) {
    const p = parsePackageItems(body.items);
    if (!p.ok) return NextResponse.json(p, { status: 400 });
    items = p.items;
  }
  const parsed = await parsePatch(o, body);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const r = await updatePackage(v.vendor.id, o.id, parsed.fields, items);
  if (!r.ok) return writeError(r);
  return NextResponse.json({ offering: toClientOffering(r.offering), items: r.items });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const v = await requireVendor({ rateKey: "offerings-write", max: 300 });
  if (v instanceof NextResponse) return v;
  const o = await loadPackage(ctx, v.vendor.id);
  if (!o) return notFound();
  const r = await removeOffering(v.vendor.id, o.id);
  if (!r.ok) return notFound();
  return NextResponse.json({ ok: true, mode: r.mode });
}
