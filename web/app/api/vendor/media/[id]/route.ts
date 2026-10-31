import { NextResponse } from "next/server";
import {
  requireVendor,
  notFound,
  parsePositiveInt,
  readJson,
  apiError,
  optionalId,
  cleanText,
} from "@/lib/media/http";
import { removeAsset } from "@/lib/media/pipeline";
import {
  albumBelongsTo,
  findAsset,
  serviceBelongsTo,
  toClientAsset,
  updateAssetFields,
} from "@/lib/media/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const row = await findAsset(ctx.vendor.id, id);
  if (!row) return notFound();
  return NextResponse.json({ asset: toClientAsset(row) });
}

/**
 * Edit caption, alt text, album, offering, featured, order, poster, or
 * hide/unhide ({hidden:true|false}). Moderation states set by admins
 * (rejected, pending_review) can't be changed here.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const row = await findAsset(ctx.vendor.id, id);
  if (!row || row.status === "uploading") return notFound();
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");

  const fields: Parameters<typeof updateAssetFields>[2] = {};
  if (body.caption !== undefined) {
    const c = cleanText(body.caption, 300);
    if (c === null) return apiError(400, "Captions can be at most 300 characters.", "VALIDATION");
    fields.caption = c;
  }
  if (body.altText !== undefined) {
    const a = cleanText(body.altText, 200);
    if (a === null) return apiError(400, "Alt text can be at most 200 characters.", "VALIDATION");
    fields.alt_text = a;
  }
  const albumId = optionalId(body.albumId);
  if (albumId === "invalid") return apiError(400, "Invalid album.", "VALIDATION");
  if (typeof albumId === "number" && !(await albumBelongsTo(ctx.vendor.id, albumId))) {
    return apiError(404, "Album not found.", "NOT_FOUND");
  }
  if (albumId !== undefined) fields.album_id = albumId;
  const serviceId = optionalId(body.serviceId);
  if (serviceId === "invalid") return apiError(400, "Invalid offering.", "VALIDATION");
  if (typeof serviceId === "number" && !(await serviceBelongsTo(ctx.vendor.id, serviceId))) {
    return apiError(404, "Offering not found.", "NOT_FOUND");
  }
  if (serviceId !== undefined) fields.service_id = serviceId;
  if (body.isFeatured !== undefined) {
    if (typeof body.isFeatured !== "boolean") {
      return apiError(400, "isFeatured must be true or false.", "VALIDATION");
    }
    fields.is_featured = body.isFeatured;
  }
  if (body.sortOrder !== undefined) {
    const n = body.sortOrder;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return apiError(400, "Invalid sort order.", "VALIDATION");
    }
    fields.sort_order = n;
  }
  if (body.posterMediaId !== undefined) {
    if (row.kind !== "video_file") return apiError(400, "Only uploaded videos have a poster.", "VALIDATION");
    const p = optionalId(body.posterMediaId);
    if (p === "invalid") return apiError(400, "Invalid poster.", "VALIDATION");
    if (typeof p === "number") {
      const poster = await findAsset(ctx.vendor.id, p);
      if (!poster || poster.kind !== "image" || p === id) return apiError(404, "Poster not found.", "NOT_FOUND");
    }
    fields.poster_media_id = p;
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== "boolean") return apiError(400, "hidden must be true or false.", "VALIDATION");
    if (body.hidden && row.status === "approved") fields.status = "hidden";
    if (!body.hidden && row.status === "hidden") {
      if (row.status_reason === "plan_limit") {
        return apiError(402, "This item is hidden because of your plan limit.", "PLAN_LIMIT", { limit: "images" });
      }
      fields.status = "approved";
    }
  }
  const updated = await updateAssetFields(ctx.vendor.id, id, fields);
  if (!updated) return notFound();
  return NextResponse.json({ asset: toClientAsset(updated) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const r = await removeAsset(ctx.vendor, id);
  return NextResponse.json(r.body, { status: r.status });
}
