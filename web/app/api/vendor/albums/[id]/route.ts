import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError, notFound, parsePositiveInt } from "@/lib/media/http";
import { albumDbError, parseAlbumInput } from "@/lib/media/albums";
import { deleteAlbum, findAlbum, toClientAlbum, updateAlbum } from "@/lib/media/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const album = await findAlbum(ctx.vendor.id, id);
  if (!album) return notFound();
  return NextResponse.json({ album: toClientAlbum(album) });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  if (!(await findAlbum(ctx.vendor.id, id))) return notFound();
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  const fields = await parseAlbumInput(ctx.vendor, body, false);
  if (fields instanceof NextResponse) return fields;
  try {
    const album = await updateAlbum(ctx.vendor.id, id, fields);
    if (!album) return notFound();
    return NextResponse.json({ album: toClientAlbum(album) });
  } catch (err) {
    return albumDbError(err);
  }
}

/** Deletes the album only; its photos stay in the gallery. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const id = parsePositiveInt((await params).id);
  if (id === null) return notFound();
  const ok = await deleteAlbum(ctx.vendor.id, id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
