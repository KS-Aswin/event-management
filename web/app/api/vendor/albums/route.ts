import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError } from "@/lib/media/http";
import { albumDbError, albumLimitReached, parseAlbumInput } from "@/lib/media/albums";
import { createAlbum, listAlbums, toClientAlbum } from "@/lib/media/repo";

export async function GET() {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const albums = await listAlbums(ctx.vendor.id);
  return NextResponse.json({ albums: albums.map(toClientAlbum) });
}

export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "media-album", max: 60 });
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  const fields = await parseAlbumInput(ctx.vendor, body, true);
  if (fields instanceof NextResponse) return fields;
  const limited = await albumLimitReached(ctx.vendor);
  if (limited) return limited;
  try {
    const album = await createAlbum(ctx.vendor.id, { ...fields, title: fields.title! });
    return NextResponse.json({ album: toClientAlbum(album) }, { status: 201 });
  } catch (err) {
    return albumDbError(err);
  }
}
