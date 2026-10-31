// Media limits and feature flags (docs/PRODUCT_PLAN.md 4.2).

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type MediaPurpose = "gallery" | "logo" | "cover" | "poster";
export type MediaKind = "image" | "video_file" | "video_link";

export const PURPOSES: readonly MediaPurpose[] = ["gallery", "logo", "cover", "poster"];

/** Minimum dimensions per purpose (short side for gallery; w x h for cover/logo). */
export const MIN_DIMENSIONS: Record<MediaPurpose, { w: number; h: number; shortSide?: number }> = {
  gallery: { w: 0, h: 0, shortSide: 500 },
  logo: { w: 200, h: 200 },
  cover: { w: 1200, h: 675 },
  poster: { w: 0, h: 0 },
};

/**
 * MP4 uploads: MEDIA_VIDEO_UPLOADS="true"/"false". Default on locally, off in
 * production until object storage is configured.
 */
export function videoUploadsEnabled(): boolean {
  const v = process.env.MEDIA_VIDEO_UPLOADS;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV !== "production";
}
