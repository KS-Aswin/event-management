import { NextResponse } from "next/server";
import { requireVendor, readJson, apiError, optionalId } from "./http";
import { assetUrls, findAsset, setVendorImage } from "./repo";

/** Shared handler for PUT /api/vendor/media/logo and /api/vendor/media/cover. */
export async function setVendorImageRoute(request: Request, which: "logo" | "cover") {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(request);
  if (!body) return apiError(400, "Invalid JSON body.", "VALIDATION");
  const mediaId = optionalId(body.mediaId);
  if (mediaId === "invalid" || mediaId === undefined) {
    return apiError(400, "mediaId is required (null clears it).", "VALIDATION");
  }
  if (mediaId === null) {
    await setVendorImage(ctx.vendor.id, which, null, null);
    return NextResponse.json({ ok: true, mediaId: null, url: null });
  }
  const row = await findAsset(ctx.vendor.id, mediaId);
  if (!row || row.kind !== "image" || row.status === "uploading") {
    return apiError(404, "Not found.", "NOT_FOUND");
  }
  if (row.status === "rejected") return apiError(400, "A rejected photo can't be used here.", "VALIDATION");
  const urls = assetUrls(row);
  const url = which === "logo" ? urls.card ?? urls.full ?? null : urls.full ?? null;
  await setVendorImage(ctx.vendor.id, which, row.id, url);
  return NextResponse.json({ ok: true, mediaId: row.id, url });
}
