import { NextResponse } from "next/server";
import { requireVendor } from "@/lib/media/http";
import { getVendorEntitlements } from "@/lib/entitlements";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, videoUploadsEnabled } from "@/lib/media/config";
import {
  getMediaUsage,
  getVendorImageIds,
  listAlbums,
  listAssets,
  toClientAlbum,
  toClientAsset,
} from "@/lib/media/repo";

/** The caller's assets and albums, with usage against plan limits. */
export async function GET() {
  const ctx = await requireVendor();
  if (ctx instanceof NextResponse) return ctx;
  const vendorId = ctx.vendor.id;
  const [assets, albums, usage, ent, ids] = await Promise.all([
    listAssets(vendorId),
    listAlbums(vendorId),
    getMediaUsage(vendorId),
    getVendorEntitlements(vendorId),
    getVendorImageIds(vendorId),
  ]);
  return NextResponse.json({
    assets: assets.map(toClientAsset),
    albums: albums.map(toClientAlbum),
    logoMediaId: ids.logo_media_id,
    coverMediaId: ids.cover_media_id,
    usage,
    limits: {
      plan: ent.plan,
      images: ent.maxImages,
      albums: ent.maxAlbums,
      videoLinks: ent.maxVideoLinks,
      videoFiles: ent.maxVideoFiles,
    },
    videoUploadsEnabled: videoUploadsEnabled(),
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
  });
}
