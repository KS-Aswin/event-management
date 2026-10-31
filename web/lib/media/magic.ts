// File-type sniffing by magic bytes (never trust the filename or the
// client's Content-Type). Pure: loaded directly by tests/storage.test.mjs.

export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/raw"
  | "video/mp4"
  | "application/pdf"
  | "unknown";

function ascii(buf: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"]);
const CR3_BRAND = "crx ";

export function sniffType(buf: Uint8Array): SniffedType {
  if (buf.length < 12) return "unknown";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "image/webp";
  if (ascii(buf, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (brand === CR3_BRAND) return "image/raw";
    // mp4 family: isom, iso2, mp41, mp42, avc1, M4V , dash, ... (quicktime "qt  " is not accepted)
    if (brand !== "qt  ") return "video/mp4";
    return "unknown";
  }
  // TIFF-based RAW (NEF, DNG, ARW, CR2) and plain TIFF: rejected as RAW.
  if ((ascii(buf, 0, 4) === "II*\u0000") || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) {
    return "image/raw";
  }
  return "unknown";
}

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Message shown for a rejected image type (415). */
export function imageRejectMessage(t: SniffedType): string {
  if (t === "image/heic") return "Please upload JPEG. On iPhone choose Most Compatible.";
  if (t === "image/raw") return "RAW camera files are not supported. Export a JPEG first.";
  return "Only JPEG, PNG or WebP images are accepted.";
}
