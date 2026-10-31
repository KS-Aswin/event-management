// Storage adapter contract (docs/PRODUCT_PLAN.md section 4.4).
//
// Every media_assets row records the driver that stored it, and URLs are
// resolved through getStorage(row.storage_driver).publicUrl(key), so assets
// keep working after STORAGE_DRIVER changes.
//
// Keep this file free of relative runtime imports: tests/storage.test.mjs
// loads it straight into Node (type stripping).

export type StorageDriver = "local" | "s3" | "r2" | "supabase";

export const STORAGE_DRIVERS: readonly StorageDriver[] = ["local", "s3", "r2", "supabase"];

export interface StoredObject {
  key: string;
  contentType: string;
  bytes: number;
}

export interface ByteRange {
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte. */
  end: number;
}

export interface StorageObjectBody {
  body: ReadableStream<Uint8Array> | Buffer;
  contentType: string;
  /** Size of the whole object (not of the range). */
  bytes: number;
}

export interface StorageAdapter {
  readonly driver: StorageDriver;
  put(
    key: string,
    body: Buffer | Uint8Array,
    opts: { contentType: string; cacheControl?: string }
  ): Promise<StoredObject>;
  /** Returns null when the object does not exist. With `range`, body holds only those bytes. */
  get(key: string, opts?: { range?: ByteRange }): Promise<StorageObjectBody | null>;
  /** Size and type without reading the body; null when missing. */
  head(key: string): Promise<{ contentType: string; bytes: number } | null>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Deletes every object under `prefix/` (used when an asset is removed). Idempotent. */
  deletePrefix(prefix: string): Promise<void>;
  /** URL the browser can load. */
  publicUrl(key: string): string;
  /** Optional direct-to-bucket uploads (S3/R2/Supabase). The local driver uses an /api URL instead. */
  createUploadUrl?(
    key: string,
    contentType: string,
    maxBytes: number
  ): Promise<{ url: string; method: "PUT"; headers?: Record<string, string> }>;
}

/** Thrown for keys that could escape the storage root or are otherwise malformed. */
export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key.slice(0, 200))}`);
    this.name = "InvalidStorageKeyError";
  }
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Validates a storage key: forward-slash separated segments of
 * [A-Za-z0-9._-], no empty, "." or ".." segments, no backslashes, no NUL,
 * no leading slash. Returns the key unchanged or throws.
 */
export function assertSafeKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new InvalidStorageKeyError(String(key));
  }
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "." || seg === ".." || !SEGMENT_RE.test(seg)) {
      throw new InvalidStorageKeyError(key);
    }
  }
  return key;
}

export function isSafeKey(key: string): boolean {
  try {
    assertSafeKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Keys under private/ are never served by /media. */
export function isPrivateKey(key: string): boolean {
  return key === "private" || key.startsWith("private/");
}

/** Content type from a key's extension (keys are written by our own code). */
export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "mp4":
      return "video/mp4";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/**
 * Normalises STORAGE_DRIVER. Throws a clear error for unknown values so a
 * typo fails at startup (instrumentation.ts) instead of on the first upload.
 */
export function parseStorageDriver(raw: string | undefined | null): StorageDriver {
  const value = (raw ?? "").trim().toLowerCase() || "local";
  if ((STORAGE_DRIVERS as readonly string[]).includes(value)) return value as StorageDriver;
  throw new Error(
    `Unknown STORAGE_DRIVER "${raw}". Use one of: ${STORAGE_DRIVERS.join(", ")} (default: local).`
  );
}
