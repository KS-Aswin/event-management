// QA-044: once a listing is live (approved), a vendor can't remove media
// below the submission minimum (findListingMissing in
// lib/db.ts): at least SUBMIT_MIN_IMAGES portfolio photos and a logo or cover.
// Each check is about the one change asked for, so a listing that is already
// short (e.g. an admin rejected a photo) can still be edited in other ways.
// A listing under review (pending) isn't blocked: the vendor home warns
// instead, and the reviewer sees what is missing before approving.

import { pool, SUBMIT_MIN_IMAGES } from "@/lib/db";
import { apiError } from "./http";
import type { VendorRef } from "./repo";

/** Listings customers can see. */
const GUARDED = new Set(["approved"]);

export type MinimumChange =
  | { kind: "remove_asset"; assetId: number } // DELETE, or hiding it from the profile
  | { kind: "clear_role"; role: "logo" | "cover" };

/**
 * Returns a 409 response when the change would leave a live listing below
 * the minimum, else null.
 */
export async function guardListingMinimum(vendor: VendorRef, change: MinimumChange) {
  if (!GUARDED.has(vendor.status)) return null;
  const r = await pool.query<{
    logo_media_id: number | null;
    cover_media_id: number | null;
    logo_url: string | null;
    cover_image_url: string | null;
    photos: number;
    counted: boolean;
  }>(
    `SELECT v.logo_media_id, v.cover_media_id, v.logo_url, v.cover_image_url,
            (SELECT COUNT(*)::int FROM media_assets m WHERE m.vendor_id = v.id AND m.kind = 'image'
               AND m.purpose = 'gallery' AND m.status IN ('pending_review','approved')) AS photos,
            EXISTS (SELECT 1 FROM media_assets m WHERE m.vendor_id = v.id AND m.id = $2 AND m.kind = 'image'
               AND m.purpose = 'gallery' AND m.status IN ('pending_review','approved')) AS counted
     FROM vendors v WHERE v.id = $1`,
    [vendor.id, change.kind === "remove_asset" ? change.assetId : null]
  );
  const v = r.rows[0];
  if (!v) return null;
  const where = "Your listing is live";

  if (change.kind === "remove_asset" && v.counted && v.photos - 1 < SUBMIT_MIN_IMAGES) {
    return apiError(
      409,
      `${where}, so it needs at least ${SUBMIT_MIN_IMAGES} photos of your work. Upload another photo first, then remove this one.`,
      "LISTING_MINIMUM",
      { missing: "images", min: SUBMIT_MIN_IMAGES }
    );
  }

  const removes = (role: "logo" | "cover") => {
    const id = role === "logo" ? v.logo_media_id : v.cover_media_id;
    if (change.kind === "clear_role") return change.role === role;
    return id !== null && id === change.assetId;
  };
  const has = (role: "logo" | "cover") => {
    const id = role === "logo" ? v.logo_media_id : v.cover_media_id;
    const url = role === "logo" ? v.logo_url : v.cover_image_url;
    return id !== null || !!url?.trim();
  };
  const before = has("logo") || has("cover");
  const after = (has("logo") && !removes("logo")) || (has("cover") && !removes("cover"));
  if (before && !after) {
    return apiError(
      409,
      `${where}, so it needs a logo or a cover photo. Add the other one first, or use Replace to swap in a new image.`,
      "LISTING_MINIMUM",
      { missing: "logo_or_cover" }
    );
  }
  return null;
}
