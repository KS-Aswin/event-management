import { LocalDiskAdapter } from "./local";
import { S3StorageAdapter, s3ConfigFromEnv } from "./s3";
import { SupabaseStorageAdapter, supabaseConfigFromEnv } from "./supabase";
import { parseStorageDriver, type StorageAdapter, type StorageDriver } from "./types";

export * from "./types";
export { LocalDiskAdapter, defaultUploadsRoot } from "./local";
export { SupabaseStorageAdapter, supabaseConfigFromEnv } from "./supabase";
export { S3StorageAdapter, s3ConfigFromEnv } from "./s3";

const cache = new Map<StorageDriver, StorageAdapter>();

/**
 * Returns the storage adapter for `driver` (default: STORAGE_DRIVER, then
 * "local"). Unknown names and missing driver settings throw with a clear
 * message, so a misconfigured deploy fails fast instead of losing uploads.
 *   local    - web/uploads (development; refused for writes in production)
 *   supabase - Supabase Storage HTTP API (SUPABASE_URL, SUPABASE_SECRET_KEY)
 *   s3 / r2  - any S3-compatible API (S3_ENDPOINT, S3_ACCESS_KEY_ID, ...)
 */
export function getStorage(driver: string | null | undefined = process.env.STORAGE_DRIVER): StorageAdapter {
  const name = parseStorageDriver(driver);
  const hit = cache.get(name);
  if (hit) return hit;
  let adapter: StorageAdapter;
  switch (name) {
    case "local":
      adapter = new LocalDiskAdapter();
      break;
    case "supabase":
      adapter = new SupabaseStorageAdapter(supabaseConfigFromEnv());
      break;
    case "s3":
    case "r2":
      adapter = new S3StorageAdapter(s3ConfigFromEnv(name));
      break;
  }
  cache.set(name, adapter);
  return adapter;
}

/** Test helper: forget cached adapters (env changed). */
export function resetStorageCache(): void {
  cache.clear();
}

/** The driver new uploads are written with. */
export function currentStorageDriver(): StorageDriver {
  return parseStorageDriver(process.env.STORAGE_DRIVER);
}

/** Startup check used by instrumentation.ts. */
export function assertStorageConfigured(): void {
  getStorage();
}
