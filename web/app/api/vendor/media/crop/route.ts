import { NextResponse } from "next/server";
import { apiError, readJson, requireVendor } from "@/lib/media/http";
import { cropVendorImage } from "@/lib/media/pipeline";

/**
 * POST {which: "logo"|"cover", mediaId, crop: {x, y, width, height}} with the
 * crop as fractions (0..1) of the photo. Makes a square / 16:9 version with
 * sharp and sets it as the vendor's logo or cover (P0-7).
 */
export async function POST(request: Request) {
  const ctx = await requireVendor({ rateKey: "media-crop", max: 30 });
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  if (body.which !== "logo" && body.which !== "cover") {
    return apiError(400, 'which must be "logo" or "cover".', "VALIDATION");
  }
  const r = await cropVendorImage(ctx.vendor, body.which, body);
  return NextResponse.json(r.body, { status: r.status });
}
