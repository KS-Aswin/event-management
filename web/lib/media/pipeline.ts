// Upload pipeline (docs/PRODUCT_PLAN.md 4.3 / 4.4): reserve -> PUT bytes ->
// complete. Route handlers in app/api/vendor/media/** are thin wrappers.

import { createHash, randomUUID } from "node:crypto";
import { getStorage, currentStorageDriver } from "@/lib/storage";
import { getVendorEntitlements } from "@/lib/entitlements";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MIN_DIMENSIONS,
  PURPOSES,
  videoUploadsEnabled,
  type MediaPurpose,
} from "./config";
import { sniffType, imageRejectMessage, ACCEPTED_IMAGE_TYPES } from "./magic";
import { processImage, readImageSize, extractRegion, ImageDecodeError, type CropRect } from "./image";
import { parseVideoLink } from "./video-link";
import {
  albumBelongsTo,
  serviceBelongsTo,
  deleteAssetRow,
  finalizeAsset,
  findAsset,
  findAssetBySha,
  findVideoLink,
  getMediaUsage,
  initialStatusFor,
  insertVideoLink,
  reserveUpload,
  setVendorImage,
  getVendorImageIds,
  updateAssetFields,
  toClientAsset,
  assetUrls,
  type MediaAssetRow,
  type VariantRef,
  type VendorRef,
} from "./repo";

export interface PipelineResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string, code: string, extra?: Record<string, unknown>): PipelineResult => ({
  status,
  body: { error, code, ...extra },
});

const RAW_NAME = "upload.bin";

function maxBytesFor(kind: string): number {
  return kind === "video_file" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

function tooLarge(kind: string): PipelineResult {
  return kind === "video_file"
    ? fail(413, "Videos can be at most 50 MB. Trim it or add a YouTube link instead.", "TOO_LARGE")
    : fail(413, "Images can be at most 15 MB.", "TOO_LARGE");
}

function planLimit(limit: string, max: number | null): PipelineResult {
  return fail(402, "You've reached your plan's limit for this. Remove something first.", "PLAN_LIMIT", {
    limit,
    max,
  });
}

function asId(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : "invalid";
}

// ---- step 1: reserve -------------------------------------------------------

export async function reserve(vendor: VendorRef, input: Record<string, unknown>): Promise<PipelineResult> {
  const kind = input.kind;
  if (kind !== "image" && kind !== "video_file") {
    return fail(400, "kind must be image or video_file.", "VALIDATION");
  }
  const purpose = (input.purpose ?? "gallery") as MediaPurpose;
  if (!PURPOSES.includes(purpose)) return fail(400, "Unknown purpose.", "VALIDATION");
  if (kind === "video_file" && purpose !== "gallery") {
    return fail(400, "Videos can only be added to the gallery.", "VALIDATION");
  }
  if (kind === "video_file" && !videoUploadsEnabled()) {
    return fail(403, "Video uploads are turned off. Add a YouTube, Instagram or Vimeo link instead.", "FORBIDDEN");
  }

  const contentType = typeof input.contentType === "string" ? input.contentType.toLowerCase().trim() : "";
  if (kind === "image") {
    if (contentType === "image/heic" || contentType === "image/heif") {
      return fail(415, imageRejectMessage("image/heic"), "UNSUPPORTED_TYPE");
    }
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
      return fail(415, imageRejectMessage("unknown"), "UNSUPPORTED_TYPE");
    }
  } else if (contentType !== "video/mp4") {
    return fail(415, "Only MP4 videos are accepted.", "UNSUPPORTED_TYPE");
  }

  const bytes = typeof input.bytes === "number" ? input.bytes : NaN;
  if (!Number.isInteger(bytes) || bytes <= 0) return fail(400, "bytes must be the file size.", "VALIDATION");
  if (bytes > maxBytesFor(kind)) return tooLarge(kind);

  let durationS: number | null = null;
  if (kind === "video_file" && input.durationS !== undefined && input.durationS !== null) {
    const d = Number(input.durationS);
    if (!Number.isFinite(d) || d < 0) return fail(400, "Invalid duration.", "VALIDATION");
    if (d > 90.5) return fail(400, "Videos can be at most 90 seconds.", "VALIDATION");
    durationS = Math.round(d);
  }

  const albumId = asId(input.albumId);
  const serviceId = asId(input.serviceId);
  if (albumId === "invalid" || serviceId === "invalid") return fail(400, "Invalid album or offering.", "VALIDATION");
  if (albumId !== null && !(await albumBelongsTo(vendor.id, albumId))) return fail(404, "Album not found.", "NOT_FOUND");
  if (serviceId !== null && !(await serviceBelongsTo(vendor.id, serviceId))) {
    return fail(404, "Offering not found.", "NOT_FOUND");
  }

  const caption = typeof input.caption === "string" ? input.caption.trim().slice(0, 300) : "";

  const ent = await getVendorEntitlements(vendor.id);
  const usage = await getMediaUsage(vendor.id);
  if (kind === "image" && purpose === "gallery" && ent.maxImages !== null && usage.images >= ent.maxImages) {
    return planLimit("images", ent.maxImages);
  }
  if (kind === "video_file" && ent.maxVideoFiles !== null && usage.videoFiles >= ent.maxVideoFiles) {
    return planLimit("video_files", ent.maxVideoFiles);
  }

  const uuid = randomUUID();
  const row = await reserveUpload({
    vendorId: vendor.id,
    uuid,
    kind,
    purpose,
    storageDriver: currentStorageDriver(),
    storageKey: `vendors/${vendor.id}/${uuid}`,
    mime: contentType,
    bytes,
    albumId,
    serviceId,
    caption,
    durationS,
  });

  const storage = getStorage(row.storage_driver);
  const maxBytes = maxBytesFor(kind);
  let upload: { url: string; method: "PUT"; headers?: Record<string, string> };
  if (storage.createUploadUrl) {
    upload = await storage.createUploadUrl(`${row.storage_key}/${RAW_NAME}`, contentType, maxBytes);
  } else {
    upload = { url: `/api/vendor/media/uploads/${row.id}/file`, method: "PUT" };
  }
  return {
    status: 201,
    body: { assetId: row.id, uploadUrl: upload.url, method: upload.method, headers: upload.headers ?? {}, maxBytes },
  };
}

// ---- step 2: bytes (local driver) -----------------------------------------

/** Reads a request body into memory, stopping as soon as it exceeds maxBytes. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer | "too_large"> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function putBytes(
  vendor: VendorRef,
  id: number,
  request: Request
): Promise<PipelineResult> {
  const row = await findAsset(vendor.id, id);
  if (!row || !row.storage_key) return fail(404, "Not found.", "NOT_FOUND");
  if (row.status !== "uploading") return fail(409, "This upload is already finished.", "CONFLICT");
  const max = maxBytesFor(row.kind);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return tooLarge(row.kind);
  const buf = await readCapped(request.body, max);
  if (buf === "too_large") return tooLarge(row.kind);
  if (buf.byteLength === 0) return fail(400, "The file is empty.", "VALIDATION");
  const storage = getStorage(row.storage_driver);
  await storage.put(`${row.storage_key}/${RAW_NAME}`, buf, { contentType: "application/octet-stream" });
  return { status: 200, body: { ok: true, bytes: buf.byteLength } };
}

// ---- step 3: complete -----------------------------------------------------

async function discard(vendor: VendorRef, row: MediaAssetRow): Promise<void> {
  await deleteAssetRow(vendor.id, row.id);
  // Only our own drivers own the objects; legacy 'url' rows just lose the row.
  if (row.storage_key && row.storage_driver && row.storage_driver !== "url" && row.storage_key.startsWith("vendors/")) {
    try {
      await getStorage(row.storage_driver).deletePrefix(row.storage_key);
    } catch (err) {
      console.warn("[media] could not delete objects for asset", row.id, err);
    }
  }
}

/**
 * The response for an upload whose bytes match media the vendor already has
 * (QA-014): the existing asset plus a plain message saying where the photo
 * already is, so the uploader can explain per file why nothing new appeared.
 */
async function duplicateResult(vendor: VendorRef, row: MediaAssetRow, dup: MediaAssetRow): Promise<PipelineResult> {
  const ids = await getVendorImageIds(vendor.id);
  const where =
    dup.id === ids.cover_media_id
      ? "your cover photo"
      : dup.id === ids.logo_media_id
        ? "your logo"
        : dup.kind === "image" && dup.purpose === "gallery"
          ? "one of your portfolio photos"
          : dup.kind === "image" && (dup.purpose === "logo" || dup.purpose === "cover")
            ? `an earlier ${dup.purpose === "logo" ? "logo" : "cover photo"}`
            : null;
  let message: string;
  if (row.purpose === "logo" || row.purpose === "cover") {
    message = `This photo is already in your media, so it's now used as your ${row.purpose === "logo" ? "logo" : "cover photo"}.`;
  } else if (row.kind === "video_file") {
    message = "This video is already in your gallery.";
  } else if (where && dup.purpose !== "gallery") {
    message = `This photo is already in your media as ${where}. Choose a different photo for your portfolio.`;
  } else {
    message = "This photo is already in your portfolio, so it wasn't added again.";
  }
  return {
    status: 200,
    body: { asset: toClientAsset(dup), duplicate: true, duplicateOf: dup.purpose, message },
  };
}

async function maybeSetVendorImage(vendor: VendorRef, row: MediaAssetRow): Promise<void> {
  if (row.purpose !== "logo" && row.purpose !== "cover") return;
  const urls = assetUrls(row);
  const url = row.purpose === "logo" ? urls.card ?? urls.full ?? null : urls.full ?? null;
  await setVendorImage(vendor.id, row.purpose, row.id, url);
}

export async function complete(
  vendor: VendorRef,
  id: number,
  input: Record<string, unknown>
): Promise<PipelineResult> {
  const row = await findAsset(vendor.id, id);
  if (!row || !row.storage_key) return fail(404, "Not found.", "NOT_FOUND");
  if (row.status !== "uploading") {
    return { status: 200, body: { asset: toClientAsset(row), duplicate: false } };
  }

  let posterId: number | null = null;
  if (row.kind === "video_file") {
    const p = asId(input.posterMediaId);
    if (p === "invalid") return fail(400, "Invalid poster.", "VALIDATION");
    if (p !== null) {
      const poster = await findAsset(vendor.id, p);
      if (!poster || poster.kind !== "image") return fail(404, "Poster not found.", "NOT_FOUND");
      posterId = p;
    }
  }

  const storage = getStorage(row.storage_driver);
  const rawKey = `${row.storage_key}/${RAW_NAME}`;
  const obj = await storage.get(rawKey);
  if (!obj) return fail(400, "Upload the file before completing.", "VALIDATION");
  const buf = Buffer.isBuffer(obj.body)
    ? obj.body
    : ((await readCapped(obj.body, maxBytesFor(row.kind) + 1)) as Buffer);
  if (!Buffer.isBuffer(buf) || buf.byteLength > maxBytesFor(row.kind)) {
    await discard(vendor, row);
    return tooLarge(row.kind);
  }

  const sniffed = sniffType(buf.subarray(0, 64));
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const status = initialStatusFor(vendor);

  if (row.kind === "video_file") {
    if (sniffed !== "video/mp4") {
      await discard(vendor, row);
      return fail(415, "Only MP4 videos are accepted.", "UNSUPPORTED_TYPE");
    }
    const dup = await findAssetBySha(vendor.id, sha256);
    if (dup && dup.id !== row.id) {
      await discard(vendor, row);
      return duplicateResult(vendor, row, dup);
    }
    const videoKey = `${row.storage_key}/video.mp4`;
    await storage.put(videoKey, buf, { contentType: "video/mp4" });
    await storage.delete(rawKey);
    const done = await finalizeAsset(vendor.id, row.id, {
      variants: { video: { key: videoKey } },
      mime: "video/mp4",
      bytes: buf.byteLength,
      width: null,
      height: null,
      sha256,
      placeholderColor: null,
      status,
      posterMediaId: posterId,
    });
    if (!done) {
      const again = await findAssetBySha(vendor.id, sha256);
      await discard(vendor, row);
      return again
        ? duplicateResult(vendor, row, again)
        : fail(409, "Upload could not be saved. Please try again.", "CONFLICT");
    }
    return { status: 201, body: { asset: toClientAsset(done), duplicate: false } };
  }

  // Image.
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(sniffed)) {
    await discard(vendor, row);
    return fail(415, imageRejectMessage(sniffed), "UNSUPPORTED_TYPE");
  }
  const dup = await findAssetBySha(vendor.id, sha256);
  if (dup && dup.id !== row.id) {
    await discard(vendor, row);
    // Re-uploading an existing photo as logo/cover reuses it for that slot.
    if (row.purpose === "logo" || row.purpose === "cover") {
      await maybeSetVendorImage(vendor, { ...dup, purpose: row.purpose });
    }
    return duplicateResult(vendor, row, dup);
  }

  let variants: Record<string, VariantRef> = {};
  let width: number | null = null;
  let height: number | null = null;
  let placeholderColor: string | null = null;
  try {
    const size = await readImageSize(buf);
    if (size) {
      const min = MIN_DIMENSIONS[row.purpose];
      const short = Math.min(size.width, size.height);
      if ((min.shortSide && short < min.shortSide) || size.width < min.w || size.height < min.h) {
        await discard(vendor, row);
        const need = min.shortSide ? `at least ${min.shortSide} px on the short side` : `at least ${min.w} x ${min.h} px`;
        return fail(422, `This image is too small. Use one ${need}.`, "VALIDATION");
      }
    }
    const processed = await processImage(buf, row.purpose);
    if (processed.fallback) {
      // sharp unavailable on this platform: keep the client-resized upload as "full".
      const ext = sniffed === "image/png" ? "png" : sniffed === "image/webp" ? "webp" : "jpg";
      const key = `${row.storage_key}/full.${ext}`;
      await storage.put(key, buf, { contentType: sniffed });
      variants = { full: { key } };
    } else {
      for (const v of processed.variants) {
        const key = `${row.storage_key}/${v.name}.webp`;
        await storage.put(key, v.body, { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
        variants[v.name] = { key, w: v.width, h: v.height };
      }
      width = processed.width;
      height = processed.height;
      placeholderColor = processed.placeholderColor;
    }
  } catch (err) {
    if (err instanceof ImageDecodeError) {
      await discard(vendor, row);
      return fail(415, "This image could not be read. Try exporting it again as JPEG.", "UNSUPPORTED_TYPE");
    }
    throw err;
  }
  await storage.delete(rawKey);

  const done = await finalizeAsset(vendor.id, row.id, {
    variants,
    mime: "image/webp",
    bytes: buf.byteLength,
    width,
    height,
    sha256,
    placeholderColor,
    status,
    posterMediaId: null,
  });
  if (!done) {
    const again = await findAssetBySha(vendor.id, sha256);
    await discard(vendor, row);
    return again
      ? duplicateResult(vendor, row, again)
      : fail(409, "Upload could not be saved. Please try again.", "CONFLICT");
  }
  await maybeSetVendorImage(vendor, done);
  return { status: 201, body: { asset: toClientAsset(done), duplicate: false } };
}

// ---- video links -----------------------------------------------------------

export async function addLink(vendor: VendorRef, input: Record<string, unknown>): Promise<PipelineResult> {
  const parsed = parseVideoLink(input.url);
  if (!parsed) {
    return fail(400, "Paste a YouTube, Instagram reel or Vimeo link.", "VALIDATION");
  }
  const albumId = asId(input.albumId);
  const serviceId = asId(input.serviceId);
  if (albumId === "invalid" || serviceId === "invalid") return fail(400, "Invalid album or offering.", "VALIDATION");
  if (albumId !== null && !(await albumBelongsTo(vendor.id, albumId))) return fail(404, "Album not found.", "NOT_FOUND");
  if (serviceId !== null && !(await serviceBelongsTo(vendor.id, serviceId))) {
    return fail(404, "Offering not found.", "NOT_FOUND");
  }
  const existing = await findVideoLink(vendor.id, parsed.provider, parsed.id);
  if (existing) return { status: 200, body: { asset: toClientAsset(existing), duplicate: true } };

  const ent = await getVendorEntitlements(vendor.id);
  const usage = await getMediaUsage(vendor.id);
  if (ent.maxVideoLinks !== null && usage.videoLinks >= ent.maxVideoLinks) {
    return planLimit("video_links", ent.maxVideoLinks);
  }
  const caption = typeof input.caption === "string" ? input.caption.trim().slice(0, 300) : "";
  const row = await insertVideoLink({
    vendorId: vendor.id,
    url: parsed.url,
    provider: parsed.provider,
    externalId: parsed.id,
    caption,
    albumId,
    serviceId,
    status: initialStatusFor(vendor),
  });
  return { status: 201, body: { asset: toClientAsset(row), duplicate: false } };
}

// ---- delete ------------------------------------------------------------------

export async function removeAsset(vendor: VendorRef, id: number): Promise<PipelineResult> {
  const row = await findAsset(vendor.id, id);
  if (!row) return fail(404, "Not found.", "NOT_FOUND");
  // A poster made only for this video goes with it.
  let poster: MediaAssetRow | null = null;
  if (row.poster_media_id) {
    const p = await findAsset(vendor.id, row.poster_media_id);
    if (p && p.purpose === "poster") poster = p;
  }
  await discard(vendor, row);
  if (poster) await discard(vendor, poster);
  return { status: 200, body: { ok: true } };
}

// ---- logo / cover crop (P0-7) ---------------------------------------------

/** Smallest crop (in source pixels) that still makes a sharp logo / cover. */
export const CROP_MIN = { logo: { w: 200, h: 200 }, cover: { w: 800, h: 450 } } as const;
const CROP_ASPECT = { logo: 1, cover: 16 / 9 } as const;

function parseCrop(v: unknown): CropRect | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : NaN);
  const r = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
  if ([r.x, r.y, r.width, r.height].some((x) => Number.isNaN(x))) return null;
  const eps = 0.001;
  if (r.x < -eps || r.y < -eps || r.width <= 0 || r.height <= 0) return null;
  if (r.x + r.width > 1 + eps || r.y + r.height > 1 + eps) return null;
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, width: Math.min(r.width, 1 - x), height: Math.min(r.height, 1 - y) };
}

/** The uncropped image behind an asset: its kept "source" copy, else "full". */
function sourceKey(row: MediaAssetRow): string | null {
  const k = row.variants?.source?.key ?? row.variants?.full?.key ?? null;
  return k && row.storage_key && k.startsWith(`${row.storage_key}/`) ? k : null;
}

/**
 * Crops one of the vendor's photos into a new logo/cover asset (square or
 * 16:9 variants made by sharp), keeps an uncropped "source" copy so the crop
 * can be redone, and makes it the vendor's logo/cover. The previous
 * logo/cover asset is removed when it was a dedicated logo/cover asset that
 * nothing else uses (gallery photos are never touched).
 */
export async function cropVendorImage(
  vendor: VendorRef,
  which: "logo" | "cover",
  input: Record<string, unknown>
): Promise<PipelineResult> {
  const mediaId = asId(input.mediaId);
  if (mediaId === null || mediaId === "invalid") return fail(400, "mediaId is required.", "VALIDATION");
  const crop = parseCrop(input.crop);
  if (!crop) return fail(400, "crop must be {x, y, width, height} as fractions of the photo.", "VALIDATION");

  const src = await findAsset(vendor.id, mediaId);
  if (!src || src.kind !== "image" || src.status === "uploading" || src.status === "processing") {
    return fail(404, "Not found.", "NOT_FOUND");
  }
  if (src.status === "rejected") return fail(400, "A rejected photo can't be used here.", "VALIDATION");
  const key = src.storage_driver && src.storage_driver !== "url" ? sourceKey(src) : null;
  if (!key) return fail(400, "This photo can't be cropped. Upload it again.", "VALIDATION");

  const storage = getStorage(src.storage_driver!);
  const obj = await storage.get(key);
  if (!obj) return fail(400, "This photo's file is missing. Upload it again.", "VALIDATION");
  const srcBuf = Buffer.isBuffer(obj.body) ? obj.body : await readCapped(obj.body, MAX_IMAGE_BYTES + 1);
  if (!Buffer.isBuffer(srcBuf)) return tooLarge("image");

  let region;
  try {
    region = await extractRegion(srcBuf, crop);
  } catch (err) {
    if (err instanceof ImageDecodeError) return fail(415, "This photo could not be read.", "UNSUPPORTED_TYPE");
    throw err;
  }
  if (!region) return fail(503, "Cropping isn't available on this server right now.", "UNAVAILABLE");
  const min = CROP_MIN[which];
  if (region.width < min.w - 1 || region.height < min.h - 1) {
    return fail(
      422,
      `That crop is too small for a sharp ${which}. Zoom out or use a larger photo (at least ${min.w} × ${min.h} px).`,
      "VALIDATION",
      { minWidth: min.w, minHeight: min.h }
    );
  }
  const aspect = region.width / region.height;
  if (Math.abs(aspect - CROP_ASPECT[which]) / CROP_ASPECT[which] > 0.03) {
    return fail(400, which === "logo" ? "A logo crop must be square." : "A cover crop must be 16:9.", "VALIDATION");
  }

  const sha256 = createHash("sha256").update(`crop:${which}:`).update(region.body).digest("hex");
  const before = await getVendorImageIds(vendor.id);
  const previousId = which === "logo" ? before.logo_media_id : before.cover_media_id;
  const otherId = which === "logo" ? before.cover_media_id : before.logo_media_id;

  let done = await findAssetBySha(vendor.id, sha256);
  if (!done || done.purpose !== which) {
    let processed;
    try {
      processed = await processImage(region.body, which);
    } catch (err) {
      if (err instanceof ImageDecodeError) return fail(415, "This photo could not be read.", "UNSUPPORTED_TYPE");
      throw err;
    }
    if (processed.fallback) return fail(503, "Cropping isn't available on this server right now.", "UNAVAILABLE");
    const uuid = randomUUID();
    const row = await reserveUpload({
      vendorId: vendor.id,
      uuid,
      kind: "image",
      purpose: which,
      storageDriver: currentStorageDriver(),
      storageKey: `vendors/${vendor.id}/${uuid}`,
      mime: "image/webp",
      bytes: region.body.byteLength,
      albumId: null,
      serviceId: null,
      caption: "",
      durationS: null,
    });
    const out = getStorage(row.storage_driver);
    const variants: Record<string, VariantRef> = {};
    const cache = "public, max-age=31536000, immutable";
    for (const v of processed.variants) {
      if (v.name === "source") continue;
      const k = `${row.storage_key}/${v.name}.webp`;
      await out.put(k, v.body, { contentType: "image/webp", cacheControl: cache });
      variants[v.name] = { key: k, w: v.width, h: v.height };
    }
    // Keep the uncropped photo so the vendor can adjust the crop later.
    const ext = key.endsWith(".png") ? "png" : key.endsWith(".jpg") ? "jpg" : "webp";
    const sk = `${row.storage_key}/source.${ext}`;
    const type = ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : "image/webp";
    await out.put(sk, srcBuf, { contentType: type, cacheControl: cache });
    variants.source = { key: sk, w: region.sourceWidth, h: region.sourceHeight };

    // Cropping can't add new content: a crop of an approved photo stays approved.
    const status = src.status === "approved" ? "approved" : initialStatusFor(vendor);
    const saved = await finalizeAsset(vendor.id, row.id, {
      variants,
      mime: "image/webp",
      bytes: region.body.byteLength,
      width: processed.width,
      height: processed.height,
      sha256,
      placeholderColor: processed.placeholderColor,
      status,
      posterMediaId: null,
    });
    if (!saved) {
      await discard(vendor, row);
      done = await findAssetBySha(vendor.id, sha256);
      if (!done) return fail(409, "The crop could not be saved. Please try again.", "CONFLICT");
    } else {
      done = saved;
      if (src.alt_text) done = (await updateAssetFields(vendor.id, done.id, { alt_text: src.alt_text })) ?? done;
    }
  }

  if (!done) return fail(409, "The crop could not be saved. Please try again.", "CONFLICT");
  await maybeSetVendorImage(vendor, done);

  if (previousId && previousId !== done.id && previousId !== otherId) {
    const prev = await findAsset(vendor.id, previousId);
    if (prev && prev.purpose === which) await discard(vendor, prev);
  }
  const urls = assetUrls(done);
  return {
    status: 201,
    body: {
      ok: true,
      mediaId: done.id,
      url: which === "logo" ? urls.card ?? urls.full ?? null : urls.full ?? null,
      asset: toClientAsset(done),
    },
  };
}
