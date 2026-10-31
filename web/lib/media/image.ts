import type { MediaPurpose } from "./config";

// Image processing (docs/PRODUCT_PLAN.md 4.3): auto-rotate from EXIF, strip
// all metadata (sharp drops it unless withMetadata() is called), write WebP
// q80 variants. The original is not kept.

export interface VariantSpec {
  name: "thumb" | "card" | "full";
  width: number;
  height?: number;
  /** Crop to exactly width x height (logo square, cover 16:9). */
  crop?: boolean;
  /** Long edge limit instead of width. */
  longEdge?: boolean;
}

export const VARIANT_SPECS: Record<MediaPurpose, VariantSpec[]> = {
  gallery: [
    { name: "thumb", width: 320 },
    { name: "card", width: 800 },
    { name: "full", width: 1920, longEdge: true },
  ],
  poster: [
    { name: "thumb", width: 320 },
    { name: "card", width: 800 },
    { name: "full", width: 1920, longEdge: true },
  ],
  logo: [
    { name: "thumb", width: 96, height: 96, crop: true },
    { name: "card", width: 256, height: 256, crop: true },
    { name: "full", width: 512, height: 512, crop: true },
  ],
  cover: [
    { name: "thumb", width: 320, height: 180, crop: true },
    { name: "card", width: 800, height: 450, crop: true },
    { name: "full", width: 1920, height: 1080, crop: true },
  ],
};

export interface ProcessedVariant {
  name: VariantSpec["name"];
  body: Buffer;
  width: number;
  height: number;
}

export interface ProcessedImage {
  /** Oriented dimensions of the decoded original. */
  width: number;
  height: number;
  placeholderColor: string | null;
  variants: ProcessedVariant[];
  /** True when sharp could not be loaded and the input was stored as-is. */
  fallback: boolean;
}

type SharpFn = typeof import("sharp").default;
let sharpPromise: Promise<SharpFn | null> | null = null;

async function loadSharp(): Promise<SharpFn | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => (m.default ?? m) as unknown as SharpFn)
      .catch((err) => {
        console.warn("[media] sharp failed to load; storing images without variants.", err);
        return null;
      });
  }
  return sharpPromise;
}

export class ImageDecodeError extends Error {}

/** Reads oriented dimensions (throws ImageDecodeError if the file is not a decodable image). */
export async function readImageSize(input: Buffer): Promise<{ width: number; height: number } | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const meta = await sharp(input, { failOn: "error" }).metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w];
    return { width: w, height: h };
  } catch (err) {
    throw new ImageDecodeError(err instanceof Error ? err.message : "Image could not be read.");
  }
}

export async function processImage(input: Buffer, purpose: MediaPurpose): Promise<ProcessedImage> {
  const sharp = await loadSharp();
  if (!sharp) {
    return { width: 0, height: 0, placeholderColor: null, variants: [], fallback: true };
  }
  let base;
  try {
    // rotate() with no args applies EXIF orientation; output has no metadata.
    base = sharp(input, { failOn: "error", limitInputPixels: 100_000_000 }).rotate();
    const size = (await readImageSize(input)) ?? { width: 0, height: 0 };
    const stats = await sharp(input).rotate().resize(64, 64, { fit: "inside" }).stats();
    const d = stats.dominant;
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    const placeholderColor = d ? `#${hex(d.r)}${hex(d.g)}${hex(d.b)}` : null;

    const variants: ProcessedVariant[] = [];
    for (const spec of VARIANT_SPECS[purpose]) {
      let pipe = base.clone();
      if (spec.crop && spec.height) {
        pipe = pipe.resize(spec.width, spec.height, { fit: "cover", position: "attention", withoutEnlargement: false });
      } else if (spec.longEdge) {
        pipe = pipe.resize(spec.width, spec.width, { fit: "inside", withoutEnlargement: true });
      } else {
        pipe = pipe.resize({ width: spec.width, withoutEnlargement: true });
      }
      const out = await pipe.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      variants.push({ name: spec.name, body: out.data, width: out.info.width, height: out.info.height });
    }
    return { width: size.width, height: size.height, placeholderColor, variants, fallback: false };
  } catch (err) {
    throw new ImageDecodeError(err instanceof Error ? err.message : "Image could not be processed.");
  }
}
